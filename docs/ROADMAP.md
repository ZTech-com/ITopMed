# Roadmap, status and external dependencies

## Phase status (as of 2026-11-11)
| Phase | Scope | Status |
|---|---|---|
| 1 | Foundation, design system, localization, docs | ✅ done (catalogs need native-speaker review) |
| 2 | Super Admin auth and platform administration | ✅ core done — login, mandatory TOTP, sessions, dashboard, clinics, audit + integrity check, staff list. ⏳ platform-staff invitations UI, announcements, support tickets, global settings |
| 3 | Clinic provisioning, onboarding, secure owner invitations | ✅ done — atomic provisioning, invitations (resend/revoke), lifecycle, modules, plan change, owner activation + clinic settings/branches |
| 4 | Tenant isolation, users, roles, permissions | ✅ done (2026-11-11) — staff invitations incl. existing accounts joining more clinics, password reset, role editor (custom roles, locked owner role), member access (roles, branch scope, suspend/restore/remove) with owner/self/last-owner guardrails, break-glass request → clinic approval → expiry/revocation. ⏳ MFA recovery codes / admin MFA reset, platform-staff invitation UI |
| 5 | Admin, receptionist, doctor workspaces | ✅ done (2026-11-11) — role-aware dashboard (operations + setup for admins, front desk "who works today", "My day" for doctors), services & prices (exact money), departments & rooms, doctor profiles, weekly schedules with overlap prevention, absences, services per doctor, availability engine (time-zone/DST-safe slots), branch-scope enforcement. Appointments/queue themselves are Phase 6 |
| 6 | Patients, appointments, queue, EMR | ✅ done (2026-11-11) — patient registry (MRN, PINFL/passport, smart search incl. typo-tolerant names, duplicate detection with human confirmation, consents per purpose), booking inside working hours with database-enforced no-double-booking, check-in with daily queue tickets, walk-ins, cancellations/no-shows, doctor's day, encounters, structured notes, signing (immutable + hash), amendments, ICD-10 diagnoses, allergies, vital signs, care-relationship access with audited break-the-glass. ⏳ patient merge, rescheduling UI, printable documents, lab orders (Phase 8) |
| 7 | Billing, payments, reports | ✅ backend + UI + 7 tests (2026-11-11): invoices (draft → issued, frozen by DB trigger, sequential numbers), payments with idempotency and row locks, refunds, voids, cash shifts with reconciliation, expenses, financial and operational reports, printable non-fiscal receipt; browser walkthrough done (walk-in → invoice with discount → cash + Payme payments → receipt → balanced shift close → owner reports). ⏳ fiscal receipts (OFD), Payme/Click/Uzum online integration |
| 8 | Other staff workspaces, patient portal, integrations | ✅ done in four parts (8a–8d). **8a laboratory + nurse station ✅ (2026-11-11)** — per-clinic test catalogue (analytes, units, reference ranges, optional LOINC), lab orders from the visit (sequential `LAB-YYYY-NNNNNN`, routine/urgent), specimen collection at the nurse station, result entry with automatic low/high flags (decimal comma accepted), four-eyes verification (enforced in service and by a DB CHECK), verified results immutable at DB level and shown to the doctor on the visit and in the medical record; 3 tests + browser walkthrough. **8b patient portal ✅ (2026-11-11)** — separate patient identity realm and a third database role (`itopmed_portal`) whose policies derive the patient from the session inside PostgreSQL; front desk issues one-time activation codes (consent recorded first), patient activates with code + date of birth and chooses phone + password; own appointments (cancel online until 2 h before, enforced by policy), lab results only after the doctor releases them, issued invoices with payments, self-service consents (portal consent itself is clinic-managed; withdrawing it at the desk closes access), password change signing out other devices; 6 tests + browser walkthrough. Not yet: online booking, document downloads, notifications, online payment, patient MFA/SMS OTP (needs the SMS integration in 8d). **8c pharmacy/inventory + HR ✅ (2026-11-11)** — item catalogue and suppliers; stock kept per branch as batches (lot, expiry, cost) changed only through an append-only movement ledger whose trigger maintains quantities; the database refuses negative stock, issuing expired batches and editing or deleting movements; first-expiry-first-out issue to departments and dispensing to patients by record number (all-or-nothing, concurrency-safe); write-offs with reasons, stock counts as corrections; low-stock / expiring / expired alerts. HR: minimal staff profiles (personnel no., position, department, employment type), licences and certificates with expiry alerts, leave by category — a doctor's leave blocks their bookable days automatically (sick leave shown to colleagues only as a generic absence) and reports booked visits that need rescheduling; 6 tests + browser walkthrough. Not yet: purchase orders, transfers between branches, dispensing against prescriptions, barcode scanning, payroll/timesheets, staff self-service. **8d integrations ✅ (2026-11-12, honest scope)** — patient notification outbox (booking confirmation, reminder, cancellation, results-ready) gated by per-channel consent, rendered at send time without clinical content, delivered by a worker (`npm run worker`) with row-locked claiming and retries; email via SMTP, SMS **simulated** until a provider is contracted; per-clinic switches and a delivery log; HL7 FHIR R4 export of the medical record (audited, care relationship only); Integrations page with the real status of every provider; 5 tests + browser walkthrough. **Not implemented (need contracts/official specs):** DMED transmission, Payme/Click/Uzum online payment, real SMS gateway, Telegram, fiscal receipts. Not yet in 8a: specimen barcodes/labels, critical-value alerts, analyzer interfaces (result release to the portal arrived in 8b) |
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
| 7 | Receptionist registers a synthetic patient and books | ✅ automated + browser |
| 8 | Doctor sees the appointment and opens the authorised record | ✅ automated (browser walkthrough stopped at check-in when the pane was closed) |
| 9 | Doctor creates and signs a clinical note | ✅ automated |
| 10–11 | Invoice/payment, owner reports | ✅ automated + browser |
| 12 | Clinic A cannot access Clinic B | ✅ for all current tables |
| 13 | Unauthorised users cannot view clinical records | ✅ RBAC + care-relationship ABAC + RLS; platform role has no grants; denials audited |
| 14 | Critical actions audited | ✅ for current actions |
| 15 | Four languages on major screens | ✅ for built screens (machine-assisted translations need review) |
| 16 | Desktop/tablet/phone | 🟡 responsive layout; real-device testing pending |
| 17 | Backup restore + security tests | ⏳ needs infrastructure |

