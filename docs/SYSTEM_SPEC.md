# Integrated Government Services System for Lesotho
## System specification (corrected from the prototype brief)

This document replaces the original "prototype" brief. The project is now a working system: a React web application, a Node.js API and a PostgreSQL database, hosted on Render. Where the old brief said "simulate", this version says what the system actually does, and which steps it performs automatically.

---

## 1. Purpose

Connect the Ministry of Home Affairs with Passport, Traffic, Finance, Pension and Police services through one citizen account and one verified citizen record, so that citizens:

- know exactly what to bring before they travel,
- visit an office once, at a booked time,
- do not repeat the same personal details to every department,
- can follow their application and answer questions without going back to the office.

## 2. What changed from the prototype brief

| Prototype brief said | The system now does |
|---|---|
| Use simulated data and pretend flows | Real database, real accounts, real bookings with capacity limits. Demonstration records are flagged `is_demo` and can be switched off with `SEED_DEMO=false`. |
| User selects adult or minor | System works out the category from the date of birth. A parent applies for a child from their own account; the child's age is checked automatically. |
| Citizen types personal details for each service | Details come from the verified citizen record. The citizen only confirms them. |
| Identity verification is described | Identity is verified automatically at registration by matching ID number, surname and date of birth with the population register. Only mismatches go to a Home Affairs officer. |
| Employees update every status by hand | Status moves automatically wherever a rule can decide (see section 5). Officers only act where a person must look at original documents or make a judgement. |
| Department approver decides every information request | The system approves or refuses requests automatically under data-sharing policies, asks the citizen for consent where required, and sends only the rest to a Home Affairs supervisor. |
| Appointment "planning" | Real visit times are generated per office (weekdays only, public holidays excluded), with capacity per time, double-booking prevention, rescheduling and automatic release of missed visits. |
| Fees and requirements written into screens | Requirements, fees, offices and holidays are stored in the database and managed by the administrator. Each item carries a "confirmed from an official source" flag that is shown to citizens. |
| Notifications are simulated | Notifications are created automatically on every status change and by scheduled reminders; email copies are sent when SMTP is configured. |
| Audit log demonstration | Every view of a citizen record, update, request, decision, login and denied attempt is written to an append-only audit table. A database trigger blocks edits and deletes. |

## 3. Users and roles

| Role | Can do | Cannot do |
|---|---|---|
| Citizen | Register (with or without a National ID), log in with ID, phone or email, apply for services for self or own child, book and move visits, track applications, answer questions, give or refuse consent, see who opened their record | See anyone else's records |
| Officer (per department) | See and process only their department's applications; check documents at the office visit; mark completed, ask for information or reject; request extra citizen fields | Open another department's application (access denied and recorded); see fields their department is not permitted to see |
| Supervisor (per department) | Everything an officer can, plus the department audit log | See other departments' audit logs |
| Home Affairs supervisor | Also approves or denies information requests that policy does not decide automatically; verifies identities | Approve their own requests |
| Home Affairs officer | Identity verification queue (people the system could not match) | |
| System administrator | Staff accounts, services, requirements, fees, offices, holidays, sharing policies, settings, register import, audit log for all departments, run automation | Open citizen applications or citizen records (least privilege) |

Sessions end after 30 minutes of inactivity for citizens and 15 minutes for staff, with a one-minute warning. Five failed logins lock an account for 15 minutes. Staff created by the administrator must replace their temporary password at first sign-in.

## 4. Services

Each department has its own page, and each service has its own screen. Requirements are shown only for the applicant category that applies.

| Department | Services |
|---|---|
| Home Affairs | National ID card, Replace lost or damaged ID, Birth certificate, Identity verification (staff) |
| Passport Services | New passport (adult 16+ or minor below 16), Replace passport, Fees, Office finder, Status check |
| Traffic | Driving licence renewal, Learner's licence test booking, Vehicle licence renewal |
| Finance | Civil servant salary statement, Government payment enquiry (online only, no visit) |
| Pensions | Old age pension (minimum age from the service record), Proof-of-life verification |
| Police | Police clearance certificate, Report a lost document |

Passport requirements and fees are those supplied for the project:

- New passport, adult: Identity Card, passport fee.
- New passport, minor: child's birth certificate, parent or guardian accompaniment, consent letter, parent or guardian identity documents, passport fee.
- Replacement, adult: existing or old passport, Identity Card, passport fee.
- Replacement, minor: not confirmed from an official source, so the system refuses to start it online and tells the citizen to contact the office. The administrator can add requirements once confirmed.
- Fees: Regular 32 pages M130.00, Regular 64 pages M300.00, labelled "verify against current official requirements".

Requirements for the other departments are stored as "not yet confirmed" and shown with a warning until the administrator marks them confirmed. Office phone numbers are left empty and shown as "Contact number not available" until an official number is entered.

