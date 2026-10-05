//! Turns raw `__fastdata_kv` actions into KV rows using exactly the rules of FastNEAR's
//! kv-sub-indexer (fastdata-indexer/kv-sub-indexer/src/main.rs), so this index agrees with
//! the public KV API byte for byte.

use serde::{Deserialize, Serialize};

pub const MAX_NUM_KEYS: usize = 256;
pub const MAX_KEY_LENGTH: usize = 1024;
pub const MAX_VALUE_LENGTH: usize = 262_144;

/// Same formula as `scylladb::compute_order_id` in fastdata-indexer.
pub fn compute_order_id(shard_id: u64, receipt_index: u64, action_index: u64) -> u64 {
    (shard_id * 100_000 + receipt_index) * 1000 + action_index
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ActionStatus {
    Ok,
    /// Args are not a UTF-8 JSON object. Nothing applied.
    InvalidJson,
    /// More than 256 keys. Nothing applied.
    TooManyKeys,
    /// A `__fastdata_fastfs` payload that isn't valid FastFS borsh.
    InvalidBorsh,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DropReason {
    KeyTooLong,
    ValueTooLarge,
}

/// One `__fastdata_kv` action as persisted in the event log.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct LogAction {
    /// order_id
    pub o: u64,
    /// tx hash (base58), when known
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tx: Option<String>,
    /// predecessor_id (the author)
    pub p: String,
    /// action status
    pub s: ActionStatus,
    /// accepted rows: (key, serialized JSON value), in key order
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub r: Vec<(String, String)>,
    /// dropped keys (a key over 1024 bytes is cut to its first 64 bytes)
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub d: Vec<(String, DropReason)>,
    /// A feed action's feed and rows, kept out of `r` (docs/LEGION.md §3).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub c: Option<crate::legion::feeds::FeedRows>,
}

/// One block's worth of `social` writes: one line of the event log.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct LogBlock {
    /// block height
    pub b: u64,
    /// block timestamp, nanoseconds
    pub t: u64,
    /// actions ordered by order_id
    pub a: Vec<LogAction>,
}

impl LogBlock {
    pub fn timestamp_ms(&self) -> u64 {
        self.t / 1_000_000
    }
}

fn truncate_utf8(s: &str, max: usize) -> String {
    let mut end = max.min(s.len());
    while !s.is_char_boundary(end) {
        end -= 1;
    }
    s[..end].to_string()
}

/// What a `__fastdata_fastfs` upload wrote (just the borsh header; the content isn't kept).
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct FastfsHeader {
    pub path: String,
    /// Chunk offset and total size for multi-part (`Partial`) uploads.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub offset: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub full_size: Option<u32>,
    /// `Simple` with no content: the file was deleted.
    pub deleted: bool,
}

fn read_u32(b: &[u8]) -> Option<(u32, &[u8])> {
    Some((u32::from_le_bytes(b.get(..4)?.try_into().ok()?), &b[4..]))
}

fn read_string(b: &[u8]) -> Option<(String, &[u8])> {
    let (len, rest) = read_u32(b)?;
    let bytes = rest.get(..len as usize)?;
    Some((String::from_utf8(bytes.to_vec()).ok()?, &rest[len as usize..]))
}

/// Reads the header of a borsh `FastfsData` (`Simple` = 0, `Partial` = 1).
pub fn parse_fastfs_header(args: &[u8]) -> Option<FastfsHeader> {
    let (&tag, rest) = args.split_first()?;
    let (path, rest) = read_string(rest)?;
    match tag {
        0 => Some(FastfsHeader {
            path,
            offset: None,
            full_size: None,
            deleted: *rest.first()? == 0,
        }),
        1 => {
            let (offset, rest) = read_u32(rest)?;
            let (full_size, _) = read_u32(rest)?;
            Some(FastfsHeader {
                path,
                offset: Some(offset),
                full_size: Some(full_size),
                deleted: false,
            })
        }
        _ => None,
    }
}

