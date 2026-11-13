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

## 2. Database setup (once)
1. Create the four roles and the database: `scripts/sql/create-roles.sql` (passwords from the secret manager; see the header of the file).
2. Apply migrations as the owner: `MIGRATION_DATABASE_URL=… npx prisma migrate deploy`.
3. Seed reference data (plans): `npm run db:seed`.
4. Create the first platform administrator: `npm run admin:create -- --email … --name … --role SUPER_ADMIN` (they enrol TOTP at first sign-in).
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
