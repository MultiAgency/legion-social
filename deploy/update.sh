#!/usr/bin/env bash
# Updates a deployed near.social server from this checkout: pulls the latest code, rebuilds and
# restarts only what changed (API and/or web), then checks that both are healthy.
#
#   deploy/update.sh                       pull, rebuild what changed since the last deploy
#   deploy/update.sh server|web|all        pull, rebuild that part regardless
#   deploy/update.sh --no-pull [...]       use the checkout as it is (e.g. after rsync)
#   deploy/update.sh --rollback [server|web]   go back to the previous build (default: both)
#
# Run on the server, from the repository root, as the deploy user (uses sudo).
set -euo pipefail
cd "$(dirname "$0")/.."

PREFIX=/opt/near-social
ETC=/etc/near-social
PULL=1
ROLLBACK=0
TARGET=auto
for arg in "$@"; do
  case "$arg" in
    --no-pull) PULL=0 ;;
    --rollback) ROLLBACK=1 ;;
    server | web | all) TARGET=$arg ;;
    -h | --help) sed -n '2,11p' "$0"; exit 0 ;;
    *) echo "Unknown argument: $arg (see --help)" >&2; exit 2 ;;
  esac
done

env_port() { sudo sed -n 's/^PORT=//p' "$1" 2>/dev/null | tail -n 1; }
API_PORT=$(env_port "$ETC/server.env"); API_PORT=${API_PORT:-3040}
WEB_PORT=$(env_port "$ETC/web.env"); WEB_PORT=${WEB_PORT:-3030}

# Waits up to ~60 s for both services to answer. Prints the indexer lag.
health() {
  local api=0 web=0
  for _ in $(seq 1 30); do
    if [ "$api" = 0 ] && curl -fsS -o /dev/null "http://127.0.0.1:$API_PORT/v1/status"; then api=1; fi
    if [ "$web" = 0 ] && curl -fsS -o /dev/null "http://127.0.0.1:$WEB_PORT/"; then web=1; fi
    [ "$api" = 1 ] && [ "$web" = 1 ] && break
    sleep 2
  done
  if [ "$api" = 1 ]; then
    local status
    status=$(curl -fsS "http://127.0.0.1:$API_PORT/v1/status" || true)
    echo "API (:$API_PORT): OK, block $(grep -o '"last_block_height":[0-9]*' <<<"$status" | cut -d: -f2)," \
      "lag $(grep -o '"lag_ms":[0-9]*' <<<"$status" | cut -d: -f2) ms"
  fi
  [ "$web" = 1 ] && echo "Web (:$WEB_PORT): OK"
  if [ "$api" = 1 ] && [ "$web" = 1 ]; then return 0; fi
  [ "$api" = 1 ] || { echo "API is NOT responding. Last logs:" >&2; sudo journalctl -u near-social-server -n 30 --no-pager >&2; }
  [ "$web" = 1 ] || { echo "Web is NOT responding. Last logs:" >&2; sudo journalctl -u near-social-web -n 30 --no-pager >&2; }
  return 1
}

