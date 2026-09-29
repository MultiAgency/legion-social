/// Validates a NEAR account ID: 2..=64 chars of `[a-z0-9._-]`, where separators (`.`, `-`, `_`)
/// can't start or end the ID or follow another separator.
pub fn is_valid_account_id(s: &str) -> bool {
    let bytes = s.as_bytes();
    if bytes.len() < 2 || bytes.len() > 64 {
        return false;
    }
    let mut prev_separator = true; // start counts as a separator: no leading separator
    for &c in bytes {
        match c {
            b'a'..=b'z' | b'0'..=b'9' => prev_separator = false,
            b'.' | b'-' | b'_' => {
                if prev_separator {
                    return false;
                }
                prev_separator = true;
            }
            _ => return false,
        }
    }
    !prev_separator
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn account_ids() {
        for ok in [
            "social",
            "alice.near",
            "a1",
            "bob_b.tg",
            "x-y.z.near",
            "0000000000000000000000000000000000000000000000000000000000000000",
        ] {
            assert!(is_valid_account_id(ok), "{ok}");
        }
        for bad in [
            "a",
            "",
            "Alice.near",
            ".near",
            "alice.",
            "a..b",
            "a-.b",
            "a b",
            "alice@near",
            "00000000000000000000000000000000000000000000000000000000000000000",
        ] {
            assert!(!is_valid_account_id(bad), "{bad}");
        }
    }
}
