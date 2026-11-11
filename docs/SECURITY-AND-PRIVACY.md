# Security and privacy

Status legend: ✅ implemented & tested · 🟡 partial · ⏳ planned

## Controls
| Control | Status | Where |
|---|---|---|
| Tenant isolation via PostgreSQL RLS + tenant context per transaction | ✅ | migration `security_foundation`; `tests/tenant-isolation.test.ts` |
| Deny-by-default grants; runtime roles without BYPASSRLS/superuser | ✅ | `tests/db-security.test.ts` |
| Platform role cannot read password hashes, MFA secrets, sessions (and future clinical tables) | ✅ | column-level grants |
| Server-side authorization on every page/action/service | ✅ | `auth/guards.ts`, service checks |
| argon2id password hashing, password policy | ✅ | `security/password.ts` |
| Account lockout + rate limiting | 🟡 | DB lockout ✅; rate limit in-memory (Redis ⏳) |
| MFA (TOTP) for platform staff and privileged clinic roles | ✅ | `platform-auth.ts`, `clinic-auth.ts` |
| Session expiry (absolute + idle), revocation, rotation after MFA | ✅ | |
| HttpOnly, Secure, SameSite cookies, `__Host-` prefix in production | ✅ | `auth/cookies.ts` |
| CSRF | ✅ | SameSite cookies + Next.js server-action Origin check |
| XSS | ✅ | React escaping, nonce CSP with `strict-dynamic`, escaped email HTML |
| SQL injection | ✅ | Prisma + tagged-template raw SQL only |
| IDOR | ✅ | RLS hides foreign rows even when queried by id (tested) |
| Security headers (CSP, HSTS, XFO, nosniff, Referrer, Permissions) | ✅ | `src/proxy.ts`, `next.config.ts` |
| Secrets at rest (AES-256-GCM with AAD) | ✅ | `security/crypto.ts` |
| Tamper-evident append-only audit (hash chain; UPDATE/DELETE/TRUNCATE blocked even for owner) | ✅ | trigger + `audit_verify_chain` |
| PHI-free audit metadata and logs | ✅ | `assertSafeMetadata`, `logger` |
| Invitations single-use, expiring, hash-only, rotated on resend | ✅ | `tenancy/*` |
| Break-glass support access (request → clinic approval → time-boxed → audited) | ✅ | `support/access.ts`; CLINICAL_READ hard-disabled (`CLINICAL_SUPPORT_ACCESS_ENABLED = false`) |
| Self-service password reset (single-use, 30 min, hash-only, newest link only, revokes all sessions, no account enumeration) | ✅ | `auth/password-reset.ts` |
| Role editor guardrails (owner role immutable; clinical-permission grants flagged in audit) | ✅ | `clinic/roles.ts` |
| Member access guardrails (no self-change, only owners change owners, at least one active owner) | ✅ | `clinic/members.ts` |
| Open-redirect protection for post-login `next` | ✅ | `lib/safe-next.ts` |
| Branch scope (ABAC): branch-restricted members only see/change resources of their branches | ✅ | `clinic/context.ts` (`assertBranch`, `branchWhere`); tested |
| Operational tables (rooms, services, schedules) granted to the clinic role only — none to the platform role | ✅ | migration `clinic_resources_scheduling` |
| Staff absences stored as categories only (no free-text health information about employees) | ✅ | `ScheduleExceptionKind` |
| Read-access audit for medical records (`emr.viewed`, `emr.access_denied`, `emr.break_glass`, `patient.viewed`) | ✅ | `emr/access.ts`, `patients.ts` |
| Care-relationship ABAC for the EMR (doctor: visit within 365 days back / 30 ahead; nurse: visit today in own branch; head doctor: oversight) | ✅ | `emr/access.ts`; tested |
| Break-the-glass: POST-only, reason category (no free text in the audit trail), 10-minute patient-scoped cookie | ✅ | `care-actions.ts` |
| Signed notes immutable and undeletable at database level; tamper evidence via SHA-256 content hash shown in the UI | ✅ | trigger `clinical_note_guard`; tested incl. owner-level tampering |
| No deletion grants on clinical tables; corrections via status (`ENTERED_IN_ERROR`) or amendments | ✅ | migration `patients_appointments_emr` |
| Clinical and patient tables have no grants for the platform role | ✅ | tested |
| Search terms and clinical text never written to logs or audit metadata | ✅ | |
| Laboratory: four-eyes verification (verifier ≠ person who entered results) in the service **and** as a DB CHECK; verified results immutable by trigger; lab staff work from the order and patient header only — no EMR access; values hidden from the clinical views until verified; no lab tables granted to the platform role | ✅ | `lab/lab.ts`, migration `laboratory`; tested |
| Protected document storage + short-lived URLs | ⏳ | Phase 6 |
| Encrypted backups, PITR, tested restores | ⏳ | infrastructure, Phase 9 |
| Dependency / SAST / secret scanning in CI | ⏳ | Phase 9 (`npm audit` currently reports advisories in dev dependencies — review) |
| Security monitoring, incident runbook | ⏳ | Phase 9 |
| Export / retention / deletion policies | ⏳ | needs legal input |

## Emergency (break-glass) support access
1. Platform SUPPORT staff file a `SupportAccessGrant` (scope CONFIGURATION / OPERATIONAL / CLINICAL_READ, reason ≥ 10 chars, ticket, 5–480 minutes).
2. The platform DB role **cannot** approve it (no UPDATE grant — tested). Only a clinic user with `support_access.decide` (owner) approves or denies.
3. While active, support acts through the clinic path with the grant id in context; every access is audited; automatic expiry.
4. CLINICAL_READ stays disabled until the legal assessment below is complete.

## Data handling rules
* No real patient data in development, tests, screenshots or AI prompts. Test data uses `*.test` domains.
* Email/SMS/Telegram never carry diagnoses, results or clinical details — only "sign in to view".
* Clinical content is never machine-translated and never sent to external AI providers without legal basis, agreements and security review.
* Logs/analytics/error tracking contain identifiers only.

## Uzbekistan legal requirements — to be confirmed by counsel
Engineering checklist, **not legal advice**; each item needs sign-off from a qualified Uzbek lawyer.
* Law "On Personal Data" (ZRU-547, 2019, as amended), including the data-localisation requirement for citizens' personal data processed with IT systems and registration of personal-data databases.
* Medical confidentiality under health-protection legislation.
* Ministry of Health rules on electronic medical records, DMED / Digital Health Platform obligations, retention periods.
* Controller/processor roles between ITop Med and clinics; data-processing agreements.
* A documented legal basis per purpose — consent is not assumed to cover everything:

| Purpose | Data | Proposed basis (to confirm) |
|---|---|---|
| Providing care, EMR | health data | law / medical necessity |
| Appointment reminders | name, phone, time | contract / legitimate interest, opt-out |
| Billing | identity, services, payments | contract / tax law |
| Staff accounts & audit | staff identity, activity | employment / legal obligation |
| Platform analytics | aggregated, de-identified | legitimate interest |
| Marketing | contacts | explicit consent only |

Hosting and cross-border transfer are configurable (`Tenant.dataResidency`, default `UZ`); any change needs a documented assessment.

## Incident response (outline)
Detect (lockouts, RLS errors, audit-chain failures) → triage within 1 h → contain (revoke sessions, suspend tenant, rotate keys) → assess personal-data impact → notify clinics/authorities as legally required → post-mortem.
