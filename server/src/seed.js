import bcrypt from 'bcryptjs';
import { config } from './config.js';
import { nextApplicationReference } from './lib/reference.js';

export const DISTRICTS = [
  ['Maseru', 'Maseru'],
  ['Berea', 'Teyateyaneng'],
  ['Leribe', 'Hlotse'],
  ['Butha-Buthe', 'Butha-Buthe'],
  ['Mokhotlong', 'Mokhotlong'],
  ['Thaba-Tseka', 'Thaba-Tseka'],
  ["Qacha's Nek", "Qacha's Nek"],
  ['Quthing', 'Quthing'],
  ["Mohale's Hoek", "Mohale's Hoek"],
  ['Mafeteng', 'Mafeteng'],
];

const DEPARTMENTS = [
  ['HOME_AFFAIRS', 'Ministry of Home Affairs', 'Home Affairs', 'National identity, civil registration and citizen records.', true],
  ['PASSPORT', 'Passport Services', 'Passports', 'New passports, replacements and passport office visits.', false],
  ['TRAFFIC', 'Traffic Services', 'Traffic', 'Driving licences and vehicle licensing.', false],
  ['FINANCE', 'Finance Services', 'Finance', 'Government payment and salary services.', false],
  ['PENSION', 'Pension Services', 'Pensions', 'Old age pension and pension verification.', false],
  ['POLICE', 'Police Services', 'Police', 'Police clearance and reporting lost documents.', false],
];

// [dept, code, prefix, name, summary, applies_to, requires_national_id, requires_appointment, min_age, requirements_verified, in_person_note]
const SERVICES = [
  ['HOME_AFFAIRS', 'NATIONAL_ID', 'NID', 'Apply for a National ID card',
    'First National ID card for citizens aged 16 and above.', 'self', false, true, 16, false,
    'You must attend in person. Your photo, fingerprints and signature are captured at the office.'],
  ['HOME_AFFAIRS', 'ID_REPLACEMENT', 'IDR', 'Replace a lost or damaged ID card',
    'Get a new ID card if yours is lost, stolen or damaged.', 'self', true, true, 16, false, null],
  ['HOME_AFFAIRS', 'BIRTH_CERTIFICATE', 'BRC', 'Birth certificate',
    'Request a birth certificate for yourself or for your child.', 'both', false, true, null, false, null],
  ['PASSPORT', 'PASSPORT_NEW', 'PSN', 'Apply for a new passport',
    'First passport for an adult (16 or older) or for a child below 16.', 'both', true, true, null, true,
    'You must attend a passport office or enrolment centre in person. Your documents are checked and your photo and fingerprints are taken there.'],
  ['PASSPORT', 'PASSPORT_REPLACE', 'PSR', 'Replace an existing passport',
    'Replace a passport that is full, expired, lost or damaged.', 'both', true, true, null, true,
    'You must attend a passport office in person with your old passport.'],
  ['TRAFFIC', 'DRIVING_LICENCE_RENEWAL', 'DLR', 'Renew a driving licence',
    'Renew a driving licence that has expired or is about to expire.', 'self', true, true, null, false, null],
  ['TRAFFIC', 'LEARNER_LICENCE', 'LRN', "Learner's licence test booking",
    "Book a visit to take the learner's licence test.", 'self', true, true, null, false, null],
  ['TRAFFIC', 'VEHICLE_LICENCE', 'VLD', 'Renew a vehicle licence',
    'Renew the yearly licence for a registered vehicle.', 'self', true, true, null, false, null],
  ['FINANCE', 'SALARY_STATEMENT', 'FSS', 'Civil servant salary statement',
    'Request an official salary statement if you are a government employee.', 'self', true, true, null, false, null],
  ['FINANCE', 'PAYMENT_ENQUIRY', 'FPE', 'Government payment enquiry',
    'Ask about the status of a payment owed to you by government.', 'self', true, false, null, false,
    'No office visit is needed unless the department asks you to come in.'],
  ['PENSION', 'OLD_AGE_PENSION', 'OAP', 'Apply for the old age pension',
    'Register for the old age pension when you reach the qualifying age.', 'self', true, true, 70, false,
    'You must attend in person. A family member or helper may come with you.'],
  ['PENSION', 'PENSION_LIFE_CERT', 'PLC', 'Pension proof-of-life verification',
    'Confirm you are still receiving your pension so payments continue.', 'self', true, true, null, false,
    'You must attend in person. A family member or helper may come with you.'],
  ['POLICE', 'POLICE_CLEARANCE', 'PCC', 'Police clearance certificate',
    'A certificate that shows whether you have a criminal record.', 'self', true, true, 16, false, null],
  ['POLICE', 'LOSS_REPORT', 'PLR', 'Report a lost document',
    'Report a lost ID card, passport or licence. You may need this report to replace it.', 'self', false, true, null, false, null],
];

