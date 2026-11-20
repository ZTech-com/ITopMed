# Deployment and operations

Status (2026-11-13): the application is production-shaped and every item below exists in the repository, but **no production environment has been provisioned yet**. Hosting provider, domain, secret manager and monitoring are open decisions (see ROADMAP → external dependencies). Data must be hosted in Uzbekistan (personal-data localisation; confirm with counsel).

## 1. Topology
```
Internet ─ TLS reverse proxy / load balancer (sets X-Forwarded-For, HTTPS only, HSTS)
            ├─ Next.js app (npm run build && npm run start) × N   — stateless; any number of instances
            └─ Worker (npm run worker)                  × 1–2   — notification outbox, rate-limit housekeeping
Managed PostgreSQL 16+ (in-country) with point-in-time recovery
SMTP relay (email); SMS provider: not contracted yet (SMS stays off: SMS_TRANSPORT=none)
```
Rate limits live in PostgreSQL (`rate_limit_hit()`), so app instances need no shared cache. Health probe: `GET /api/health` (200 `{"status":"ok"}` / 503) — no versions or details.

## 1b. Single-computer installation on a clinic network (`npm run local`)
For a practice without a hosted server: one Windows/macOS/Linux computer runs the embedded PostgreSQL, the production build (`next start` on 127.0.0.1:3000), the worker and an HTTPS reverse proxy on 0.0.0.0:3443 (`scripts/local.ts`). The proxy overwrites `X-Forwarded-For` with the device address. TLS uses a private CA generated with OpenSSL in `.data/certs` (gitignored; the CA key never leaves the computer); every device trusts `itopmed-local-ca.crt` once. `LOCAL_MODE=1` allows the file mailbox in production when no `SMTP_URL` is set — never set it on an internet-facing deployment. Step-by-step: docs/QOLLANMA.md.

## 2. Database setup (once)
1. Create the four roles and the database: `scripts/sql/create-roles.sql` (passwords from the secret manager; see the header of the file).
2. Apply migrations as the owner: `MIGRATION_DATABASE_URL=… npx prisma migrate deploy`.
3. Seed reference data (plans): `npm run db:seed`.
4. Create the first platform administrator: `npm run admin:create -- --email … --name … --role SUPER_ADMIN` (they enrol TOTP at first sign-in and are asked to create recovery codes). Invite every further ITop Med employee from the console (Platform staff → Invite), not with the CLI.
5. Check: `tests/db-security.test.ts` expectations hold in production too — runtime roles must have `rolsuper = false`, `rolbypassrls = false`.

## 3. Environment (secrets from the secret manager — never in the repo or images)
| Variable | Notes |
|---|---|
| `NODE_ENV=production` | enables `__Host-` cookies, HSTS, refuses simulated transports |
| `APP_URL` | public https origin |
| `DATABASE_URL` | `itopmed_app` |
| `PLATFORM_DATABASE_URL` | `itopmed_platform` |
| `PORTAL_DATABASE_URL` | `itopmed_portal` |
| `MIGRATION_DATABASE_URL` | `itopmed_owner` — only for the migration job and backups, **not** given to the app containers |
| `APP_ENCRYPTION_KEY`, `AUDIT_HMAC_KEY` | 32 bytes base64 each; rotating them needs a re-encryption plan (TOTP secrets) |
| `BACKUP_ENCRYPTION_KEY` | 32 bytes base64; store separately from the backups |
| `EMAIL_TRANSPORT=smtp`, `SMTP_URL`, `EMAIL_FROM` | `dev-mailbox` is refused in production |
| `SMS_TRANSPORT=none` | `dev-outbox` is refused in production; no real provider yet |
| `RATE_LIMIT_STORE=database` | default |
| `DB_POOL_MAX` | per instance; keep `instances × pools(3) × DB_POOL_MAX` below the database connection limit |

## 4. Release procedure
1. `npm ci` · `npm run lint` · `npm run typecheck` · `npm test` · `npm run i18n:check` · `npm run build` — all must exit 0.
2. Review new migrations for `DROP` of hand-written objects (CLAUDE.md rule 2).
3. Take a backup (below), run `prisma migrate deploy`, then roll out app instances and the worker.
4. Smoke test: `/api/health`, admin sign-in with TOTP, one clinic sign-in.

