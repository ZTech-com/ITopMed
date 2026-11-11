# Test plan

All tests use synthetic data only. Integration tests boot an isolated embedded PostgreSQL (port 54339), apply the real migrations and seed plans.

## Automated today (`npm test` — 69 tests, all passing)
| File | Covers |
|---|---|
| `tests/db-security.test.ts` | RLS on every table; runtime roles cannot bypass RLS; role separation (platform cannot read hashes/MFA/sessions, cannot approve support grants); no rows without tenant context; audit append-only for all roles incl. owner; hash chain verifies |
| `tests/tenant-isolation.test.ts` | Acceptance 12: clinic A cannot resolve B; reads scoped; IDOR by id returns nothing; cross-tenant insert rejected by RLS; cross-tenant update affects 0 rows; no context leak between pooled transactions |
| `tests/provisioning.test.ts` | Acceptance 1 (password + mandatory TOTP, session rotation, lockout, no account enumeration); 2–5 (atomic provisioning, duplicate/reserved slugs, role checks, MFA requirement, single-use invitation, owner configures clinic, audit trail); token rotation on resend; expired invites; 6 (staff invitation, role-limited permissions, owner role not grantable by admin); suspension/reactivation; module flags |
| `tests/security-primitives.test.ts` | argon2id, password policy, AES-GCM context binding, tokens, UUIDv7, IP pseudonymisation, audit metadata guard, input validation |
| `tests/phase4.test.ts` | Existing accounts joining a second clinic (identity proof, wrong-account rejection, per-clinic roles); duplicate-member invite blocked; clinic login lockout (regression); password reset (superseded links, single use, expiry, session revocation); role editor (custom roles, locked owner role, in-use protection, effect on members, permission check); member access (roles, branch scope, suspend/restore/remove, self/owner/last-owner guardrails, cross-clinic IDs); support access (disabled clinical scope, role checks, approval, time box, revocation) |
| `tests/availability.test.ts` | Time-zone conversion (Tashkent, DST in Berlin), weekdays, HH:MM parsing, slot generation (alignment, block end, exceptions, busy and past slots), overlap detection, money parsing |
| `tests/phase5.test.ts` | Services (exact money, duplicate codes, invalid prices, price change, read vs manage permissions); doctor profiles (doctor role required); weekly schedules (cross-branch overlap, room/branch mismatch, exceptions, slots, who-works-today); doctors see only their own schedule; services per doctor; branch-scope enforcement for branch managers; permission data migration for existing clinics |
| `tests/phase6.test.ts` | Registry (sequential MRNs, duplicate detection by phone/similar name/identifier, blocking identical PINFL, birth-date validation), smart search (MRN, typo, phone, PINFL, date), audited views without personal data in metadata; booking (concurrent double-booking race → exactly one wins, overlap, slot removal, cancellation frees slot, absences, past), working-hours boundaries, front desk vs owner permissions, check-in queue numbers, walk-ins, own-day view for doctors; EMR access (denied → audited, break-glass, care relationship, other doctor, head-doctor oversight), nurse access by today's visit, vitals ranges; visit workflow (start, idempotency, draft, assessment required, sign, DB-level immutability even for the owner, amendments, finish, tamper detection); platform role cannot read clinical tables; cross-clinic isolation; operational branch list per role |
| `tests/i18n.test.ts` | Four catalogs: identical keys, no empty values, matching placeholders, no Cyrillic in uz-Latn |

## Manually verified in the browser (2026-11-11, dev build)
Admin login → MFA enrolment → dashboard; clinic creation with localized validation error and preserved input; invitation from dev mailbox; language switch (ru, uz-Cyrl) and theme switch; owner activation → login → MFA → clinic dashboard; staff page; unknown clinic → 404; unauthenticated → redirect; CSP and `no-store` headers; narrow-width layout without horizontal overflow (true device widths still to be checked).

### Phase 6 browser walkthrough (2026-11-11)
Receptionist activation → patient registration (P-000001, phone normalised, no EMR button for front desk) → duplicate review on a near-identical spelling (input kept, explicit confirmation required) → booking (past slots hidden, slot booked). The walkthrough surfaced a real defect — the queue page used an admin-only branch helper and failed for receptionists — fixed with `listOperationalBranches` and a regression test. Check-in and the doctor visit were then verified by automated tests only (the browser pane was closed).

## To add
| Area | Plan |
|---|---|
| E2E (acceptance 1–17) | Playwright against a built app + test DB; desktop, tablet, phone projects; run in CI |
| Accessibility | axe-core in Playwright for every page, keyboard-only walkthroughs |
| Clinical (Phases 5–6) | Care-relationship ABAC, unauthorised clinical access (acceptance 13), signing/amendment immutability, EMR read auditing |
| Finance (Phase 7) | invoice/payment transactions, idempotency, refunds, cash shift reconciliation |
| Security | dependency audit, SAST, secret scanning in CI; authenticated DAST (OWASP ZAP); external penetration test before launch |
| Performance | k6 load tests on lists and scheduling |
| Backup/DR (acceptance 17) | scheduled restore of production-like backup into an isolated environment + audit-chain verification after restore |