// [serviceCode, category, label, detail, isFee, isVerified]
const REQUIREMENTS = [
  ['NATIONAL_ID', 'any', 'Birth certificate', 'Original birth certificate.', false, false],
  ['NATIONAL_ID', 'any', 'Photo, fingerprints and signature', 'Captured by an officer during your visit. Nothing to bring.', false, false],
  ['ID_REPLACEMENT', 'any', 'Police report (if your ID was lost or stolen)', 'Use "Report a lost document" under Police Services to get one.', false, false],
  ['ID_REPLACEMENT', 'any', 'Damaged ID card (if it was damaged)', 'Bring the damaged card with you.', false, false],
  ['BIRTH_CERTIFICATE', 'adult', 'Proof of birth', 'Clinic card, hospital record or baptism record if available.', false, false],
  ['BIRTH_CERTIFICATE', 'minor', "Child's proof of birth", 'Clinic card or hospital birth record.', false, false],
  ['BIRTH_CERTIFICATE', 'minor', 'Parent or guardian identity document', 'Your National ID card.', false, false],

  ['PASSPORT_NEW', 'adult', 'Identity Card', 'Your original National ID card.', false, true],
  ['PASSPORT_NEW', 'adult', 'Passport fee', 'The fee for the passport type you choose.', true, true],
  ['PASSPORT_NEW', 'minor', "Child's birth certificate", 'Original birth certificate of the child.', false, true],
  ['PASSPORT_NEW', 'minor', 'Parent or guardian accompaniment', 'A parent or legal guardian must come with the child.', false, true],
  ['PASSPORT_NEW', 'minor', 'Parent or guardian consent letter', 'A signed letter giving consent for the passport.', false, true],
  ['PASSPORT_NEW', 'minor', 'Parent or guardian identity documents', 'The National ID card of the parent or guardian.', false, true],
  ['PASSPORT_NEW', 'minor', 'Passport fee', 'The fee for the passport type you choose.', true, true],

  ['PASSPORT_REPLACE', 'adult', 'Existing or old passport', 'Bring the passport you are replacing.', false, true],
  ['PASSPORT_REPLACE', 'adult', 'Identity Card', 'Your original National ID card.', false, true],
  ['PASSPORT_REPLACE', 'adult', 'Passport fee', 'The fee for the passport type you choose.', true, true],
  // No minor replacement requirements: not yet confirmed from an official source.

  ['DRIVING_LICENCE_RENEWAL', 'any', 'Current or expired driving licence', '', false, false],
  ['DRIVING_LICENCE_RENEWAL', 'any', 'National ID card', '', false, false],
  ['LEARNER_LICENCE', 'any', 'National ID card', '', false, false],
  ['VEHICLE_LICENCE', 'any', 'Vehicle registration document', '', false, false],
  ['VEHICLE_LICENCE', 'any', 'National ID card', '', false, false],
  ['SALARY_STATEMENT', 'any', 'Employee number', 'Your government employee number.', false, false],
  ['SALARY_STATEMENT', 'any', 'National ID card', '', false, false],
  ['PAYMENT_ENQUIRY', 'any', 'Invoice or order number', 'The number on the invoice you sent to government.', false, false],
  ['OLD_AGE_PENSION', 'any', 'National ID card', '', false, false],
  ['PENSION_LIFE_CERT', 'any', 'National ID card', '', false, false],
  ['PENSION_LIFE_CERT', 'any', 'Pension number (if you have one)', '', false, false],
  ['POLICE_CLEARANCE', 'any', 'National ID card', '', false, false],
  ['POLICE_CLEARANCE', 'any', 'Fingerprints', 'Taken by an officer at the station. Nothing to bring.', false, false],
  ['LOSS_REPORT', 'any', 'Any identification you still have', 'For example a birth certificate or another document.', false, false],
  ['LOSS_REPORT', 'any', 'Details of the lost document', 'Document number if you know it, and where and when it was lost.', false, false],
];