## 5. Backups and restore (acceptance criterion 17)
* **Primary:** the managed database's automated backups with point-in-time recovery (retention per legal advice; at least 30 days suggested).
* **Secondary, provider-independent:** `npm run backup` (as the owner) writes an encrypted, consistent logical export `backups/itopmed-<time>.itmbk` (AES-256-GCM, gzip; manifest with migrations and row counts). Copy it to separate, access-controlled storage in Uzbekistan. Schedule daily.
* **Restore drill (monthly, and after every major release):** `npm run backup:verify -- <file>` restores into a throw-away PostgreSQL and verifies migrations, every row count, every tenant's audit hash chain and RLS on all tables; exit code 0 = restorable. Record the result.
* **Disaster recovery into a new, empty database:** `npm run backup:verify -- <file> --target-owner-url <owner url> --target-superuser-url <superuser url>` (loading needs a superuser because triggers are paused during the load, as with pg_dump). Then rotate all session-related secrets and force sign-in.
* Limits: the export is built in memory — fine for clinic-sized databases (tens of MB); for very large deployments rely on PITR/pg_dump and extend the tool to streaming.

## 6. Monitoring and incident basics
* Logs are structured JSON on stdout (`logger`, PHI-free) — ship them to the log platform; alert on `level=error`.
* Uptime check on `/api/health`; alert on 503.
* Watch the worker log line `worker.pass` (sent / failed / skipped notifications).
* Platform console → Audit → "Verify integrity" checks the audit hash chains on demand.
* Incident response outline: docs/SECURITY-AND-PRIVACY.md.

## 7. Linux server next to other projects (systemd + Nginx)

Used for `itopmed.itoppos.uz` (Ubuntu 20.04, Nginx + certbot already serving other sites).

1. On a Windows dev machine: `npm run package:linux` → `dist/itopmed-linux.tar.gz` (built here, so the server never runs a memory-hungry build).
2. Copy it and the installer: `scp dist/itopmed-linux.tar.gz scripts/deploy/server-install.sh scripts/deploy/itopmed-admin.sh root@SERVER:/root/`
3. On the server: `bash /root/server-install.sh /root/itopmed-linux.tar.gz DOMAIN` — the same command updates later.

What it creates (and nothing else): user `itopmed`; `/opt/itopmed` (own Node.js, releases, `current` symlink, last 3 kept); `/var/lib/itopmed/pg` (own PostgreSQL, `127.0.0.1:54329`); `/etc/itopmed/itopmed.env` (secrets, 0640 root:itopmed — back it up, without it backups cannot be decrypted); `/var/backups/itopmed` (daily 03:30, 14 kept); units `itopmed-db`, `itopmed-app` (`127.0.0.1:3100`, MemoryMax 1.2 G), `itopmed-worker`, `itopmed-backup.timer`; one Nginx site file for the domain (tested with `nginx -t`, then only reloaded) and a certbot certificate for that domain only. Nginx overwrites `X-Forwarded-For` with `$remote_addr` (the app trusts the first address).

- First SuperAdmin: `sudo /opt/itopmed/bin/itopmed-admin EMAIL "Full Name"` (asks for the password).
- Email is `EMAIL_TRANSPORT=disabled` until an SMTP account exists: set `EMAIL_TRANSPORT=smtp` and `SMTP_URL=…` in `/etc/itopmed/itopmed.env`, then `systemctl restart itopmed-app itopmed-worker`.
- Status/logs: `systemctl status itopmed-app` · `journalctl -u itopmed-app -n 100`.
- Rollback: point `/opt/itopmed/current` at the previous folder in `/opt/itopmed/releases` and restart the three services (migrations are additive; restore a backup if a migration must be undone).

### Automatic deploy from GitHub (`.github/workflows/deploy.yml`)
Every push to `main` (or "Run workflow" in the Actions tab): lint, typecheck, i18n, tests → `npm run package:linux` on GitHub's runner → the release is piped over SSH to the server. The deploy key's public half sits in root's `authorized_keys` with `command="/opt/itopmed/bin/itopmed-deploy"` (no shell, no forwarding): it can only hand over a release, which is size- and SHA-256-checked before the bundled installer runs. Repository secret needed: `DEPLOY_SSH_KEY` (private half). The installer puts `itopmed-deploy` in `/opt/itopmed/bin` (releases from 2026-11-20 on); on an older installation copy `scripts/deploy/itopmed-deploy.sh` there once by hand. Without it the workflow still checks and builds, and skips the deploy with a warning. The server's host key is pinned in the workflow.
