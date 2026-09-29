//! Text tokenization shared with the web app (STANDARD.md §5): URLs first, then mentions and
//! hashtags in the text between URLs.

use crate::model::account_id::is_valid_account_id;
use regex::Regex;
use std::sync::LazyLock;

static URL_RE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r#"https?://[^\s<>"]+"#).unwrap());
static MENTION_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?:^|[^A-Za-z0-9_@.])@([a-z0-9][a-z0-9._-]{0,63})").unwrap()
});
static HASHTAG_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?:^|[^\p{L}\p{N}_&#/])#([\p{L}\p{N}_]{1,64})").unwrap()
});
static LETTER_RE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"\p{L}").unwrap());

const URL_TRAILING: &[char] = &['.', ',', ':', ';', '!', '?', '\'', '"', ')', ']', '}'];

/// Byte ranges of URLs in `text`, with trailing punctuation removed.
pub fn url_spans(text: &str) -> Vec<(usize, usize)> {
    URL_RE
        .find_iter(text)
        .filter_map(|m| {
            let trimmed = m.as_str().trim_end_matches(URL_TRAILING);
            // "https://" alone isn't a link.
            (trimmed.len() > trimmed.find("://").unwrap() + 3)
                .then(|| (m.start(), m.start() + trimmed.len()))
        })
        .collect()
}

#[derive(Debug, Default, PartialEq)]
pub struct Tokens {
    pub mentions: Vec<String>,
    pub hashtags: Vec<String>,
}

/// Extracts unique mentions (valid account IDs) and hashtags (lowercase) in order of appearance.
pub fn extract(text: &str) -> Tokens {
    let mut tokens = Tokens::default();
    let mut start = 0;
    let spans = url_spans(text);
    let segments = spans
        .iter()
        .map(|&(s, e)| {
            let seg = &text[start..s];
            start = e;
            seg
        })
        .collect::<Vec<_>>()
        .into_iter()
        .chain(std::iter::once(&text[start..]));
    for segment in segments {
        for c in MENTION_RE.captures_iter(segment) {
            let account = c[1].trim_end_matches(['.', '-', '_']);
            if is_valid_account_id(account) && !tokens.mentions.iter().any(|m| m == account) {
                tokens.mentions.push(account.to_string());
            }
        }
        for c in HASHTAG_RE.captures_iter(segment) {
            let tag = &c[1];
            if !LETTER_RE.is_match(tag) {
                continue;
            }
            let tag = tag.to_lowercase();
            if !tokens.hashtags.contains(&tag) {
                tokens.hashtags.push(tag);
            }
        }
    }
    tokens
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn urls() {
        let t = "see https://near.org/a?b=1. and (http://x.io/y) or https://";
        let spans: Vec<_> = url_spans(t).into_iter().map(|(s, e)| &t[s..e]).collect();
        assert_eq!(spans, vec!["https://near.org/a?b=1", "http://x.io/y"]);
    }

    #[test]
    fn mentions_and_hashtags() {
        let t = extract("gm @bob.near, @alice.near. @Bad @x #NEAR #near #123 #web3_dev email a@b.near");
        assert_eq!(t.mentions, vec!["bob.near", "alice.near"]);
        assert_eq!(t.hashtags, vec!["near", "web3_dev"]);
    }

    #[test]
    fn ignores_tokens_inside_urls() {
        let t = extract("https://x.com/@bob.near/#tag and https://a.io/#frag #real @carol.near");
        assert_eq!(t.mentions, vec!["carol.near"]);
        assert_eq!(t.hashtags, vec!["real"]);
    }

    #[test]
    fn unicode_hashtags() {
        let t = extract("#Привет,#日本 x#no &#38; #ñandú");
        assert_eq!(t.hashtags, vec!["привет", "日本", "ñandú"]);
    }
}
