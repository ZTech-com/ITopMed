# ITop Med — engineering guide for Claude Code and contributors

Multi-tenant healthcare SaaS (Uzbekistan first). ONE codebase, strict tenant isolation.
Read `docs/ARCHITECTURE.md` and `docs/SECURITY-AND-PRIVACY.md` before changing anything security-relevant.

## Stack
Next.js 16 App Router · React 19 · TypeScript strict · Tailwind v4 · PostgreSQL + Prisma 7 (driver adapter `@prisma/adapter-pg`) · next-intl 4 · Zod 4 · argon2id (`@node-rs/argon2`) · TOTP (`@oslojs/otp`) · Vitest.

## Commands
| Task | Command |
|---|---|
| Start local PostgreSQL (embedded, no Docker) | `npm run db:start` (keep running) |
| Apply migrations / seed plans | `npm run db:migrate` · `npm run db:seed` |
| Create a platform admin | `npm run admin:create -- --email x@y --name "Name" --role SUPER_ADMIN` |
| Dev server | `npm run dev` → http://localhost:3000/admin/login and /login |
| Notification worker | `npm run worker` (or `-- --once`); clinics can also "Send due messages now" |
| Checks (run all after every change) | `npm run lint` · `npm run typecheck` · `npm test` · `npm run i18n:check` · `npm run build` |

Tests boot their own throw-away PostgreSQL on port 54339 and apply the real migrations.

## Non-negotiable rules
1. **Tenant isolation.** Clinic data is only ever read/written through `withAppContext()` (`src/server/db.ts`) with `tenantId` + `userId`. Never use the platform client for clinic workflows.
2. **Every new table** ships, in the same migration, with: explicit `GRANT`s for `itopmed_app` / `itopmed_platform`, `ENABLE ROW LEVEL SECURITY`, and policies. `tests/db-security.test.ts` fails if RLS is missing.
   - Some policies deliberately expose a user's *own* rows across clinics (e.g. `Membership` for the clinic switcher). When querying such tables inside a clinic, **always add an explicit `tenantId` filter** as well.
   - Prisma does not model hand-written SQL (RLS policies, exclusion constraints, trigram indexes, triggers). **Review every generated migration** and delete any `DROP` of those objects before applying it.
   - Page loaders must use helpers whose permissions match every role that can open the page (e.g. `listOperationalBranches`, not the admin-only `listBranches`).
3. **Patient portal data only through `withPortal()`** (role `itopmed_portal`). Its policies derive the patient from the session hash in PostgreSQL; every new table a patient may see needs explicit column grants and `portal_*` policies, and clinical notes/diagnoses are never granted to it. Use explicit `select`s and `updateMany`/`createMany` there (column grants break Prisma's `RETURNING *`).
4. **Clinical tables are never granted to `itopmed_platform`.** Platform staff do not read medical records. Break-glass access goes through `SupportAccessGrant` (clinic approval, time-limited, audited).
5. **Authorization on the server, every time:** pages call `requirePlatform()` / `requireClinic(slug, permission)` / `requirePatient(slug)`; services re-check permissions. Deny by default. UI hiding is cosmetic.
6. **Audit** every security-relevant or clinical action with `recordAudit()` inside the same transaction. Audit metadata must never contain clinical content, secrets or tokens.
7. **No PHI in logs, URLs, emails, notifications, analytics or error trackers.** Use IDs, not content. Use `logger` (redacting), never `console.log` in app code.
8. **No hard-coded UI text.** Add keys to all four catalogs in `messages/` (`uz-Latn` default, `uz-Cyrl`, `ru`, `en`). Clinical record content is never machine-translated.
9. **Never** store plaintext passwords/tokens, email passwords, commit secrets, or use real patient data (tests, screenshots, prompts). Synthetic data only (`*.test` domains).
10. **Timestamps are UTC** (`timestamp(3)` columns; DB timezone pinned to UTC). Use `now() AT TIME ZONE 'UTC'` in raw SQL.
11. **One transaction = one connection.** Never `Promise.all` queries on the same `tx`; use `sequential([...])` from `src/server/db.ts` (Prisma queries are lazy, so they run in order).
12. **Be honest about status.** Mark simulated/prototype functionality as such (e.g. `dev-mailbox` email and `dev-outbox` SMS transports, the Integrations status page, modules with `status: "planned"`). Don't call a feature done without tests.

## Layout
- `prisma/schema.prisma`, `prisma/migrations/*` (RLS/grants/audit SQL lives in migrations)
- `src/server/` — domain services (no React): `auth/`, `authz/`, `tenancy/`, `clinic/`, `security/`, `audit.ts`, `db.ts`
- `src/app/admin/` platform console · `src/app/c/[slug]/` clinic workspace · `src/app/p/[slug]/` patient portal · `src/app/(public)/` login, MFA, invitations
- `src/components/ui` design system · `src/components/shell` app chrome
- `docs/` product, architecture, security, roadmap