const FEES = [
  ['PASSPORT_NEW', 'REG32', 'Regular passport, 32 pages', 130],
  ['PASSPORT_NEW', 'REG64', 'Regular passport, 64 pages', 300],
  ['PASSPORT_REPLACE', 'REG32', 'Regular passport, 32 pages', 130],
  ['PASSPORT_REPLACE', 'REG64', 'Regular passport, 64 pages', 300],
];

const HOLIDAYS = [
  ['2026-01-01', "New Year's Day"], ['2026-03-11', "Moshoeshoe's Day"], ['2026-04-03', 'Good Friday'],
  ['2026-04-06', 'Easter Monday'], ['2026-05-01', "Workers' Day"], ['2026-05-14', 'Ascension Day'],
  ['2026-05-25', "Africa / Heroes' Day"], ['2026-07-17', "King's Birthday"], ['2026-10-04', 'Independence Day'],
  ['2026-12-25', 'Christmas Day'], ['2026-12-26', 'Boxing Day'],
  ['2027-01-01', "New Year's Day"], ['2027-03-11', "Moshoeshoe's Day"], ['2027-03-26', 'Good Friday'],
  ['2027-03-29', 'Easter Monday'], ['2027-05-01', "Workers' Day"], ['2027-05-06', 'Ascension Day'],
  ['2027-05-25', "Africa / Heroes' Day"], ['2027-07-17', "King's Birthday"], ['2027-10-04', 'Independence Day'],
  ['2027-12-25', 'Christmas Day'], ['2027-12-26', 'Boxing Day'],
];

const SETTINGS = [
  ['slot_horizon_days', 21, 'How many days ahead the system opens appointment slots.'],
  ['draft_reminder_days', 3, 'Remind citizens about unfinished applications after this many days.'],
  ['draft_expiry_days', 30, 'Cancel untouched drafts automatically after this many days.'],
  ['visit_reminder_hours', 24, 'Send a visit reminder this many hours before the appointment.'],
  ['consent_expiry_days', 7, 'Expire unanswered consent requests after this many days.'],
  ['pension_notice_days', 60, 'Tell citizens about pension eligibility this many days before they qualify.'],
  ['minor_age_limit', 16, 'Applicants below this age are treated as minors.'],
];

// Fields each department sees by default when serving a citizen (least privilege).
const FIELD_PERMISSIONS = {
  HOME_AFFAIRS: ['full_name', 'date_of_birth', 'sex', 'national_id', 'phone', 'email', 'address', 'district', 'verification_status'],
  PASSPORT: ['full_name', 'date_of_birth', 'sex', 'national_id', 'district', 'verification_status'],
  TRAFFIC: ['full_name', 'date_of_birth', 'national_id_masked', 'district', 'phone'],
  FINANCE: ['full_name', 'national_id_masked', 'phone', 'email'],
  PENSION: ['full_name', 'date_of_birth', 'national_id_masked', 'district', 'phone', 'verification_status'],
  POLICE: ['full_name', 'date_of_birth', 'sex', 'national_id_masked', 'district'],
};

