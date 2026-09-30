#!/usr/bin/env bash
# Builds near.social (API + web) from this checkout and installs it as systemd services.
# Run from the repository root as a user with sudo: deploy/deploy.sh [server|web|all]
set -euo pipefail

TARGET=${1:-all}
PREFIX=/opt/near-social
ETC=/etc/near-social
SVC_USER=nearsocial
KEEP_RELEASES=3
cd "$(dirname "$0")/.."

# One-time setup: service user, directories, config templates, systemd units.
if ! id -u "$SVC_USER" >/dev/null 2>&1; then
  sudo useradd --system --home-dir /var/lib/near-social --shell /usr/sbin/nologin "$SVC_USER"
fi
sudo install -d -m 755 "$PREFIX" "$PREFIX/bin" "$PREFIX/web-releases"
sudo install -d -m 750 -o root -g "$SVC_USER" "$ETC"
created=0
if ! sudo test -f "$ETC/server.env"; then
  sudo install -m 640 -o root -g "$SVC_USER" deploy/server.env.example "$ETC/server.env"
  echo "Created $ETC/server.env (add FASTNEAR_AUTH_BEARER_TOKEN, check PUBLIC_URL)." >&2
  created=1
fi
if [ ! -f "$ETC/web.env" ]; then
  sudo install -m 644 deploy/web.env.example "$ETC/web.env"
  echo "Created $ETC/web.env (check the URLs)." >&2
  created=1
fi
sudo install -m 644 deploy/systemd/near-social-server.service deploy/systemd/near-social-web.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable near-social-server near-social-web >/dev/null
if [ "$created" = 1 ]; then
  echo "Review the config files above, then run deploy/deploy.sh again." >&2
  exit 1
fi

# Remembers which commit each part was built from, so deploy/update.sh rebuilds only what changed.
record_commit() {
  if git rev-parse --verify HEAD >/dev/null 2>&1; then
    git rev-parse HEAD | sudo tee "$PREFIX/deployed-$1.commit" >/dev/null
  fi
}

if [ "$TARGET" = all ] || [ "$TARGET" = server ]; then
  echo "==> Building the API"
  cargo build --release --locked -p near-social-server
  # Keep the previous build for `deploy/update.sh --rollback`.
  if [ -f "$PREFIX/bin/near-social-server" ]; then
    sudo cp -p "$PREFIX/bin/near-social-server" "$PREFIX/bin/near-social-server.prev"
  fi
  # `install` replaces the file (no "text file busy"); the running process keeps the old inode.
  sudo install -m 755 target/release/near-social-server "$PREFIX/bin/near-social-server"
  sudo systemctl restart near-social-server
  record_commit server
fi

if [ "$TARGET" = all ] || [ "$TARGET" = web ]; then
  echo "==> Building the web app"
  node_bin=$(command -v node) || { echo "node is not in PATH" >&2; exit 1; }
  echo "    node $(node --version) ($node_bin)"
  set -a; . "$ETC/web.env"; set +a
  (cd web && npm ci && NEXT_OUTPUT=standalone npm run build)
  release="$PREFIX/web-releases/$(date -u +%Y%m%d%H%M%S)"
  sudo install -d -m 755 "$release"
  sudo cp -a web/.next/standalone/. "$release/"
  sudo install -d -m 755 "$release/.next"
  sudo cp -a web/.next/static "$release/.next/static"
  [ -d web/public ] && sudo cp -a web/public "$release/public"
  # Persistent image-optimization cache (systemd CacheDirectory).
  sudo rm -rf "$release/.next/cache"
  sudo ln -s /var/cache/near-social-web "$release/.next/cache"
  sudo ln -sfn "$release" "$PREFIX/web"
  # The service runs this copy of the node that built the app (nvm installs live under /home,
  # which the service can't see).
  sudo install -m 755 "$(readlink -f "$node_bin")" "$PREFIX/bin/node"
  sudo systemctl restart near-social-web
  record_commit web
  # Keep the newest releases for quick rollback (re-point the symlink and restart).
  ls -1dt "$PREFIX"/web-releases/* | tail -n +$((KEEP_RELEASES + 1)) | xargs -r sudo rm -rf
fi

# Ports from the env files (defaults 3040 / 3030).
env_port() { sudo sed -n 's/^PORT=//p' "$1" | tail -n 1; }
api_port=$(env_port "$ETC/server.env"); api_port=${api_port:-3040}
web_port=$(env_port "$ETC/web.env"); web_port=${web_port:-3030}

sleep 2
systemctl --no-pager --lines=0 status near-social-server near-social-web || true
echo "==> API status (:$api_port)"; curl -fsS "http://127.0.0.1:$api_port/v1/status" || echo "(API not responding yet)"
echo; echo "==> Web (:$web_port)"; curl -fsS -o /dev/null -w "HTTP %{http_code}\n" "http://127.0.0.1:$web_port/" || echo "(web not responding yet)"
