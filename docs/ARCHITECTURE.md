# Architecture

## 1. Shape: modular monolith
One Next.js application, one PostgreSQL database, clear module boundaries. No microservices until a measured need exists.

```
Browser / PWA ──HTTPS──▶ Reverse proxy (TLS, X-Forwarded-For) ──▶ Next.js (App Router)
                                                                   ├─ src/proxy.ts        CSP nonce, headers (no authz here)
                                                                   ├─ src/app/**          pages + server actions (thin)
                                                                   └─ src/server/**       domain services (authz, rules, transactions)
                                                                          ├─ appDb      → role itopmed_app       (RLS enforced)
                                                                          └─ platformDb → role itopmed_platform  (no clinical grants)
                                                                   PostgreSQL ◀── migrations as itopmed_owner
Future: Redis (rate limits, jobs), object storage (documents), job worker, native apps via the same service layer exposed as a versioned API.
```

### Layers
| Layer | Location | Responsibility |
|---|---|---|
| Presentation | `src/app`, `src/components` | Rendering, forms, i18n. No business rules. |
| Actions | `src/app/**/actions.ts` | Parse `FormData`, call one service, map errors to `FormState`. |
| Domain services | `src/server/**` | Authorization, validation (Zod), transactions, audit. Framework-free → testable and reusable by a future REST API for mobile apps. |
| Data | Prisma + SQL migrations | Schema, RLS policies, grants, triggers. |

## 2. Multi-tenancy
* Shared database, shared schema, `tenantId` column on every clinic-owned row.
* **Row-Level Security** is the isolation boundary, not application code. `withAppContext({tenantId,userId,sessionId})` opens a transaction and calls `set_config('app.tenant_id', …, true)`; policies compare rows against `app_current_tenant()`. Transaction-local settings cannot leak across pooled connections (tested).
* Clinic URL: `/c/{slug}` (path-based). Subdomains (`{slug}.itopmed.uz`) can be added at the proxy later without changing the data model.
* Tenant status (TRIAL/ACTIVE usable; SUSPENDED/ARCHIVED blocked) is checked on every clinic request in `resolveClinic`.

### Database roles
| Role | Used by | Can do |
|---|---|---|
| `itopmed_owner` | migrations only | owns schema; not used at runtime |
| `itopmed_app` | clinic workspaces, patient portal | RLS-scoped access to tenant tables; reads `User` only for self/co-members; login via `SECURITY DEFINER` lookup |
| `itopmed_platform` | ITop Med console | tenants, plans, subscriptions, modules, invitations; column-limited `User` read; **no** sessions, password hashes, MFA secrets or clinical tables; can request but not approve support access |

## 3. Identity and sessions
* Two separate realms: `PlatformUser` (ITop Med staff) and `User` (clinic staff/patients) — separate tables, cookies (`itm_admin` SameSite=Strict, `itm_session` Lax; `__Host-` prefix in production) and session tables. A clinic session can never be elevated to platform access.
* Opaque 160-bit session tokens; only SHA-256 hashes stored. Absolute + idle expiry (platform 8 h / 30 min, clinic 12 h / 60 min), revocation, rotation after MFA.
* Passwords: argon2id (OWASP parameters). Lockout after 5 failures (15 min) + per-IP/per-email rate limits.
* MFA: TOTP, mandatory for all platform staff and clinic roles `clinic_owner`, `clinic_admin`, `accountant`. Secrets AES-256-GCM encrypted with context binding.
* Invitations: single-use, 72 h, hash-only storage, rotated on resend. Passwords are chosen by the invitee, never emailed.

*Decision:* sessions are implemented on maintained primitives (Oslo, argon2) following the Lucia v3 reference design, because packaged auth libraries did not fit two realms + RLS context + break-glass. WebAuthn/passkeys or SSO (OIDC) would be added through this same session layer.

## 4. Authorization
* RBAC: permission catalog + 12 role templates (`src/server/authz/permissions.ts`) copied into every clinic; clinics may customise their copies (UI pending).
* ABAC (Phases 5–6): care-relationship checks for EMR, branch scoping (`Membership.allBranches` + `MembershipBranch`), head-doctor oversight with audited reason.
* Administrative roles do **not** include `emr.read`.

## 5. Modules / feature flags
`src/server/modules/catalog.ts` lists modules; `TenantModule` rows enable them per clinic (seeded from the plan). New module = folder in `src/server/<module>`, routes under `/c/[slug]/<module>`, migration with RLS, catalog entry. No forks per clinic.

## 6. Localization
next-intl without a locale in the URL. Resolution: account preference → language chosen in this browser → clinic default → `uz-Latn`. Catalog parity enforced by `npm run i18n:check` and a test. Dates/numbers via `Intl` (Node full-ICU supports `uz-Cyrl`).

## 7. PWA and devices
Manifest + service worker that caches **only** hashed static assets — never HTML, actions or documents. All pages send `Cache-Control: no-store`. The PWA is not a native app; native iOS/Android clients will call a versioned API wrapping the same domain services (Phase 8+).

## 8. Rate limiting, jobs, storage (planned)
* Rate limiter is in-memory (**single instance only**) — move the store to Redis before horizontal scaling.
* Background jobs (reminders, email retries, integration sync): Redis-backed queue in a separate worker, outbox table for at-least-once delivery.
* Medical files: S3-compatible storage hosted per the data-residency decision, encryption, short-lived signed URLs, audited access.

## 9. Observability
Structured JSON logs with key-based redaction. Production: centralised logs, metrics, alerts on lockouts/RLS errors, scheduled audit-chain verification, error tracking with PHI scrubbing.
