# Integrations

**Status: none implemented.** No endpoints, credentials or message formats below are assumed. Each integration starts only after official documentation and authorisation are obtained.

## Common adapter architecture
```
src/server/integrations/<provider>/
  adapter.ts      implements a typed port (e.g. HealthRecordExchangePort, PaymentPort, MessagingPort)
  mapping.ts      domain ⇄ provider mapping, validated with Zod both ways
  client.ts       HTTP client: timeouts, mTLS/OAuth as required, no PHI in logs
```
* Core modules depend on **ports**, never on providers. Providers can be disabled per tenant (`IntegrationConfig`).
* Outbox pattern: business transaction writes an `OutboxMessage`; a worker delivers with exponential backoff, max attempts, dead-letter, and an **idempotency key** per message.
* `IntegrationEvent` records direction, status, attempts, error code and payload **hash** (not payload) for audit.
* Credentials encrypted (`encryptField`) or held in the secret manager; never in code or logs.
* A sandbox/simulator adapter may exist for development and must be labelled "SIMULATED" in the UI.

## UZINFOCOM / Digital Health Platform / DMED
* Prerequisites: official specification, test environment access, legal agreement, clinic/operator registration — **not yet obtained**.
* Expected direction: FHIR-based exchange (to verify). Domain model is coded (ICD-10, LOINC, UCUM) to ease mapping to FHIR R4 `Patient`, `Encounter`, `Condition`, `Observation`, `DiagnosticReport`, `MedicationRequest`.
* Requirements: validation of outgoing resources, response/error mapping, idempotent retries, per-record sync status visible to clinics, full integration audit, isolated module (`integrations/dmed`).
* Never bypass government requirements; never fabricate responses.

## Payments — Payme, Click
Merchant agreements per clinic (or marketplace model — business decision). Callback endpoints with signature verification, idempotency on transaction ids, reconciliation reports. Fiscal receipt obligations to be confirmed.

## Messaging — SMS providers, email, Telegram
Content limited to logistics ("appointment tomorrow 10:00 at Clinic X"). **No diagnoses, results or clinical documents.** Consent/opt-out per channel. Telegram via an official bot linked by explicit patient action.

## Laboratory / diagnostic systems
HL7 v2 or FHIR depending on partner; mapping per analyser/LIS; results verified in ITop Med before release.
