//! Key grammar of social-kv/1 (STANDARD.md §3).

use crate::model::account_id::is_valid_account_id;

pub const MAX_POST_ID: u64 = (1 << 53) - 1;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum ProfileField {
    Name,
    About,
    Avatar,
    Banner,
    Location,
}

#[derive(Debug, PartialEq, Eq)]
pub enum Key<'a> {
    Profile(ProfileField),
    ProfileLink(&'a str),
    Post(u64),
    /// `reply/{parent_account}/{parent_id}/{id}`: valid, but not used by this indexer.
    ReplyLink,
    Like(&'a str, u64),
    Repost(&'a str, u64),
    Follow(&'a str),
    /// A key outside the standard (or a reserved/future one). Ignored.
    Unknown,
    /// A key inside a known namespace that doesn't follow the grammar.
    Invalid(&'static str),
}

/// `^[1-9][0-9]{0,15}$` and ≤ 2^53 − 1.
pub fn parse_post_id(s: &str) -> Option<u64> {
    let b = s.as_bytes();
    if b.is_empty() || b.len() > 16 || b[0] == b'0' || !b.iter().all(u8::is_ascii_digit) {
        return None;
    }
    s.parse::<u64>().ok().filter(|&id| id <= MAX_POST_ID)
}

/// Parses a post reference `"{account_id}/{post_id}"`.
pub fn parse_post_ref(s: &str) -> Option<(&str, u64)> {
    let (account, id) = s.split_once('/')?;
    if !is_valid_account_id(account) {
        return None;
    }
    Some((account, parse_post_id(id)?))
}

fn is_valid_service(s: &str) -> bool {
    (1..=32).contains(&s.len())
        && s
            .bytes()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == b'_')
}

pub fn parse_key(key: &str) -> Key<'_> {
    let Some((ns, rest)) = key.split_once('/') else {
        return Key::Unknown;
    };
    match ns {
        "profile" => match rest {
            "name" => Key::Profile(ProfileField::Name),
            "about" => Key::Profile(ProfileField::About),
            "avatar" => Key::Profile(ProfileField::Avatar),
            "banner" => Key::Profile(ProfileField::Banner),
            "location" => Key::Profile(ProfileField::Location),
            _ => match rest.strip_prefix("links/") {
                Some(service) if is_valid_service(service) => Key::ProfileLink(service),
                Some(_) => Key::Invalid("link service must match [a-z0-9_]{1,32}"),
                None => Key::Unknown,
            },
        },
        "post" => match parse_post_id(rest) {
            Some(id) => Key::Post(id),
            None => Key::Invalid("invalid post id"),
        },
        "reply" => match rest.rsplit_once('/') {
            Some((parent, id))
                if parse_post_ref(parent).is_some() && parse_post_id(id).is_some() =>
            {
                Key::ReplyLink
            }
            _ => Key::Invalid("expected reply/{account}/{post_id}/{post_id}"),
        },
        "like" | "repost" => match parse_post_ref(rest) {
            Some((account, id)) if ns == "like" => Key::Like(account, id),
            Some((account, id)) => Key::Repost(account, id),
            None => Key::Invalid("expected {account}/{post_id}"),
        },
        "graph" => match rest.strip_prefix("follow/") {
            Some(account) if is_valid_account_id(account) => Key::Follow(account),
            Some(_) => Key::Invalid("invalid account id"),
            None => Key::Unknown,
        },
        _ => Key::Unknown,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn post_ids() {
        assert_eq!(parse_post_id("1759140000000"), Some(1759140000000));
        assert_eq!(parse_post_id("9007199254740991"), Some(MAX_POST_ID));
        for bad in ["", "0", "01", "9007199254740992", "12a", "-1", "99999999999999999"] {
            assert_eq!(parse_post_id(bad), None, "{bad}");
        }
    }

    #[test]
    fn keys() {
        assert_eq!(parse_key("profile/name"), Key::Profile(ProfileField::Name));
        assert_eq!(parse_key("profile/links/github"), Key::ProfileLink("github"));
        assert!(matches!(parse_key("profile/links/Git"), Key::Invalid(_)));
        assert_eq!(parse_key("profile/pronouns"), Key::Unknown);
        assert_eq!(parse_key("post/12"), Key::Post(12));
        assert!(matches!(parse_key("post/012"), Key::Invalid(_)));
        assert_eq!(parse_key("like/bob.near/12"), Key::Like("bob.near", 12));
        assert_eq!(parse_key("repost/bob.near/12"), Key::Repost("bob.near", 12));
        assert!(matches!(parse_key("like/bob.near"), Key::Invalid(_)));
        assert_eq!(parse_key("reply/bob.near/12/13"), Key::ReplyLink);
        assert!(matches!(parse_key("reply/bob.near/12"), Key::Invalid(_)));
        assert_eq!(parse_key("graph/follow/bob.near"), Key::Follow("bob.near"));
        assert!(matches!(parse_key("graph/follow/Bob"), Key::Invalid(_)));
        assert_eq!(parse_key("graph/mute/bob.near"), Key::Unknown);
        assert_eq!(parse_key("profile"), Key::Unknown);
        assert_eq!(parse_key("whatever/x"), Key::Unknown);
    }
}
