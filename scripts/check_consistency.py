#!/usr/bin/env python3
"""Diffs the latest value of every key in the server's event log against the public FastData
KV API (https://kv.main.fastnear.com), byte for byte.

    python3 scripts/check_consistency.py DATA_DIR RECEIVER [--api https://kv.main.fastnear.com]
      [--from-block N] [--to-block N]

Only keys whose latest write falls in [from, to] are compared (default: the whole log).
Exit code 1 on any mismatch.
"""

import argparse
import json
import sys
import urllib.request


def fetch_latest(api, receiver):
    """All (predecessor, key) -> (block_height, raw value) for the receiver."""
    out = {}
    token = None
    while True:
        body = {"limit": 200}
        if token:
            body["page_token"] = token
        req = urllib.request.Request(
            f"{api}/v0/latest/{receiver}",
            data=json.dumps(body).encode(),
            headers={"content-type": "application/json"},
        )
        for attempt in range(3):
            try:
                page = json.load(urllib.request.urlopen(req, timeout=30))
                break
            except Exception:
                if attempt == 2:
                    raise
        for e in page["entries"]:
            raw = json.dumps(e["value"], separators=(",", ":"), ensure_ascii=False)
            out[(e["predecessor_id"], e["key"])] = (e["block_height"], raw)
        token = page.get("page_token")
        if not token:
            return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("data_dir")
    ap.add_argument("receiver")
    ap.add_argument("--api", default="https://kv.main.fastnear.com")
    ap.add_argument("--from-block", type=int, default=0)
    ap.add_argument("--to-block", type=int, default=1 << 62)
    args = ap.parse_args()

    ours = {}
    with open(f"{args.data_dir}/kv.jsonl") as f:
        for line in f:
            block = json.loads(line)
            for action in block["a"]:
                for key, value in action.get("r", []):
                    ours[(action["p"], key)] = (block["b"], value)

    theirs = fetch_latest(args.api, args.receiver)
    in_range = lambda h: args.from_block <= h <= args.to_block
    mismatches = 0
    compared = 0
    for k in sorted(set(ours) | set(theirs)):
        o, t = ours.get(k), theirs.get(k)
        if not ((o and in_range(o[0])) or (t and in_range(t[0]))):
            continue
        compared += 1
        # The API re-serializes values through its own JSON layer; compare parsed values too.
        same = o and t and o[0] == t[0] and (o[1] == t[1] or json.loads(o[1]) == json.loads(t[1]))
        if not same:
            mismatches += 1
            print(f"MISMATCH {k}: ours={o and (o[0], o[1][:80])} theirs={t and (t[0], t[1][:80])}")
    print(f"compared {compared} keys, {mismatches} mismatches")
    sys.exit(1 if mismatches else 0)


if __name__ == "__main__":
    main()