## 5. Automation

| Automated step | When it runs |
|---|---|
| Identity verification against the population register | At registration |
| Applicant category and age rules (adult/minor, minimum age such as pension age) | When an application is started and again after documents are checked |
| Duplicate prevention (one open application per service per applicant) | Database unique index |
| Requirement checklist built from the service catalogue | When an application is started |
| Fee looked up from the passport type chosen | On selection |
| Reference numbers (for example PSN-2026-001024) | On creation |
| Draft → Preparing documents | When the citizen reviews requirements |
| Preparing documents → Ready for office visit | When checklist is complete and a visit is confirmed |
| Submitted → Under review, Additional information required, or Rejected | Immediately after the officer accepts the documents: identity verified, person alive in the register, age rules, category |
| Additional information required → Under review | When the citizen answers, or when Home Affairs verifies their identity |
| Visit times generated for every office | Every run, 21 days ahead, skipping weekends and holidays |
| Visit reminders | 24 hours before the visit |
| Missed visit released and citizen asked to rebook | 2 hours after an unattended visit |
| Reminder for unfinished applications | After 3 days without progress |
| Unfinished drafts cancelled | After 30 days |
| Information requests: deny when no policy, ask citizen for consent, approve under policy, or route to supervisor | On request and on consent |
| Granted access expires; unanswered consent requests expire | Every run |
| Pension eligibility notice | When a verified citizen is within 60 days of the qualifying age |
| Notifications on every status change | On change |
| Audit entries | On every action |

All time limits are settings the administrator can change. Automation runs every 15 minutes, on start-up, and on the first request after a quiet period (so it still runs on Render's free plan, which sleeps).

What stays with people: checking original documents at the counter, verifying identity when the automatic match fails, deciding completion, rejection or follow-up questions during review, and approving information requests that policy does not cover.

## 6. Application statuses

Draft, Preparing documents, Ready for office visit, Submitted, Under review, Additional information required, Completed, Rejected, Cancelled.

"Completed" means processing is finished and the document can be collected in person. The system never states that a passport has been issued.

## 7. Single citizen profile and information sharing

- Home Affairs owns the identity record. Name, date of birth, sex and ID number can only be corrected at a Home Affairs office.
- Citizens can edit phone, email, address and district.
- The full ID number is masked everywhere; the citizen can reveal it for 30 seconds after re-entering their password (recorded).
- Each department has a default set of visible fields. Other fields appear as "Not available to your department".
- Extra fields are requested from an application page, with a purpose. The request shows the requesting department, purpose, fields, consent and decision, and every step is in the audit log.
- Citizens see pending requests, active access (and can withdraw it), and a list of every time an officer opened their record.

## 8. Accessibility and inclusion

- Atkinson Hyperlegible typeface, designed for low-vision readers.
- Three text sizes and a high-contrast mode, remembered on the device.
- Large touch targets (at least 46px), visible keyboard focus, skip link, labelled form fields, error summaries that receive focus, and status shown with icon plus text, never colour alone.
- Bottom tab bar on phones, top navigation on larger screens; tables become stacked cards on small screens.
- Login by phone number; email is optional.
- A person without a National ID can still register and apply for one.
- Pension pages explain that a helper may accompany the citizen.
- Plain-language messages that say what happened and what to do next.

## 9. Test journeys

1. Citizen creates an account (verified automatically), opens Passport Services, selects New passport, sees only first-time adult requirements, completes the checklist (0 of 2, 1 of 2, 2 of 2), chooses a passport type and fee, searches offices by district, picks the earliest time, reviews and confirms.
2. Citizen opens Replace passport, sees only replacement requirements, records previous passports (listed most recent first), selects an office and reviews the visit.
3. Citizen opens My applications, opens an application and sees its status, progress track and history.
4. Elderly citizen ('Makhotso, demo phone 58000002) receives a pension eligibility notice, opens Pension Services and starts an application; a younger citizen is told the date they become eligible.
5. Passport officer checks documents at the visit; the system runs its checks and moves the application to Under review; a Traffic officer trying to open the same reference is denied and the attempt is recorded.
6. Pension officer requests a citizen's address; the citizen consents; a Home Affairs supervisor approves; the request page shows the full audit trail.

An automated API test of these journeys is in `docs/smoke-test.mjs`.

## 10. Remaining limitations

- No connection to a real Home Affairs register yet. The register is loaded by CSV import in the admin area.
- No online payment. Fees are paid at the office.
- No SMS gateway. Notifications are in-app, plus email when SMTP is configured.
- Biometric capture happens at the office on Home Affairs equipment, outside this system.
- Requirements other than passports, and office addresses, must be confirmed with each department before real use.
