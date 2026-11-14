# Gap analysis: ITop Med vs widely used medical practice software

Compared with publicly documented features of Epic (MyChart), athenahealth, eClinicalWorks, DrChrono, Doctolib, Cliniko, Practo Ray, Medesk and MedElement. Status as of 2026-11-14. ✅ = ITop Med has it · 🆕 = added in this round · ⏳ = planned · 🔒 = needs a contract/official spec.

| Capability | Typical in the market | ITop Med |
|---|---|---|
| Patient registry, duplicate detection, consents | all | ✅ |
| Scheduling, double-booking protection, queue | all | ✅ |
| Rescheduling an appointment (keep history) | all | 🆕 |
| Online self-booking | Doctolib, Practo, Cliniko | 🆕 portal booking with clinic rules |
| Waitlist / fill cancelled slots | Doctolib, Cliniko | ⏳ |
| EMR: notes, ICD-10, allergies, vitals, signing, amendments | all | ✅ |
| **Prescriptions (e-Rx) with printable form and allergy check** | all | 🆕 (print; national e-Rx 🔒) |
| Note templates per specialty | athena, eCW, Medesk | ⏳ |
| Printable visit summary / referral / sick-leave certificate | all | 🆕 prescription print · visit summary, referral, sick-leave ⏳ |
| Laboratory orders, results, four-eyes verification | all | ✅ |
| Imaging / PACS links | Epic, eCW | ⏳ |
| Dental chart | dental products | ✅ (treatment plans ⏳) |
| Billing, payments, refunds, cash shifts | all | ✅ |
| **Discount limits / approval rules (fraud control)** | Medesk, Practo, POS systems | 🆕 |
| Online payment (Payme/Click/Uzum) | local market | 🔒 |
| Fiscal receipts (OFD) | local law | 🔒 |
| **Owner control centre: live KPIs, risks, who-did-what** | athena, Medesk, Practo | 🆕 |
| Reports: finance, operations | all | ✅ |
| Inventory with expiry, FEFO | all | ✅ (purchase orders ⏳) |
| HR: licences, leave | larger systems | ✅ (payroll ⏳) |
| Patient portal: appointments, results, invoices | MyChart, Doctolib | ✅ |
| SMS / Telegram reminders | local market | 🔒 SMS provider · 🆕 Telegram (clinic bot) |
| Telemedicine (video visits) | Doctolib, Practo | ⏳ |
| Audit log, tamper-evident | enterprise systems | ✅ |
| Two-step verification, recovery codes, admin reset | all | ✅ |
| Multi-language (uz-Latn/uz-Cyrl/ru/en) | local market | ✅ |
| Installable app, works on the clinic network | Cliniko, Medesk (web) | ✅ |

## Order of work (highest value first)
1. 🆕 Owner control centre, discount control, prescriptions + prints, rescheduling (this round).
2. ⏳ Note templates per specialty, sick-leave/referral prints, waitlist.
3. 🆕 Portal self-booking and Telegram notifications (done) · ⏳ purchase orders.
4. 🔒 DMED, Payme/Click/Uzum, OFD, SMS — need agreements and official specifications.