rollback() {
  local what=${TARGET/auto/all}
  if [ "$what" = all ] || [ "$what" = server ]; then
    if [ -f "$PREFIX/bin/near-social-server.prev" ]; then
      echo "==> Rolling back the API to the previous build"
      sudo install -m 755 "$PREFIX/bin/near-social-server.prev" "$PREFIX/bin/near-social-server"
      sudo rm -f "$PREFIX/deployed-server.commit" # the next update rebuilds it
      sudo systemctl restart near-social-server
    else
      echo "No previous API build to roll back to." >&2
    fi
  fi
  if [ "$what" = all ] || [ "$what" = web ]; then
    local current previous
    current=$(readlink -f "$PREFIX/web")
    previous=$(ls -1dt "$PREFIX"/web-releases/* 2>/dev/null | grep -vxF "$current" | head -n 1 || true)
    if [ -n "$previous" ]; then
      echo "==> Rolling back the web app to $(basename "$previous")"
      sudo ln -sfn "$previous" "$PREFIX/web"
      sudo rm -f "$PREFIX/deployed-web.commit"
      sudo systemctl restart near-social-web
    else
      echo "No previous web release to roll back to." >&2
    fi
  fi
}

if [ "$ROLLBACK" = 1 ]; then
  rollback
  health
  exit
fi

IS_GIT=0
git rev-parse --is-inside-work-tree >/dev/null 2>&1 && IS_GIT=1

# 1. Pull the latest code.
if [ "$PULL" = 1 ] && [ "$IS_GIT" = 1 ]; then
  if [ -n "$(git status --porcelain --untracked-files=no)" ]; then
    echo "The checkout has local changes. Commit or stash them, or run with --no-pull." >&2
    exit 1
  fi
  echo "==> git pull"
  git pull --ff-only
elif [ "$PULL" = 1 ]; then
  echo "Not a git checkout: using the files as they are." >&2
fi

# Files changed since the commit a part was last deployed from ("*" = unknown, rebuild).
changed_since() {
  local file="$PREFIX/deployed-$1.commit" last
  if [ "$IS_GIT" = 0 ] || [ ! -f "$file" ]; then echo "*"; return; fi
  last=$(cat "$file")
  if ! git cat-file -e "$last^{commit}" 2>/dev/null; then echo "*"; return; fi
  git diff --name-only "$last" HEAD
  # Uncommitted edits (e.g. after rsync) count as changes too.
  git diff --name-only HEAD
}

# 2. Decide what to rebuild. The API embeds SKILL.md and docs/{STANDARD,API}.md.
if [ "$TARGET" = auto ]; then
  server_changed=$(changed_since server | grep -E '^\*$|^server/|^Cargo\.(toml|lock)$|^SKILL\.md$|^docs/(STANDARD|API)\.md$|^deploy/systemd/near-social-server' || true)
  web_changed=$(changed_since web | grep -E '^\*$|^web/|^deploy/systemd/near-social-web' || true)
  if [ -n "$server_changed" ] && [ -n "$web_changed" ]; then
    TARGET=all
  elif [ -n "$server_changed" ]; then
    TARGET=server
  elif [ -n "$web_changed" ]; then
    TARGET=web
  else
    echo "Already up to date ($(git rev-parse --short HEAD 2>/dev/null || echo 'no git'))."
    health
    exit
  fi
fi

# 3. Things this script doesn't apply on its own.
if [ "$IS_GIT" = 1 ] && [ -f "$PREFIX/deployed-server.commit" ] &&
  git diff --name-only "$(cat "$PREFIX/deployed-server.commit")" HEAD 2>/dev/null | grep -q '^deploy/nginx/'; then
  echo "NOTE: deploy/nginx/ changed. Review it, then: sudo cp deploy/nginx/near-social.conf /etc/nginx/sites-available/ && sudo nginx -t && sudo systemctl reload nginx"
fi
for pair in "server.env.example:server.env" "web.env.example:web.env"; do
  example="deploy/${pair%%:*}" actual="$ETC/${pair##*:}"
  sudo test -f "$actual" || continue
  missing=$(comm -23 <(grep -oE '^[A-Z_]+=' "$example" | tr -d '=' | sort -u) \
    <(sudo grep -oE '^[A-Z_]+=' "$actual" | tr -d '=' | sort -u) | tr '\n' ' ')
  [ -n "${missing// /}" ] && echo "NOTE: $actual lacks settings from $example: $missing(defaults apply)"
done

# 4. Build, install, restart.
echo "==> Updating: $TARGET"
deploy/deploy.sh "$TARGET"

# 5. Check.
echo "==> Health"
if ! health; then
  echo "Update finished but a service is unhealthy. To go back: deploy/update.sh --rollback $TARGET" >&2
  exit 1
fi
echo "==> Done ($(git rev-parse --short HEAD 2>/dev/null || echo 'no git'))"