// [dept, field, purpose, requires_consent, auto_approve, max_days]
const POLICIES = [
  ['PENSION', 'national_id', 'Confirm the identity of the pension beneficiary', true, true, 14],
  ['PENSION', 'address', 'Arrange a home visit for a beneficiary who cannot travel', true, false, 14],
  ['TRAFFIC', 'national_id', 'Confirm the identity of the licence holder', true, true, 14],
  ['TRAFFIC', 'address', 'Record the licence holder address', true, true, 14],
  ['FINANCE', 'date_of_birth', 'Match a payment to the correct person', true, true, 14],
  ['FINANCE', 'national_id', 'Match a payment to the correct person', true, false, 14],
  ['PASSPORT', 'phone', 'Contact the applicant about collection', true, true, 30],
  ['PASSPORT', 'address', 'Record the applicant address on the passport file', true, true, 30],
  ['POLICE', 'national_id', 'Confirm identity for a clearance certificate', false, false, 7],
  ['POLICE', 'address', 'Contact a person named in a report', false, false, 7],
  ['POLICE', 'phone', 'Contact a person named in a report', false, false, 7],
];

/** Reference data needed by every deployment. Safe to run repeatedly. */
export async function seedReferenceData(db) {
  const { rows } = await db.query('SELECT count(*)::int AS n FROM departments');
  if (rows[0].n === 0) {
    console.log('[seed] reference data');
    for (const [i, d] of DEPARTMENTS.entries()) {
      await db.query(
        'INSERT INTO departments (code, name, short_name, description, is_data_owner, sort_order) VALUES ($1,$2,$3,$4,$5,$6)',
        [...d, i]
      );
    }
    const dep = await deptMap(db);

    for (const [i, s] of SERVICES.entries()) {
      const [deptCode, code, prefix, name, summary, appliesTo, reqId, reqAppt, minAge, verified, note] = s;
      await db.query(
        `INSERT INTO services (department_id, code, ref_prefix, name, summary, applies_to, requires_national_id,
           requires_appointment, min_age, requirements_verified, in_person_note, sort_order)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,COALESCE($11,'You must attend the office in person so an officer can check your original documents.'),$12)`,
        [dep[deptCode], code, prefix, name, summary, appliesTo, reqId, reqAppt, minAge, verified, note, i]
      );
    }
    const svc = await serviceMap(db);
    for (const [i, r] of REQUIREMENTS.entries()) {
      const [code, cat, label, detail, isFee, ver] = r;
      await db.query(
        `INSERT INTO service_requirements (service_id, applicant_category, label, detail, is_fee, is_verified, sort_order)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [svc[code], cat, label, detail, isFee, ver, i]
      );
    }
    for (const [code, feeCode, label, amount] of FEES) {
      await db.query(
        `INSERT INTO service_fees (service_id, code, label, amount, note, is_verified)
         VALUES ($1,$2,$3,$4,'Fee supplied for this project. Verify against current official requirements before relying on it.', false)`,
        [svc[code], feeCode, label, amount]
      );
    }

    for (const [deptCode, kind] of [
      ['HOME_AFFAIRS', 'Home Affairs Office'], ['PASSPORT', 'Passport Office'], ['TRAFFIC', 'Traffic Office'],
      ['PENSION', 'Pension Office'], ['POLICE', 'Police Station'],
    ]) {
      for (const [district, town] of DISTRICTS) {
        await db.query(
          `INSERT INTO offices (department_id, name, district, location) VALUES ($1,$2,$3,$4)`,
          [dep[deptCode], `${town} ${kind}`, district, `${town}, ${district} district. Street address to be confirmed with the department.`]
        );
      }
    }
    await db.query(
      `INSERT INTO offices (department_id, name, district, location) VALUES ($1,'Maseru Finance Office','Maseru',
        'Maseru, Maseru district. Street address to be confirmed with the department.')`,
      [dep.FINANCE]
    );

    for (const [d, n] of HOLIDAYS) {
      await db.query('INSERT INTO holidays VALUES ($1,$2) ON CONFLICT DO NOTHING', [d, n]);
    }
    for (const [k, v, desc] of SETTINGS) {
      await db.query('INSERT INTO settings VALUES ($1,$2,$3) ON CONFLICT DO NOTHING', [k, JSON.stringify(v), desc]);
    }
    for (const [deptCode, fields] of Object.entries(FIELD_PERMISSIONS)) {
      for (const f of fields) {
        await db.query('INSERT INTO department_field_permissions VALUES ($1,$2)', [dep[deptCode], f]);
      }
    }
    for (const [deptCode, field, purpose, consent, auto, days] of POLICIES) {
      await db.query(
        `INSERT INTO data_sharing_policies (requesting_department_id, field, purpose, requires_consent, auto_approve, max_days)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [dep[deptCode], field, purpose, consent, auto, days]
      );
    }
  }

  // Bootstrap the system administrator once.
  const admins = await db.query("SELECT 1 FROM staff WHERE role = 'admin' LIMIT 1");
  if (admins.rowCount === 0) {
    console.log(`[seed] creating administrator ${config.adminEmail}`);
    await db.query(
      `INSERT INTO staff (staff_number, full_name, email, password_hash, role, must_change_password)
       VALUES ('ADM-001','System Administrator',$1,$2,'admin',$3)`,
      [config.adminEmail, await bcrypt.hash(config.adminPassword, 10), !config.seedDemo]
    );
  }
}

