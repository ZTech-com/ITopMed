# Roadmap, status and external dependencies

## Phase status (as of 2026-11-11)
| Phase | Scope | Status |
|---|---|---|
| 1 | Foundation, design system, localization, docs | ✅ done (catalogs need native-speaker review) |
| 2 | Super Admin auth and platform administration | ✅ core done — login, mandatory TOTP, sessions, dashboard, clinics, audit + integrity check, staff list. ⏳ platform-staff invitations UI, announcements, support tickets, global settings |
| 3 | Clinic provisioning, onboarding, secure owner invitations | ✅ done — atomic provisioning, invitations (resend/revoke), lifecycle, modules, plan change, owner activation + clinic settings/branches |
| 4 | Tenant isolation, users, roles, permissions | ✅ done (2026-11-11) — staff invitations incl. existing accounts joining more clinics, password reset, role editor (custom roles, locked owner role), member access (roles, branch scope, suspend/restore/remove) with owner/self/last-owner guardrails, break-glass request → clinic approval → expiry/revocation. ⏳ MFA recovery codes / admin MFA reset, platform-staff invitation UI |
| 5 | Admin, receptionist, doctor workspaces | ✅ done (2026-11-11) — role-aware dashboard (operations + setup for admins, front desk "who works today", "My day" for doctors), services & prices (exact money), departments & rooms, doctor profiles, weekly schedules with overlap prevention, absences, services per doctor, availability engine (time-zone/DST-safe slots), branch-scope enforcement. Appointments/queue themselves are Phase 6 |
| 6 | Patients, appointments, queue, EMR | ⏳ |
| 7 | Billing, payments, reports | ⏳ |
| 8 | Other staff workspaces, patient portal, integrations | ⏳ |
| 9 | Security tests, accessibility, performance, backup, production readiness | ⏳ |

## Acceptance criteria
| # | Criterion | Status |
|---|---|---|
| 1 | Super Admin logs in securely | ✅ automated + browser |
| 2 | Creates a clinic | ✅ |
| 3 | Isolated tenant/workspace | ✅ |
| 4 | Owner receives secure invitation | ✅ (email SIMULATED via dev mailbox; SMTP transport ready, not configured) |
| 5 | Owner activates and configures clinic | ✅ |
| 6 | Clinic creates staff with individual roles | ✅ |
| 7–11 | Patients, appointments, notes, billing, reports | ⏳ Phases 5–7 |
| 12 | Clinic A cannot access Clinic B | ✅ for all current tables |
| 13 | Unauthorised users cannot view clinical records | 🟡 owner/admin lack `emr.read`; enforcement tests come with EMR |
| 14 | Critical actions audited | ✅ for current actions |
| 15 | Four languages on major screens | ✅ for built screens (machine-assisted translations need review) |
| 16 | Desktop/tablet/phone | 🟡 responsive layout; real-device testing pending |
| 17 | Backup restore + security tests | ⏳ needs infrastructure |

## Known limitations
* Rate limiting is per-process memory (Redis needed before scaling out).
* Email delivery is simulated in development; production requires SMTP configuration.
* Platform staff have no self-service password reset (by design: a SUPER_ADMIN or the CLI resets them). Lost-authenticator recovery is not built yet.
* Approved support grants are recorded and checked by `getActiveGrant`, but no platform screen uses them yet — operational support views will consume them in Phase 6+.
* Slot availability does not yet subtract booked appointments (no appointments exist until Phase 6); the engine already accepts busy intervals.
* Specialty list and service catalog conventions need review by the clinical advisor (MoH nomenclature).
* `npm audit` reports advisories in the dependency tree — review and resolve before production.
* Project lives in a OneDrive folder; `node_modules` syncing can be slow — consider a non-synced path.

## External dependencies and decisions needed
**Legal**
* Uzbek counsel: Personal Data Law compliance, localisation, database registration, legal basis per purpose, controller/processor contracts, medical confidentiality, retention periods.
* Terms of service, privacy policy, DPA template for clinics.

**Medical**
* Clinical advisor to validate workflows, templates, MoH forms, prescription rules, result release rules.
* Native-speaker and medical-terminology review of uz-Latn, uz-Cyrl and ru texts.

**Infrastructure**
* Hosting in Uzbekistan (provider choice), managed PostgreSQL with PITR, object storage, Redis, secret manager, backups and DR drills, monitoring, domain + TLS.
* SMTP/SMS provider accounts.

**Integrations**
* UZINFOCOM / DMED / Digital Health Platform: official specs, test access, agreements.
* Payme / Click merchant agreements; fiscal receipt requirements.

**Business**
* Pricing and plan limits (seeded plan prices are placeholders = 0).
* Support model and SLAs; who may hold SUPER_ADMIN.
