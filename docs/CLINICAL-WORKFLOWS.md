# Clinical workflows (design drafts)

> Engineering drafts. Before implementation, each must be reviewed by a licensed physician familiar with Uzbek clinical practice and Ministry of Health documentation rules.

## 1. Registration → visit
1. Receptionist searches (name, phone, PINFL, birth date; fuzzy). Duplicate candidates are shown; merges need human confirmation and are audited.
2. New patient: identity, contacts, identifiers, consents with purpose and legal basis.
3. Appointment against practitioner schedule, room and service; overlaps blocked by a database constraint.
4. Arrival: check-in → queue ticket → doctor's queue.

## 2. Doctor encounter
1. Doctor opens today's queue. The record opens only if a care relationship exists (appointment, encounter or assignment); otherwise "break the glass" with a reason — audited and reviewed by the head doctor.
2. Summary: allergies (prominent), active problems, medications, recent vitals, recent notes.
3. Encounter note from specialty templates (structured sections + free text).
4. Diagnoses coded in ICD-10 (primary/secondary, status).
5. Orders: lab/diagnostics, prescriptions where permitted, follow-up appointment.
6. **Sign**: note becomes immutable; content hash, signer and time stored.
7. Corrections: amendment with reason; original preserved and visible.

## 3. Nursing
Vitals with units and reference ranges; nursing notes; tasks assigned by doctors.

## 4. Laboratory
Order → specimen collected (barcode) → received → processed → result entry → verification by authorised staff → released to doctor → optionally released to the patient portal after doctor approval.

## 5. Billing
Services from appointment/encounter → invoice → payment (cash, card, Payme, Click) with idempotency → fiscal receipt (integration to be decided) → refunds need permission and reason → cash shift open/close with reconciliation.

## 6. Patient portal
Appointments, requests, released documents only (never drafts), consent management, notifications without clinical content.

## Open clinical questions
* Mandatory MoH forms (e.g. outpatient card forms) and required fields.
* Prescription rules, controlled substances, e-prescription availability.
* Retention periods per record type.
* Which results may be released to patients automatically.