## Known limitations
* Rate limiting is per-process memory (Redis needed before scaling out).
* Email delivery is simulated in development; production requires SMTP configuration.
* Platform staff have no self-service password reset (by design: a SUPER_ADMIN or the CLI resets them). Lost-authenticator recovery is not built yet.
* Approved support grants are recorded and checked by `getActiveGrant`, but no platform screen uses them yet — operational support views will consume them in Phase 6+.
* ICD-10 codes are validated by format only; an official ICD-10 catalogue (licensed nomenclature as used by the MoH) still has to be imported.
* Patient merge (for confirmed duplicates) is not implemented yet — duplicates are prevented at registration.
* Production databases must allow the migration role to create the `btree_gist` and `pg_trgm` extensions (both are trusted extensions).
* Specialty list and service catalog conventions need review by the clinical advisor (MoH nomenclature).
* `npm audit` reports advisories in the dependency tree — review and resolve before production.
* Prisma 7.10 runs some nested-relation queries concurrently inside interactive transactions; node-pg 8 queues them safely but logs a deprecation warning (removed behaviour in pg 9). Our own code awaits queries sequentially inside transactions (`sequential()`); keep `pg` on `^8` until Prisma changes this.
* Module flags per clinic are displayed but not enforced yet (all implemented modules work for every plan); the catalogue now marks built modules as available.
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
