# Integrations

**Status (2026-11-21):** there is no email channel (removed); patient notifications go through the clinic's Telegram bot; SMS is **simulated** (no provider contracted); FHIR R4 export is implemented; DMED transmission, Payme/Click/Uzum online payment, Telegram and fiscal receipts are **not implemented**. No endpoints, credentials or message formats are assumed for any provider; each integration starts only after official documentation and authorisation are obtained. The clinic sees the same honest status at **Integrations** (`/c/{slug}/integrations`).

| Integration | Status | Where |
|---|---|---|
| SMS | 🟡 SIMULATED only (`SMS_TRANSPORT=dev-outbox` writes to `.dev-mailbox/sms`, refused in production; `none` = channel off) | `src/server/notifications/sms.ts` |
| Patient notifications (outbox) | ✅ booking confirmation, reminder (configurable hours before), cancellation, "results ready in the portal" | `src/server/notifications` |
| HL7 FHIR R4 export | ✅ per-patient Bundle download for the treating doctor / head doctor, audited | `src/server/emr/fhir.ts` |
| DMED / Digital Health Platform | ⏳ transmission not implemented | — |
| Payme, Click, Uzum | ⏳ not implemented (payments made through them can be recorded manually at the cash desk with a reference) | — |
| Telegram | ⏳ not implemented | — |
| Fiscal receipts (OFD) | ⏳ not implemented (printed receipts are labelled non-fiscal) | — |

## Notification pipeline (implemented)
* **Transactional outbox.** Booking, cancellation and result release write `Notification` rows in the same transaction. A row stores *what* (kind, subject id), *whom* (patient id), *when* (dueAt) and *how* (channel) — **never the text, the address or clinical content.**
* **Consent first.** A channel is queued only if the patient has an active consent for it (`SMS_REMINDERS`, `TELEGRAM_NOTIFICATIONS`) and an address on file; "results ready" also needs an active portal account. At send time consent, address and relevance (visit still booked, reminder still in the future) are checked again; otherwise the row is `SKIPPED` with a reason code.
* **Content.** Rendered at send time in the patient's language (or the clinic default) from the `notifications` message catalog: clinic, date/time, branch, branch phone, portal link. No diagnoses, results, doctor names or specialties.
* **Delivery.** `processDueNotifications(tenantId)` claims rows with `FOR UPDATE SKIP LOCKED` (parallel workers never double-send), retries after 5/30/120 minutes, then `FAILED`. Runs as the clinic role in tenant context. `npm run worker` loops over active clinics (`--once` for cron); the Integrations page has "Send due messages now".
* **Per-clinic switches:** each kind on/off, reminder 1–72 h before (`NotificationSettings`).
* **Not yet:** delivery receipts from providers, quiet hours, per-patient channel preference beyond consent, a dead-letter review screen beyond the log filter.

## FHIR R4 export (implemented)
`POST /c/{slug}/patients/{id}/record/fhir` (form button on the medical record) returns a `collection` Bundle with `Patient`, `Encounter`, `Condition` (ICD-10 `http://hl7.org/fhir/sid/icd-10`), `AllergyIntolerance`, vital-sign `Observation`s (LOINC + UCUM) and verified lab `Observation`s (LOINC when the analyte has a code, reference ranges, v3 interpretation L/H/N). Only care-relationship or head-doctor oversight access; never under break-the-glass; audited (`emr.exported_fhir`, resource count only). POST + SameSite cookies + Origin check prevent cross-site triggering; `Cache-Control: no-store`; no patient identifiers in the file name.
* National identifiers use clinic-local URNs (`urn:itopmed:identifier:pinfl`) until the official FHIR system URIs are confirmed with the national exchange.
* Lab units are clinic-entered and not validated as UCUM, so no UCUM system is claimed for them.
* Not yet: signed clinical notes (`Composition`/`DocumentReference`), `DiagnosticReport` grouping, `Practitioner`/`Organization` resources, FHIR profile validation against national profiles.

## Common adapter architecture (for the integrations still to build)
```
src/server/integrations/<provider>/
  adapter.ts      implements a typed port (HealthRecordExchangePort, PaymentPort, MessagingPort)
  mapping.ts      domain ⇄ provider mapping, validated with Zod both ways
  client.ts       HTTP client: timeouts, mTLS/OAuth as required, no PHI in logs
```
* Core modules depend on **ports**, never on providers; providers can be enabled per clinic.
* Outbox + worker with exponential backoff, max attempts and an **idempotency key** per message (as in the notification pipeline).
* Integration events record direction, status, attempts, error code and payload **hash** (not payload).
* Credentials encrypted (`encryptField`) or held in the secret manager; never in code or logs.
* A sandbox/simulator adapter may exist for development and must be labelled "SIMULATED" in the UI and refused in production.

## UZINFOCOM / Digital Health Platform / DMED
* Prerequisites: official specification, test environment access, legal agreement, clinic/operator registration — **not yet obtained**.
* Ready on our side: FHIR R4 export (above) from coded data (ICD-10, LOINC, UCUM).
* To build: validation against national profiles, transmission client, response/error mapping, idempotent retries, per-record sync status visible to clinics, integration audit.
* Never bypass government requirements; never fabricate responses.

## Payments — Payme, Click, Uzum
Merchant agreements per clinic (or marketplace model — business decision), the providers' official merchant API documentation and sandbox credentials are required first. Then: callback endpoints with signature verification, idempotency on provider transaction ids, amount/currency checks against the invoice, reconciliation reports, fiscal receipt obligations (to be confirmed).

## Messaging — SMS providers, Telegram
SMS: contract with a licensed Uzbek SMS gateway, sender-name registration, the provider's official API. Then implement `sendSms` behind the existing outbox (only the transport changes). Telegram: an official clinic bot; patients link their chat by an explicit action from the portal.

## Laboratory / diagnostic systems
HL7 v2 or FHIR depending on partner; mapping per analyser/LIS; results verified in ITop Med before release.
