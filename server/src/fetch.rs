//! SSRF-safe HTTP fetching of user-supplied URLs (legacy profile images, link previews).
//!
//! - Hostnames only resolve to public addresses. This is checked when connecting, so DNS
//!   rebinding can't reach private networks. Literal IPs and every redirect hop are checked too.
//! - Proxies from the environment are ignored (a proxy would resolve names itself).
//! - Bodies are read with a size cap, optionally stopping early at a marker.

use anyhow::{anyhow, bail, Result};
use bytes::{Bytes, BytesMut};
use futures::{Stream, StreamExt};
use std::net::{IpAddr, Ipv4Addr, SocketAddr};
use std::sync::Arc;
use std::time::Duration;
use url::Url;

fn is_public_v4(v4: Ipv4Addr) -> bool {
    let o = v4.octets();
    !(v4.is_private()
        || v4.is_loopback()
        || v4.is_link_local()
        || v4.is_broadcast()
        || v4.is_multicast()
        || v4.is_unspecified()
        || v4.is_documentation()
        || o[0] == 0
        || (o[0] == 100 && (64..128).contains(&o[1])) // CGNAT
        || (o[0] == 198 && (18..20).contains(&o[1])) // benchmarking
        || (o[0] == 192 && o[1] == 0 && o[2] == 0) // IETF protocol assignments
        || (o[0] == 192 && o[1] == 88 && o[2] == 99) // 6to4 relay anycast
        || o[0] >= 240)
}

pub fn is_public_ip(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(v4) => is_public_v4(v4),
        IpAddr::V6(v6) => {
            if let Some(v4) = v6.to_ipv4_mapped() {
                return is_public_v4(v4);
            }
            let s = v6.segments();
            let embedded = |hi: u16, lo: u16| Ipv4Addr::new((hi >> 8) as u8, hi as u8, (lo >> 8) as u8, lo as u8);
            // NAT64 (64:ff9b::/96) and 6to4 (2002::/16) reach the embedded IPv4 address.
            if s[0] == 0x64 && s[1] == 0xff9b && s[2..6] == [0, 0, 0, 0] {
                return is_public_v4(embedded(s[6], s[7]));
            }
            if s[0] == 0x2002 {
                return is_public_v4(embedded(s[1], s[2]));
            }
            !(v6.is_loopback()
                || v6.is_unspecified()
                || v6.is_multicast()
                || s[0..6] == [0, 0, 0, 0, 0, 0] // IPv4-compatible (deprecated)
                || (s[0] == 0x64 && s[1] == 0xff9b && s[2] == 1) // local-use NAT64
                || (s[0] == 0x2001 && s[1] == 0) // Teredo
                || (s[0] == 0x2001 && s[1] == 0x0db8) // documentation
                || (s[0] == 0x0100 && s[1..4] == [0, 0, 0]) // discard
                || (s[0] & 0xfe00) == 0xfc00 // unique local
                || (s[0] & 0xffc0) == 0xfe80 // link local
                || (s[0] & 0xffc0) == 0xfec0) // site local
        }
    }
}

/// Resolves hostnames and refuses non-public addresses.
pub struct PublicResolver;

impl reqwest::dns::Resolve for PublicResolver {
    fn resolve(&self, name: reqwest::dns::Name) -> reqwest::dns::Resolving {
        Box::pin(async move {
            let addrs: Vec<SocketAddr> = tokio::net::lookup_host((name.as_str(), 0))
                .await?
                .filter(|a| is_public_ip(a.ip()))
                .collect();
            if addrs.is_empty() {
                return Err("host resolves to no public address".into());
            }
            Ok(Box::new(addrs.into_iter()) as reqwest::dns::Addrs)
        })
    }
}

