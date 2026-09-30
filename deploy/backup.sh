#!/usr/bin/env bash
# Snapshots the indexer state (event log + checkpoint) to a tarball. Safe while running: the
# checkpoint is read before the log, and the log only grows, so a restore always has at least
# the bytes the checkpoint refers to (the server truncates the rest on boot).
# Usage: deploy/backup.sh [/path/to/backups]   (e.g. from cron, then ship the file off-host)
set -euo pipefail
DATA_DIR=${DATA_DIR:-/var/lib/near-social/data}
DEST=${1:-/var/backups/near-social}
install -d -m 750 "$DEST"
out="$DEST/near-social-$(date -u +%Y%m%dT%H%M%SZ).tar.gz"
tar -czf "$out" -C "$DATA_DIR" checkpoint.json kv.jsonl
ls -1t "$DEST"/near-social-*.tar.gz | tail -n +15 | xargs -r rm -f
echo "$out"
