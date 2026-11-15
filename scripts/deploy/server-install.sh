#!/usr/bin/env bash
# ITop Med on a Linux server (Ubuntu 20.04+), next to other projects.
#   sudo bash server-install.sh /path/to/itopmed-linux.tar.gz itopmed.example.uz admin@example.uz
#
# Touches ONLY its own things:
#   user "itopmed", /opt/itopmed (program + its own Node), /var/lib/itopmed (database),
#   /etc/itopmed (settings, 0600), /var/backups/itopmed, systemd units itopmed-*,
#   and ONE new Nginx site file for the given domain. Existing sites, Node, pm2,
#   MongoDB etc. are not changed. Nginx is tested (nginx -t) and only reloaded.
# Safe to run again for updates: keeps settings and data, swaps the release,
# applies migrations, restarts only itopmed-* services. The previous release
# stays in /opt/itopmed/releases for rollback.
set -euo pipefail

TARBALL="${1:?release tarball}"
DOMAIN="${2:?domain}"
CERT_EMAIL="${3:-}"
NODE_VERSION="v24.11.0"
APP_PORT=3100
DB_PORT=54329
BASE=/opt/itopmed
HOME_DIR=/var/lib/itopmed
ETC=/etc/itopmed
BACKUPS=/var/backups/itopmed
STAMP="$(date -u +%Y%m%d%H%M%S)"

log() { echo "▸ $*"; }
run_as() { runuser -u itopmed -- "$@"; }

# Refuse to take ports another program already uses (on updates they are our own services).
for p in $APP_PORT $DB_PORT; do
  if ss -ltn | grep -q ":$p " && ! systemctl is-active --quiet itopmed-app itopmed-db; then
    echo "Port $p is already used by another program; nothing was changed." >&2
    ss -ltnp | grep ":$p " >&2
    exit 1
  fi
done

log "User and folders"
id itopmed >/dev/null 2>&1 || useradd --system --home-dir "$HOME_DIR" --shell /usr/sbin/nologin itopmed
install -d -o itopmed -g itopmed -m 0750 "$HOME_DIR" "$BACKUPS"
install -d -o root -g root -m 0755 "$BASE" "$BASE/releases"
install -d -o root -g itopmed -m 0750 "$ETC"

log "Own Node.js $NODE_VERSION (the server's Node is not changed)"
if [ ! -x "$BASE/node/bin/node" ] || [ "$("$BASE/node/bin/node" -v)" != "$NODE_VERSION" ]; then
  tmp="$(mktemp -d)"
  ( cd "$tmp"
    curl -fsSLO "https://nodejs.org/dist/$NODE_VERSION/node-$NODE_VERSION-linux-x64.tar.xz"
    curl -fsSLO "https://nodejs.org/dist/$NODE_VERSION/SHASUMS256.txt"
    grep " node-$NODE_VERSION-linux-x64.tar.xz\$" SHASUMS256.txt | sha256sum -c -
    tar -xJf "node-$NODE_VERSION-linux-x64.tar.xz" )
  rm -rf "$BASE/node" && mv "$tmp/node-$NODE_VERSION-linux-x64" "$BASE/node" && rm -rf "$tmp"
fi
NODE="$BASE/node/bin/node"
NPM="$BASE/node/bin/npm"

log "Release $STAMP"
REL="$BASE/releases/$STAMP"
mkdir -p "$REL"
tar -xzf "$TARBALL" -C "$REL"
( cd "$REL" && PATH="$BASE/node/bin:$PATH" "$NPM" install --omit=dev --no-audit --no-fund --loglevel=error )
chown -R root:itopmed "$REL" && chmod -R g+rX,o-rwx "$REL"
# The PostgreSQL package sets the execute bit on its own binaries at start: it must own them.
chown -R itopmed:itopmed "$REL/node_modules/@embedded-postgres"
# The app may write its own cache; nothing else in the release is writable by it.
install -d -o itopmed -g itopmed -m 0750 "$REL/app/.next-pkg/cache"