/// http(s) on a standard port, no credentials, and not a literal non-public IP or localhost.
pub fn is_fetchable(url: &Url) -> bool {
    if !matches!(url.scheme(), "http" | "https")
        || !url.username().is_empty()
        || url.password().is_some()
        || !matches!(url.port(), None | Some(80 | 443 | 8080 | 8443))
    {
        return false;
    }
    match url.host() {
        Some(url::Host::Ipv4(ip)) => is_public_v4(ip),
        Some(url::Host::Ipv6(ip)) => is_public_ip(IpAddr::V6(ip)),
        Some(url::Host::Domain(d)) => {
            let d = d.trim_end_matches('.').to_ascii_lowercase();
            d != "localhost" && !d.ends_with(".localhost")
        }
        None => false,
    }
}

pub fn sniff_image(bytes: &[u8]) -> Option<&'static str> {
    if bytes.starts_with(&[0x89, b'P', b'N', b'G']) {
        Some("image/png")
    } else if bytes.starts_with(&[0xFF, 0xD8, 0xFF]) {
        Some("image/jpeg")
    } else if bytes.starts_with(b"GIF8") {
        Some("image/gif")
    } else if bytes.len() > 12 && &bytes[0..4] == b"RIFF" && &bytes[8..12] == b"WEBP" {
        Some("image/webp")
    } else if bytes.len() > 12 && &bytes[4..8] == b"ftyp" && (&bytes[8..12] == b"avif" || &bytes[8..12] == b"avis") {
        Some("image/avif")
    } else {
        let head = String::from_utf8_lossy(&bytes[..bytes.len().min(512)]).to_lowercase();
        (head.contains("<svg")).then_some("image/svg+xml")
    }
}

/// A body read with a cap. `complete` is false when the cap cut it short.
pub struct Capped {
    pub body: BytesMut,
    pub complete: bool,
}

/// Reads a byte stream up to `max` bytes, stopping early (complete) once `stop` matches.
pub async fn read_capped<S, E>(mut stream: S, max: usize, stop: Option<&regex::bytes::Regex>) -> Result<Capped>
where
    S: Stream<Item = Result<Bytes, E>> + Unpin,
    E: Into<anyhow::Error>,
{
    const OVERLAP: usize = 64; // a marker split across chunks is still found
    let mut body = BytesMut::new();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(Into::into)?;
        let searched_from = body.len().saturating_sub(OVERLAP);
        if body.len() + chunk.len() > max {
            body.extend_from_slice(&chunk[..max - body.len()]);
            let complete = stop.is_some_and(|re| re.is_match(&body[searched_from..]));
            return Ok(Capped { body, complete });
        }
        body.extend_from_slice(&chunk);
        if stop.is_some_and(|re| re.is_match(&body[searched_from..])) {
            return Ok(Capped { body, complete: true });
        }
    }
    Ok(Capped { body, complete: true })
}

/// An HTTP client for untrusted URLs.
pub struct SafeClient {
    client: reqwest::Client,
}

impl SafeClient {
    /// `max_timeout` bounds every request; callers pass shorter per-request timeouts.
    pub fn new(user_agent: &str, max_redirects: usize, max_timeout: Duration, decompress: bool) -> Result<Self> {
        let client = reqwest::Client::builder()
            .timeout(max_timeout)
            .connect_timeout(Duration::from_secs(3))
            .dns_resolver(Arc::new(PublicResolver))
            .no_proxy()
            // Keep our own Referer (if any) across redirects instead of the previous URL.
            .referer(false)
            .gzip(decompress)
            .brotli(decompress)
            .redirect(reqwest::redirect::Policy::custom(move |attempt| {
                if attempt.previous().len() >= max_redirects {
                    attempt.error("too many redirects")
                } else if !is_fetchable(attempt.url()) {
                    attempt.error("redirect to a non-public URL")
                } else {
                    attempt.follow()
                }
            }))
            .user_agent(user_agent)
            .build()?;
        Ok(Self { client })
    }

