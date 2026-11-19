# User roles

Every person has an individual account; shared accounts are prohibited. Least privilege, enforced server-side.

## Platform (ITop Med staff) — `PlatformUser.role`
| Role | Can | Cannot |
|---|---|---|
| SUPER_ADMIN | everything below + platform settings, staff management | read medical records |
| PLATFORM_ADMIN | create/manage clinics, lifecycle, modules, subscriptions, audit | manage platform staff |
| SUPPORT | view clinics, request time-limited support access, audit | change clinics |
| BILLING | view clinics, manage subscriptions | lifecycle, modules |
| READ_ONLY | view clinics and staff | any change |

Sign-in: login + password or Telegram (no second factor). Matrix: `src/server/authz/platform.ts`.

## Clinic roles (templates copied into every clinic)
| Role | Key permissions | Notes |
|---|---|---|
| Clinic owner | settings, branches, staff, roles, audit, support-access decisions, subscription, finance reports | **no EMR access** unless also given `doctor` |
| Clinic administrator | settings, branches, staff, patients, appointments, queue, services | no EMR; cannot grant owner |
| Branch manager | operations and reports for assigned branches | branch scope via `MembershipBranch` |
| Receptionist | registration/search, appointments, queue, check-in | no EMR |
| Doctor | own schedule/queue; EMR read/write/sign/amend for patients in their care; orders; prescriptions; documents | care-relationship ABAC (Phase 6) |
| Head doctor | `emr.read_all` with audited oversight; clinical workflow reports | reason required outside own care |
| Nurse | vitals, nursing records, assigned tasks | |
| Laboratory staff | lab queue, specimens, results, verification | |
| Cashier | invoices, payments, refunds, cash shift | |
| Accountant | revenue/expenses, statements, debts | |
| Pharmacist / inventory | catalogue, suppliers, receiving, issuing/dispensing (FEFO), write-offs, stock counts | finds patients only by record number when dispensing; no patient search or EMR |
| HR manager | staff profiles, licences/certificates, leave (blocks doctors' days), schedules | sees leave categories; colleagues only see absences |
| Patient (portal, Phase 8b) | own appointments (cancel up to 2 h before), lab results released by the doctor, issued invoices and payments, own consents (except portal access), password | separate identity realm (`PatientAccount`), cookie and DB role (`itopmed_portal`); never sees notes, diagnoses or staff data |

**Small practices (8e).** One person may hold several roles. The setup assistant lets the owner add the doctor role (with specialty and a weekday schedule) and/or the receptionist + cashier roles to their own account, so a 1-doctor office needs no second login; a 1-doctor + 1-administrator office invites the administrator with receptionist + cashier. Switched-off modules remove their permissions from every role.

Phase 8b added `portal.manage` (receptionist, clinic administrator: issue/reissue activation codes, turn portal access off). Releasing lab results to the portal needs `emr.write` and a care relationship (or head-doctor oversight).

Phase 8a added `lab.collect` (nurse, laboratory staff: mark specimens collected) and `lab.manage` (laboratory staff, clinic administrator: test catalogue and order cancellation); verification uses `lab.verify` and is always by a different person than the one who entered the results. Existing clinics received them through a data migration.

Phase 5 added `services.read`, `schedules.read` and `schedules.manage` (front desk, managers and HR read/plan schedules; doctors always see their own schedule without these permissions). Existing clinics received them through a data migration.

Source: `src/server/authz/permissions.ts`. Clinics edit role permissions and create custom roles at `/c/{slug}/roles` (owner role is locked). Member roles, branch scope and access status are managed at `/c/{slug}/staff/{membershipId}`: nobody can change their own access, only owners change owners, and a clinic always keeps one active owner.
