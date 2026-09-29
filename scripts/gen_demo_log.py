#!/usr/bin/env python3
"""Generates a synthetic social-kv/1 event log for local development and load tests.

    python3 scripts/gen_demo_log.py data-demo [--accounts 300] [--posts 6000]
    INDEXER=off DATA_DIR=data-demo cargo run --release -p near-social-server

Rows follow the FastData parse rules (sorted keys, compact JSON), so the server replays them
exactly as it would real chain data. Media points at a real FastFS file.
"""

import argparse
import json
import os
import random
import time

WORDS = (
    "near fastdata social build ship onchain agents rust nextjs kv indexer relayer wallet "
    "keys storage speed users posts likes follow graph design ux open protocol community "
    "hello world today launch shipping fast simple secure intents chain abstraction"
).split()
TAGS = ["near", "fastdata", "buildinpublic", "rust", "ai", "agents", "nearsocial", "web3", "defi", "gm"]
NAMES = ["Alice", "Bob", "Carol", "Dave", "Eve", "Frank", "Grace", "Heidi", "Ivan", "Judy", "Mallory",
         "Niaj", "Olivia", "Peggy", "Rupert", "Sybil", "Trent", "Victor", "Walter", "Yuki", "Zoe"]
MEDIA = [{"src": "fastfs://mob.near/fastfs.near/fastnear.png", "mime": "image/png", "w": 512, "h": 512, "alt": "FastNEAR logo"}]
# Start ~6 hours ago so "trending" (last 24h) has data.
T0_MS = int(time.time() * 1000) - 6 * 3600 * 1000


def compact(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def sentence(rng, accounts):
    words = rng.sample(WORDS, rng.randint(4, 18))
    if rng.random() < 0.3:
        words.insert(rng.randint(0, len(words)), "#" + rng.choice(TAGS))
    if rng.random() < 0.2:
        words.insert(rng.randint(0, len(words)), "@" + rng.choice(accounts))
    if rng.random() < 0.05:
        words.append("https://near.org")
    text = " ".join(words).capitalize() + rng.choice([".", "!", "?", " 🚀", ""])
    if rng.random() < 0.08:
        text += "\n\n" + " ".join(rng.sample(WORDS, 30)) * rng.randint(2, 6)
    return text


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("out_dir")
    ap.add_argument("--accounts", type=int, default=300)
    ap.add_argument("--posts", type=int, default=6000)
    ap.add_argument("--seed", type=int, default=7)
    ap.add_argument("--start-block", type=int, default=200_000_000)
    ap.add_argument("--whale", action="store_true", help="add whale.near following up to 5000 accounts")
    args = ap.parse_args()
    rng = random.Random(args.seed)

    accounts = [f"{rng.choice(NAMES).lower()}{i}.near" for i in range(args.accounts)]
    popular = accounts[:15]
    posts = []  # (author, id)
    blocks = []
    height = args.start_block
    ms = T0_MS
    tx_counter = 0

    def emit(actions):
        nonlocal height, ms, tx_counter
        acts = []
        for i, (author, kv) in enumerate(actions):
            tx_counter += 1
            acts.append({"o": 400000000 + i * 1000, "tx": f"demo{tx_counter}", "p": author, "s": "ok",
                         "r": [[k, compact(v)] for k, v in sorted(kv.items())]})
        blocks.append({"b": height, "t": ms * 1_000_000, "a": acts})
        height += rng.randint(1, 4)
        ms += rng.randint(600, 4000)

    # Profiles
    for chunk in range(0, len(accounts), 20):
        batch = []
        for a in accounts[chunk:chunk + 20]:
            kv = {"profile/name": a.split(".")[0].rstrip("0123456789").capitalize() + " " + a[-7:-5],
                  "profile/about": sentence(rng, accounts)}
            if rng.random() < 0.3:
                kv["profile/avatar"] = "fastfs://mob.near/fastfs.near/fastnear.png"
            if rng.random() < 0.3:
                kv["profile/links/github"] = a.split(".")[0]
            if rng.random() < 0.2:
                kv["profile/location"] = rng.choice(["Lisbon", "Berlin", "NYC", "Kyiv", "Singapore"])
            batch.append((a, kv))
        emit(batch)

    # Follows: power-law-ish
    for a in accounts:
        targets = set(rng.sample(popular, rng.randint(3, 12))) | set(rng.sample(accounts, rng.randint(0, 25)))
        targets.discard(a)
        emit([(a, {f"graph/follow/{t}": {} for t in sorted(targets)})])

    if args.whale:
        targets = accounts[:5000]
        for chunk in range(0, len(targets), 250):
            emit([("whale.near", {f"graph/follow/{t}": {} for t in targets[chunk:chunk + 250]})])

    # Activity
    next_id = {}
    for _ in range(args.posts):
        author = rng.choice(popular) if rng.random() < 0.3 else rng.choice(accounts)
        pid = next_id.get(author, ms)
        pid = max(pid, ms) + 1
        next_id[author] = pid
        kv = {}
        r = rng.random()
        body = {"text": sentence(rng, accounts)}
        if r < 0.35 and posts:
            pa, pi = rng.choice(posts[-400:])
            body["reply_to"] = f"{pa}/{pi}"
            body["root"] = f"{pa}/{pi}"
            kv[f"reply/{pa}/{pi}/{pid}"] = {}
        elif r < 0.42 and posts:
            qa, qi = rng.choice(posts[-400:])
            body["quote"] = f"{qa}/{qi}"
        if rng.random() < 0.07:
            body["media"] = MEDIA
        kv[f"post/{pid}"] = body
        actions = [(author, kv)]
        # Some likes/reposts in the same block
        for _ in range(rng.randint(0, 4)):
            if posts:
                liker = rng.choice(accounts)
                ta, ti = rng.choice(posts[-300:])
                actions.append((liker, {f"like/{ta}/{ti}": {}}))
        if rng.random() < 0.08 and posts:
            ta, ti = rng.choice(posts[-300:])
            actions.append((rng.choice(accounts), {f"repost/{ta}/{ti}": {}}))
        posts.append((author, pid))
        emit(actions)

    os.makedirs(args.out_dir, exist_ok=True)
    log_path = os.path.join(args.out_dir, "kv.jsonl")
    with open(log_path, "w") as f:
        for b in blocks:
            f.write(json.dumps(b, separators=(",", ":"), ensure_ascii=False) + "\n")
    with open(os.path.join(args.out_dir, "checkpoint.json"), "w") as f:
        json.dump({"block_height": blocks[-1]["b"], "log_len": os.path.getsize(log_path)}, f)
    print(f"wrote {len(blocks)} blocks, {len(posts)} posts, {len(accounts)} accounts to {log_path}")
    print("sample accounts:", ", ".join(popular[:5]))


if __name__ == "__main__":
    main()