log "Settings (created once, kept on updates)"
if [ ! -f "$ETC/itopmed.env" ]; then
  pw() { head -c 18 /dev/urandom | base64 | tr '+/' '-_' | tr -d '='; }
  key() { head -c 32 /dev/urandom | base64; }
  S="$(pw)"; O="$(pw)"; A="$(pw)"; P="$(pw)"; R="$(pw)"
  umask 077
  cat > "$ETC/itopmed.env" <<EOF
NODE_ENV=production
APP_URL=https://$DOMAIN
PORT=$APP_PORT
HOSTNAME=127.0.0.1
ITM_HOME=$HOME_DIR
ITM_BACKUP_DIR=$BACKUPS
DEV_PG_PORT=$DB_PORT
DEV_PG_SUPERUSER_PASSWORD=$S
DEV_PG_OWNER_PASSWORD=$O
DEV_PG_APP_PASSWORD=$A
DEV_PG_PLATFORM_PASSWORD=$P
DEV_PG_PORTAL_PASSWORD=$R
MIGRATION_DATABASE_URL=postgresql://itopmed_owner:$O@127.0.0.1:$DB_PORT/itopmed
DATABASE_URL=postgresql://itopmed_app:$A@127.0.0.1:$DB_PORT/itopmed
PLATFORM_DATABASE_URL=postgresql://itopmed_platform:$P@127.0.0.1:$DB_PORT/itopmed
PORTAL_DATABASE_URL=postgresql://itopmed_portal:$R@127.0.0.1:$DB_PORT/itopmed
APP_ENCRYPTION_KEY=$(key)
AUDIT_HMAC_KEY=$(key)
BACKUP_ENCRYPTION_KEY=$(key)
EMAIL_TRANSPORT=disabled
SMS_TRANSPORT=none
TELEGRAM_TRANSPORT=api
NEXT_TELEMETRY_DISABLED=1
EOF
  chown root:itopmed "$ETC/itopmed.env" && chmod 0640 "$ETC/itopmed.env"
fi

ln -sfn "$REL" "$BASE/current.new" && mv -Tf "$BASE/current.new" "$BASE/current"
PGBIN="$BASE/current/node_modules/@embedded-postgres/linux-x64/native/bin"

log "systemd units"
cat > /etc/systemd/system/itopmed-db.service <<EOF
[Unit]
Description=ITop Med PostgreSQL (port $DB_PORT, localhost only)
After=network.target

[Service]
Type=simple
User=itopmed
Group=itopmed
ExecStart=$PGBIN/postgres -D $HOME_DIR/pg -p $DB_PORT -c listen_addresses=127.0.0.1 -c io_method=sync
ExecReload=/bin/kill -HUP \$MAINPID
KillMode=mixed
KillSignal=SIGINT
TimeoutStopSec=60
Restart=always
RestartSec=3
MemoryMax=900M

[Install]
WantedBy=multi-user.target
EOF
for svc in app worker; do
  if [ "$svc" = app ]; then exe="$BASE/current/app/server.js"; desc="web app (127.0.0.1:$APP_PORT)"; mem=1200M; else exe="$BASE/current/app/worker.mjs"; desc="notification worker"; mem=400M; fi
  cat > /etc/systemd/system/itopmed-$svc.service <<EOF
[Unit]
Description=ITop Med $desc
After=network.target itopmed-db.service
Requires=itopmed-db.service

[Service]
Type=simple
User=itopmed
Group=itopmed
WorkingDirectory=$BASE/current/app
EnvironmentFile=$ETC/itopmed.env
ExecStart=$NODE $exe
Restart=always
RestartSec=3
MemoryMax=$mem
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=full
ProtectHome=true
ReadWritePaths=$HOME_DIR $BACKUPS $BASE/current/app/.next-pkg/cache