    /// Sends a GET after checking the URL. The status isn't checked.
    pub async fn get(&self, url: &Url, timeout: Duration, headers: &[(&str, &str)]) -> Result<reqwest::Response> {
        if !is_fetchable(url) {
            bail!("URL is not fetchable");
        }
        let mut request = self.client.get(url.clone()).timeout(timeout);
        for (name, value) in headers {
            request = request.header(*name, *value);
        }
        Ok(request.send().await?)
    }

    /// GET a successful response's full body, failing if it exceeds `max` bytes.
    pub async fn get_bytes(&self, url: &Url, timeout: Duration, max: usize, headers: &[(&str, &str)]) -> Result<Bytes> {
        let response = self.get(url, timeout, headers).await?.error_for_status()?;
        if response.content_length().is_some_and(|l| l as usize > max) {
            bail!("response too large");
        }
        let capped = read_capped(response.bytes_stream(), max, None).await?;
        if !capped.complete {
            return Err(anyhow!("response too large"));
        }
        Ok(capped.body.freeze())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn blocks_private_addresses() {
        for ip in [
            "127.0.0.1",
            "10.0.0.1",
            "169.254.169.254",
            "192.168.1.1",
            "100.64.0.1",
            "0.0.0.0",
            "192.0.0.8",
            "192.88.99.1",
            "::1",
            "fd00::1",
            "fe80::1",
            "fec0::1",
            "::ffff:127.0.0.1",
            "64:ff9b::a9fe:a9fe", // NAT64 → 169.254.169.254
            "64:ff9b:1::1",       // local-use NAT64
            "2002:a9fe:a9fe::1",  // 6to4 → 169.254.169.254
            "2001:0:4136:e378::1", // Teredo
            "::a9fe:a9fe",        // IPv4-compatible
            "100::1",             // discard
        ] {
            assert!(!is_public_ip(ip.parse().unwrap()), "{ip}");
        }
        for ip in ["1.1.1.1", "2606:4700:4700::1111", "64:ff9b::101:101", "2002:101:101::1"] {
            assert!(is_public_ip(ip.parse().unwrap()), "{ip}");
        }
    }

    #[test]
    fn fetchable_urls() {
        let ok = |u: &str| is_fetchable(&Url::parse(u).unwrap());
        assert!(ok("https://ipfs.near.social/ipfs/x"));
        assert!(ok("http://example.com:8080/a"));
        assert!(!ok("http://169.254.169.254/latest"));
        assert!(!ok("http://[::1]/"));
        assert!(!ok("file:///etc/passwd"));
        assert!(!ok("http://localhost:8080/"));
        assert!(!ok("http://api.localhost/"));
        assert!(!ok("http://example.com:22/"));
        assert!(!ok("http://user:pass@example.com/"));
    }

    fn chunks(parts: &[&[u8]]) -> impl Stream<Item = Result<Bytes, anyhow::Error>> + Unpin {
        futures::stream::iter(parts.iter().map(|p| Ok(Bytes::copy_from_slice(p))).collect::<Vec<_>>())
    }

    #[tokio::test]
    async fn read_capped_stops_at_marker_across_chunks() {
        let re = regex::bytes::Regex::new("(?i)</head").unwrap();
        let c = read_capped(chunks(&[b"<html><head><title>x</title></he", b"ad><body>", b"lots"]), 1000, Some(&re))
            .await
            .unwrap();
        assert!(c.complete);
        assert_eq!(&c.body[..], b"<html><head><title>x</title></head><body>");
    }

    #[tokio::test]
    async fn read_capped_truncates_at_max() {
        let c = read_capped(chunks(&[b"0123456789", b"abcdef"]), 12, None).await.unwrap();
        assert!(!c.complete);
        assert_eq!(&c.body[..], b"0123456789ab");
        let c = read_capped(chunks(&[b"0123", b"4567"]), 12, None).await.unwrap();
        assert!(c.complete);
    }
}