/** Demonstration data, clearly flagged. Disable with SEED_DEMO=false. */
export async function seedDemoData(db) {
  const { rows } = await db.query('SELECT count(*)::int AS n FROM population_register WHERE is_demo');
  if (rows[0].n > 0) return;
  console.log('[seed] demonstration data');
  const dep = await deptMap(db);
  const svc = await serviceMap(db);

  const register = [
    ['DEMO100001', 'Palesa', 'Mokoena', '1995-04-12', 'F', 'Maseru'],
    ['DEMO100002', "'Makhotso", 'Lebona', '1952-02-14', 'F', 'Mafeteng'],
    ['DEMO100003', 'Thabo', 'Mofokeng', '1988-09-30', 'M', 'Leribe'],
    ['DEMO100004', 'Tumelo', 'Ramoeletsi', '1956-12-01', 'M', 'Berea'],
    ['DEMO100005', 'Lerato', 'Nthako', '2001-06-05', 'F', 'Maseru'],
    ['DEMO100006', 'Teboho', 'Sello', '1979-11-23', 'M', "Mohale's Hoek"],
    ['DEMO100007', 'Mpho', 'Khoali', '1999-07-21', 'F', 'Quthing'],
    ['DEMO100008', 'Neo', 'Matsoso', '1990-01-15', 'M', 'Butha-Buthe'],
  ];
  const regIds = {};
  for (const [nid, fn, sn, dob, sex, district] of register) {
    const r = await db.query(
      `INSERT INTO population_register (national_id, first_name, surname, date_of_birth, sex, district, is_demo)
       VALUES ($1,$2,$3,$4,$5,$6,true) RETURNING id`,
      [nid, fn, sn, dob, sex, district]
    );
    regIds[nid] = r.rows[0].id;
  }

  const citizenHash = await bcrypt.hash('Citizen@2026', 10);
  const citizens = [
    ['DEMO100001', 'Palesa', 'Mokoena', '1995-04-12', 'F', '58000001', 'palesa@example.com', 'Maseru', 'Ha Thetsane, Maseru'],
    ['DEMO100002', "'Makhotso", 'Lebona', '1952-02-14', 'F', '58000002', null, 'Mafeteng', 'Ha Ramokoatsi, Mafeteng'],
    ['DEMO100003', 'Thabo', 'Mofokeng', '1988-09-30', 'M', '58000003', 'thabo@example.com', 'Leribe', 'Hlotse, Leribe'],
  ];
  const cit = {};
  for (const [nid, fn, sn, dob, sex, phone, email, district, address] of citizens) {
    const r = await db.query(
      `INSERT INTO citizens (register_id, national_id, first_name, surname, date_of_birth, sex, phone, email, district, address,
         password_hash, verification_status, verified_at, verified_by, verification_note)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'verified',now(),'SYSTEM','Matched automatically with the population register (demo data).')
       RETURNING id`,
      [regIds[nid], nid, fn, sn, dob, sex, phone, email, district, address, citizenHash]
    );
    cit[nid] = r.rows[0].id;
  }

  const staffHash = await bcrypt.hash('Staff@2026', 10);
  const offices = await db.query("SELECT id, department_id FROM offices WHERE district = 'Maseru'");
  const officeFor = (deptId) => offices.rows.find((o) => o.department_id === deptId)?.id ?? null;
  const staff = [
    ['HA-001', 'Lineo Mahao', 'ha.officer@gov.ls.demo', 'HOME_AFFAIRS', 'officer'],
    ['HA-002', 'Mosa Phakoe', 'ha.supervisor@gov.ls.demo', 'HOME_AFFAIRS', 'supervisor'],
    ['PS-001', 'Rethabile Tau', 'passport.officer@gov.ls.demo', 'PASSPORT', 'officer'],
    ['PS-002', 'Kananelo Moshoeshoe', 'passport.supervisor@gov.ls.demo', 'PASSPORT', 'supervisor'],
    ['TR-001', 'Bokang Letsie', 'traffic.officer@gov.ls.demo', 'TRAFFIC', 'officer'],
    ['FN-001', 'Nthabiseng Molapo', 'finance.officer@gov.ls.demo', 'FINANCE', 'officer'],
    ['PN-001', 'Hlompho Seeiso', 'pension.officer@gov.ls.demo', 'PENSION', 'officer'],
    ['PN-002', 'Lisebo Nkuebe', 'pension.supervisor@gov.ls.demo', 'PENSION', 'supervisor'],
    ['PL-001', 'Tsepo Majara', 'police.officer@gov.ls.demo', 'POLICE', 'officer'],
  ];
  const staffIds = {};
  for (const [num, name, email, deptCode, role] of staff) {
    const r = await db.query(
      `INSERT INTO staff (staff_number, full_name, email, password_hash, department_id, office_id, role, must_change_password)
       VALUES ($1,$2,$3,$4,$5,$6,$7,false) RETURNING id`,
      [num, name, email, staffHash, dep[deptCode], officeFor(dep[deptCode]), role]
    );
    staffIds[num] = r.rows[0].id;
  }

  // Sample applications with realistic history
  const passportOffice = officeFor(dep.PASSPORT);
  const fee = await db.query("SELECT id, amount FROM service_fees WHERE service_id = $1 AND code = 'REG32'", [svc.PASSPORT_NEW]);
  const reqs = await db.query('SELECT id FROM service_requirements WHERE service_id = $1 AND applicant_category = $2', [svc.PASSPORT_NEW, 'adult']);
  const checklist = Object.fromEntries(reqs.rows.map((r) => [r.id, true]));

  const makeApp = async ({ citizen, service, deptCode, status, office, history, checklist: cl = {}, feeRow, reason, daysAgo }) => {
    const prefix = (await db.query('SELECT ref_prefix FROM services WHERE id=$1', [service])).rows[0].ref_prefix;
    const ref = await nextApplicationReference(db, prefix);
    const r = await db.query(
      `INSERT INTO applications (reference, citizen_id, service_id, department_id, applicant_category, checklist, fee_id, fee_amount,
         office_id, status, status_reason, created_at, last_status_at, submitted_at)
       VALUES ($1,$2,$3,$4,'adult',$5,$6,$7,$8,$9,$10, now() - ($11 || ' days')::interval, now() - interval '1 day',
         CASE WHEN $9 IN ('submitted','under_review','additional_info_required','completed') THEN now() - interval '2 days' END)
       RETURNING id`,
      [ref, citizen, service, dep[deptCode], JSON.stringify(cl), feeRow?.id ?? null, feeRow?.amount ?? null, office, status, reason ?? null, String(daysAgo)]
    );
    let prev = null;
    for (const [i, [to, actor, note]] of history.entries()) {
      await db.query(
        `INSERT INTO application_events (application_id, from_status, to_status, note, actor_type, actor_label, created_at)
         VALUES ($1,$2,$3,$4,$5,$6, now() - ($7 || ' hours')::interval)`,
        [r.rows[0].id, prev, to, note, actor, actor === 'system' ? 'System' : actor === 'staff' ? 'Officer' : 'Citizen', String((history.length - i) * 20)]
      );
      prev = to;
    }
    return { id: r.rows[0].id, ref };
  };

  const a1 = await makeApp({
    citizen: cit.DEMO100001, service: svc.PASSPORT_NEW, deptCode: 'PASSPORT', status: 'under_review', office: passportOffice,
    checklist, feeRow: fee.rows[0], daysAgo: 9,
    history: [
      ['draft', 'citizen', 'Application started'],
      ['preparing_documents', 'citizen', 'Requirements reviewed'],
      ['ready_for_visit', 'system', 'Checklist complete and visit booked'],
      ['submitted', 'staff', 'Documents checked at the office'],
      ['under_review', 'system', 'Automatic checks passed: identity verified, no duplicate application'],
    ],
  });
  const a2 = await makeApp({
    citizen: cit.DEMO100001, service: svc.DRIVING_LICENCE_RENEWAL, deptCode: 'TRAFFIC', status: 'additional_info_required',
    office: officeFor(dep.TRAFFIC), daysAgo: 6, reason: 'Please tell us the number on your current driving licence.',
    history: [
      ['draft', 'citizen', 'Application started'],
      ['preparing_documents', 'citizen', 'Requirements reviewed'],
      ['ready_for_visit', 'system', 'Checklist complete and visit booked'],
      ['submitted', 'staff', 'Documents checked at the office'],
      ['under_review', 'system', 'Automatic checks passed'],
      ['additional_info_required', 'staff', 'Please tell us the number on your current driving licence.'],
    ],
  });
  await db.query(
    `INSERT INTO info_requests (application_id, kind, message, requested_by) VALUES ($1,'information',$2,$3)`,
    [a2.id, 'Please tell us the number on your current driving licence.', staffIds['TR-001']]
  );

  await db.query(
    `INSERT INTO previous_passports (citizen_id, issue_year, passport_type, reference) VALUES
     ($1, 2015, 'Regular passport, 32 pages', 'Old passport ending 4471')`,
    [cit.DEMO100003]
  );

  const notes = [
    [cit.DEMO100001, 'status_changed', 'Passport application under review', `Your application ${a1.ref} passed the automatic checks and is now under review.`, `/applications/${a1.id}`],
    [cit.DEMO100001, 'info_required', 'More information needed', `Traffic Services needs more information for ${a2.ref}. Open the application to reply.`, `/applications/${a2.id}`],
    [cit.DEMO100002, 'system', 'Welcome', 'Your account is verified. You can now apply for services and book office visits.', '/services'],
  ];
  for (const n of notes) {
    await db.query('INSERT INTO notifications (citizen_id, type, title, body, link) VALUES ($1,$2,$3,$4,$5)', n);
  }
}

async function deptMap(db) {
  const { rows } = await db.query('SELECT id, code FROM departments');
  return Object.fromEntries(rows.map((r) => [r.code, r.id]));
}
async function serviceMap(db) {
  const { rows } = await db.query('SELECT id, code FROM services');
  return Object.fromEntries(rows.map((r) => [r.code, r.id]));
}