/// Parses the args of one action with the kv-sub-indexer rules.
pub fn parse_action(order_id: u64, tx: Option<String>, predecessor: String, args: &[u8]) -> LogAction {
    let mut action = LogAction {
        o: order_id,
        tx,
        p: predecessor,
        s: ActionStatus::Ok,
        r: vec![],
        d: vec![],
        c: None,
    };
    let Some(object) = serde_json::from_slice::<serde_json::Value>(args)
        .ok()
        .and_then(|v| match v {
            serde_json::Value::Object(map) => Some(map),
            _ => None,
        })
    else {
        action.s = ActionStatus::InvalidJson;
        return action;
    };
    if object.len() > MAX_NUM_KEYS {
        action.s = ActionStatus::TooManyKeys;
        return action;
    }
    // serde_json's Map (without `preserve_order`) iterates keys in sorted order.
    for (key, value) in object {
        if key.len() > MAX_KEY_LENGTH {
            action.d.push((truncate_utf8(&key, 64), DropReason::KeyTooLong));
            continue;
        }
        let serialized = serde_json::to_string(&value).expect("serializing a JSON value");
        if serialized.len() > MAX_VALUE_LENGTH {
            action.d.push((key, DropReason::ValueTooLarge));
            continue;
        }
        action.r.push((key, serialized));
    }
    action
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn order_id_matches_upstream() {
        assert_eq!(compute_order_id(4, 5, 0), 400005000);
    }

    #[test]
    fn parse_rules() {
        let a = parse_action(1, None, "a.near".into(), br#"{"b": {"z": 1, "a": [2, 1]}, "a": null}"#);
        assert_eq!(a.s, ActionStatus::Ok);
        // Keys come out sorted, nested object keys are sorted, whitespace removed.
        assert_eq!(
            a.r,
            vec![
                ("a".to_string(), "null".to_string()),
                ("b".to_string(), r#"{"a":[2,1],"z":1}"#.to_string())
            ]
        );
        assert_eq!(parse_action(1, None, "a".into(), b"[1]").s, ActionStatus::InvalidJson);
        assert_eq!(parse_action(1, None, "a".into(), b"\xff").s, ActionStatus::InvalidJson);
        let many = serde_json::Value::Object((0..257).map(|i| (i.to_string(), 1.into())).collect());
        let a = parse_action(1, None, "a".into(), &serde_json::to_vec(&many).unwrap());
        assert_eq!(a.s, ActionStatus::TooManyKeys);
        assert!(a.r.is_empty());
    }

    #[test]
    fn drops_oversized_keys_and_values() {
        let long_key = "k".repeat(MAX_KEY_LENGTH + 1);
        let big = "x".repeat(MAX_VALUE_LENGTH); // serialized with quotes: +2
        let args = serde_json::json!({ long_key.clone(): 1, "big": big, "ok": 1 });
        let a = parse_action(1, None, "a".into(), &serde_json::to_vec(&args).unwrap());
        assert_eq!(a.r, vec![("ok".to_string(), "1".to_string())]);
        assert_eq!(
            a.d,
            vec![
                ("big".to_string(), DropReason::ValueTooLarge),
                ("k".repeat(64), DropReason::KeyTooLong)
            ]
        );
    }

    #[test]
    fn fastfs_headers() {
        let s = |x: &[u8]| [&(x.len() as u32).to_le_bytes()[..], x].concat();
        let simple = [&[0u8][..], &s(b"media/a.webp"), &[1], &s(b"image/webp"), &s(b"xyz")].concat();
        assert_eq!(
            parse_fastfs_header(&simple),
            Some(FastfsHeader { path: "media/a.webp".into(), offset: None, full_size: None, deleted: false })
        );
        let deleted = [&[0u8][..], &s(b"media/a.webp"), &[0]].concat();
        assert!(parse_fastfs_header(&deleted).unwrap().deleted);
        let partial = [
            &[1u8][..],
            &s(b"media/b.gif"),
            &(1u32 << 20).to_le_bytes(),
            &3_000_000u32.to_le_bytes(),
            &s(b"image/gif"),
            &s(b"chunk"),
            &7u32.to_le_bytes(),
        ]
        .concat();
        assert_eq!(
            parse_fastfs_header(&partial),
            Some(FastfsHeader { path: "media/b.gif".into(), offset: Some(1 << 20), full_size: Some(3_000_000), deleted: false })
        );
        assert_eq!(parse_fastfs_header(b"{\"json\":1}"), None);
        assert_eq!(parse_fastfs_header(&[0, 255, 255, 255, 255]), None);
    }

    #[test]
    fn numbers_keep_serde_json_semantics() {
        // Pinned: no arbitrary_precision. Big integers become floats, like upstream.
        let a = parse_action(1, None, "a".into(), br#"{"n": 1.50, "i": 18446744073709551616}"#);
        assert_eq!(a.r[0], ("i".to_string(), "1.8446744073709552e+19".to_string()));
        assert_eq!(a.r[1], ("n".to_string(), "1.5".to_string()));
    }
}
