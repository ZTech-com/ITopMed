# Product requirements

## Vision
ITop Med is a multi-tenant healthcare management platform for private clinics, starting in Uzbekistan and built to international standards: one platform, isolated clinic workspaces, role-specific experiences, four languages (uz-Latn default, uz-Cyrl, ru, en), privacy by design.

## Users
Platform owner and staff; clinic owners/admins; front desk; doctors, head doctors, nurses; laboratory; cashiers/accountants; pharmacy/inventory; HR; patients. See `USER-ROLES.md`.

## Capability matrix
Compared against capability categories common in established clinic-management products (regional and international). Categories only — no copied designs. P0 = launch blocker, P1 = first commercial release, P2 = later.

| Capability | Prevalence | Clinical need | Regulatory weight | Priority |
|---|---|---|---|---|
| Multi-branch clinic setup, roles | common | high | — | P0 ✅ foundation |
| Patient registry with identifiers (PINFL, passport), duplicate detection | common | high | DMED identity | P0 |
| Scheduling, calendars, conflict detection | universal | high | — | P0 |
| Waiting queue / check-in | common in UZ | high | — | P0 |
| EMR: encounters, structured notes, ICD-10 diagnoses, allergies, vitals | universal | critical | MoH / DMED | P0 |
| Signed notes + amendment history | strong products | critical | legal record | P0 |
| Billing, invoices, payments, refunds, cash shifts | universal | high | tax / fiscal receipts | P0 |
| Owner reports | universal | medium | — | P0 |
| Lab orders and results | common | high | — | P1 |
| Documents, templates, printing | common | high | — | P1 |
| SMS / Telegram reminders without PHI | very common in UZ | medium | consent | P1 |
| Payme / Click payments | common in UZ | medium | contracts | P1 |
| Patient portal | growing | medium | consent | P1 |
| DMED / Digital Health Platform exchange | increasingly required | high | likely mandatory | P1 (blocked on access) |
| Inventory and pharmacy | common | medium | licensing | P2 |
| HR | some | low | labour law | P2 |
| Imaging (PACS link) | specialised | medium | — | P2 |
| Optional AI assistance | emerging | medium | high risk | P2, gated |

## Acceptance workflows
The 17 criteria from the brief; status in `ROADMAP.md`.

## Non-functional requirements
* Security and privacy per `SECURITY-AND-PRIVACY.md`.
* p95 server time < 300 ms for typical lists at 50 concurrent users per clinic.
* WCAG 2.2 AA, keyboard navigation, reduced motion.
* Availability 99.5% (MVP), RPO ≤ 15 min, RTO ≤ 4 h — depends on the hosting decision.

## AI policy
AI never diagnoses, prescribes or decides treatment. Future AI features are optional, permission-controlled, clinically reviewed and legally approved, and never send patient data to external providers without legal basis, agreements and a security review.
