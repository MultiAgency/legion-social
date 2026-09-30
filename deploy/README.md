# Deploying near.social (systemd + nginx + Cloudflare)

```
browser / agents ──▶ Cloudflare ──▶ nginx :443 ─┬─ near.social      ──▶ near-social-web    127.0.0.1:3030  (Next.js)
                                                └─ api2.near.social ──▶ near-social-server 127.0.0.1:3040  (Rust API + indexer)
near-social-server ──▶ mainnet.neardata.xyz (blocks), rpc.mainnet.fastnear.com, api.near.social (legacy SocialDB API, for import)
near-social-web     ──▶ 127.0.0.1:3040 (SSR), legacy.near.social (/magic proxy)
```

| What | Where |
|---|---|
| API binary | `/opt/near-social/bin/near-social-server` |
| Web app | `/opt/near-social/web` → `/opt/near-social/web-releases/<timestamp>` |
| Config | `/etc/near-social/server.env` (secret: 640), `/etc/near-social/web.env` |
| **State (back it up)** | `/var/lib/near-social/data/{kv.jsonl,checkpoint.json}` |
| Image cache | `/var/cache/near-social-web` |
| Units | `near-social-server.service`, `near-social-web.service` |
| Logs | `journalctl -u near-social-server -f`, `journalctl -u near-social-web -f` |

The examples use `near.social` for the site and `api2.near.social` for the API (`api.near.social`
is the legacy SocialDB API, which the server reads during migration). To use other
hosts, change `PUBLIC_URL` (server.env), `NEXT_PUBLIC_API_URL` / `NEXT_PUBLIC_SITE_URL`
(web.env) and the `server_name`s in the nginx config.

## 1. Server prerequisites

These instructions assume Ubuntu 22.04 or 24.04.

```bash
sudo apt update
sudo apt install -y build-essential pkg-config libssl-dev git curl nginx
# Rust ≥ 1.91 (rustup, as your deploy user)
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y && . ~/.cargo/env
# Node.js 22 LTS (NodeSource puts node in /usr/bin, which the unit expects)
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - && sudo apt install -y nodejs
```

- **Memory:** building the NEAR crates needs about 4 GB of RAM. Add swap on a small VPS.
- **Build on the server, or on the same OS and CPU architecture:** the web app's image optimizer
  (`sharp`) is a native module.

## 2. Get the code onto the server

```bash
git clone <your-remote> ~/near-social-kv      # or: rsync -a --exclude target --exclude node_modules --exclude .next --exclude 'data*' ./ server:~/near-social-kv/
cd ~/near-social-kv
```

## 3. Cloudflare

1. **DNS:** add `A`/`AAAA` records for `near.social`, `www` and `api2`, pointing to the server.
   Set them to **Proxied** (orange cloud).
2. **SSL/TLS:** set the mode to **Full (strict)**, and turn on **Always Use HTTPS**.
3. **SSL/TLS → Origin Server:** create an Origin Certificate for `near.social, *.near.social`
   and save it on the server:

   ```bash
   sudo install -d -m 700 /etc/ssl/cloudflare
   sudo nano /etc/ssl/cloudflare/near.social.pem   # certificate
   sudo nano /etc/ssl/cloudflare/near.social.key   # private key (chmod 600)
   ```
4. **Recommended:** add a rate-limiting rule for `api2.near.social`, for example
   600 requests / minute / IP.
5. **Live updates (`/v1/stream`):** no configuration needed. The API sends it uncompressed with
   `Cache-Control: no-transform`, so Cloudflare streams it through, and a ping every 15 s keeps
   it under Cloudflare's 100 s idle timeout.
6. **Caching:** the defaults are fine. Hashed `/_next/static/*` assets are cached; pages and API
   JSON are not.

## 4. nginx

```bash
sudo deploy/nginx/update-cloudflare-ips.sh                 # writes /etc/nginx/snippets/cloudflare-realip.conf
sudo cp deploy/nginx/near-social.conf /etc/nginx/sites-available/
sudo ln -s /etc/nginx/sites-available/near-social.conf /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx
```

- On nginx ≥ 1.25, you can replace `listen 443 ssl http2;` with `listen 443 ssl;` plus `http2 on;`.
- **Firewall:** only 80 and 443 need to be open. Both services listen on 127.0.0.1. Optionally,
  allow 443 only from Cloudflare's IP ranges.

## 5. First deploy

```bash
deploy/deploy.sh          # 1st run: creates the service user, /etc/near-social/*.env and the units, then stops
sudo nano /etc/near-social/server.env    # FASTNEAR_AUTH_BEARER_TOKEN=…, PUBLIC_URL
sudo nano /etc/near-social/web.env       # NEXT_PUBLIC_API_URL / NEXT_PUBLIC_SITE_URL
deploy/deploy.sh          # builds both, installs, (re)starts, prints the API status
```

On its first start, the indexer backfills from `START_BLOCK_HEIGHT`. With the FastNEAR key this
takes about a minute. From then on it resumes from its checkpoint.

**Optional warm start:** copy an existing data directory before the first start:

```bash
sudo install -d -o nearsocial -g nearsocial /var/lib/near-social/data
sudo rsync -a ./data/ /var/lib/near-social/data/ && sudo chown -R nearsocial:nearsocial /var/lib/near-social
```

## 6. Check it

```bash
curl -s https://api2.near.social/v1/status        # lag_ms should stay at a few seconds
curl -sI https://near.social/ | head -1
curl -sI "https://near.social/mob.near/widget/ProfilePage?accountId=root.near" | grep -i location   # → legacy.near.social
curl -s https://near.social/magic/img/account/root.near                                            # legacy avatar URL
curl -s https://near.social/skill.md | head -5
```

## Operations

- **Update:**

  ```bash
  git pull && deploy/deploy.sh             # or: deploy/deploy.sh server | web
  ```
- **Roll back the web app:**

  ```bash
  ls -1t /opt/near-social/web-releases
  sudo ln -sfn /opt/near-social/web-releases/<previous> /opt/near-social/web && sudo systemctl restart near-social-web
  ```

  The previous 3 releases are kept.
- **Back up:**

  ```bash
  sudo deploy/backup.sh /var/backups/near-social
  ```

  Schedule it from cron (for example hourly), then copy the tarballs off the server (for example
  with rclone to R2 or S3). It's safe while the server runs. To restore, stop the server,
  extract the tarball into `/var/lib/near-social/data` and start it again. Without a backup, the
  server re-indexes from `START_BLOCK_HEIGHT`, which gets slower as the chain grows.
- **Monitor:** alert when `lag_ms` in `/v1/status` stays above about 60 s, or when a unit restarts
  repeatedly (`systemctl status`).
- **Hide spam accounts:**
  1. Put one account ID per line in `/etc/near-social/denylist.txt`.
  2. Set `DENYLIST_PATH=/etc/near-social/denylist.txt` in `server.env`.
  3. Restart the server once. After that, edits to the file are picked up automatically within
     30 s.
- **Change ports** (defaults 3040 for the API, 3030 for the web app):
  - Web app: set `PORT` in `web.env`.
  - API: set `PORT` in `server.env`, and update `API_INTERNAL_URL` in `web.env` to match.

  Then update the matching `upstream` in the nginx config, reload nginx, and restart the service.
  Neither needs a rebuild.
- **Change web build settings:** anything in `web.env` except `API_INTERNAL_URL` is compiled in
  at build time. After editing it, run `deploy/deploy.sh web`.