[Install]
WantedBy=multi-user.target
EOF
done
cat > /etc/systemd/system/itopmed-backup.service <<EOF
[Unit]
Description=ITop Med encrypted backup
After=itopmed-db.service
Requires=itopmed-db.service

[Service]
Type=oneshot
User=itopmed
Group=itopmed
WorkingDirectory=$BASE/current/app
EnvironmentFile=$ETC/itopmed.env
ExecStart=$NODE $BASE/current/app/tasks.mjs backup
EOF
cat > /etc/systemd/system/itopmed-backup.timer <<EOF
[Unit]
Description=ITop Med daily backup (03:30 server time)

[Timer]
OnCalendar=*-*-* 03:30:00
Persistent=true

[Install]
WantedBy=timers.target
EOF
systemctl daemon-reload

log "Database"
if [ ! -f "$HOME_DIR/pg/PG_VERSION" ]; then
  ( set -a; . "$ETC/itopmed.env"; set +a; cd "$BASE/current/app"; runuser -p -u itopmed -- "$NODE" tasks.mjs db-init )
fi
systemctl enable --now itopmed-db.service
for i in $(seq 1 30); do (exec 3<>"/dev/tcp/127.0.0.1/$DB_PORT") 2>/dev/null && break; sleep 1; done
( set -a; . "$ETC/itopmed.env"; set +a; cd "$BASE/current/app"; runuser -p -u itopmed -- "$NODE" tasks.mjs migrate )

log "Starting the app and worker"
systemctl enable itopmed-app.service itopmed-worker.service itopmed-backup.timer >/dev/null
systemctl restart itopmed-app.service itopmed-worker.service
systemctl start itopmed-backup.timer
for i in $(seq 1 60); do curl -fs "http://127.0.0.1:$APP_PORT/api/health" >/dev/null && break; sleep 1; done
curl -fs "http://127.0.0.1:$APP_PORT/api/health" && echo

log "Nginx site for $DOMAIN only"
SITE="/etc/nginx/sites-available/$DOMAIN"
if [ ! -f "$SITE" ]; then
  cat > "$SITE" <<EOF
# ITop Med ($DOMAIN) - added by scripts/deploy/server-install.sh; other sites are separate files.
server {
    listen 80;
    listen [::]:80;
    server_name $DOMAIN;
    client_max_body_size 2m;

    location / {
        proxy_pass http://127.0.0.1:$APP_PORT;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        # Overwrite (never append): the app trusts the first address for rate limits and audit.
        proxy_set_header X-Forwarded-For \$remote_addr;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_set_header X-Forwarded-Host \$host;
        proxy_read_timeout 120s;
    }
}
EOF
  ln -sfn "$SITE" "/etc/nginx/sites-enabled/$DOMAIN"
  if ! nginx -t; then rm -f "/etc/nginx/sites-enabled/$DOMAIN"; echo "nginx -t failed: site removed, nothing reloaded" >&2; exit 1; fi
  systemctl reload nginx
fi

log "HTTPS certificate for $DOMAIN only"
if ! certbot certificates 2>/dev/null | grep -q "Domains: $DOMAIN\$\|Domains: $DOMAIN "; then
  certbot --nginx -d "$DOMAIN" --non-interactive --redirect ${CERT_EMAIL:+-m "$CERT_EMAIL"} --agree-tos --keep-until-expiring
fi
nginx -t && systemctl reload nginx

log "Helper commands"
install -d -m 0755 "$BASE/bin"
install -m 0755 "$(dirname "$0")/itopmed-admin.sh" "$BASE/bin/itopmed-admin" 2>/dev/null || true
install -m 0755 "$(dirname "$0")/itopmed-clinic.sh" "$BASE/bin/itopmed-clinic" 2>/dev/null || true

log "Old releases (keep the latest 3)"
ls -1dt "$BASE"/releases/* | tail -n +4 | xargs -r rm -rf

log "Done: https://$DOMAIN  ($(cat "$BASE/current/RELEASE"))"
