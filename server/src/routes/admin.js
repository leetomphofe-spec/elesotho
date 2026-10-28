import { Router } from 'express';
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import { z } from 'zod';
import { query, tx } from '../db.js';
import { ah, parse, badRequest, notFound } from '../lib/http.js';
import { audit } from '../lib/audit.js';
import { CITIZEN_FIELDS, clearSettingsCache } from '../lib/util.js';
import { runAutomation } from '../lib/automation.js';
import { requireStaff, requirePasswordChanged, requireRole } from '../middleware/auth.js';

const router = Router();
router.use(requireStaff, requirePasswordChanged, requireRole('admin'));

const tempPassword = () => `Tmp-${crypto.randomBytes(4).toString('hex')}9`;

router.get('/overview', ah(async (_req, res) => {
  const [counts, runs, depts] = await Promise.all([
    query(`SELECT
      (SELECT count(*)::int FROM citizens) AS citizens,
      (SELECT count(*)::int FROM citizens WHERE verification_status = 'verified') AS verified,
      (SELECT count(*)::int FROM applications) AS applications,
      (SELECT count(*)::int FROM applications WHERE status NOT IN ('completed','rejected','cancelled')) AS open_applications,
      (SELECT count(*)::int FROM staff WHERE is_active) AS staff,
      (SELECT count(*)::int FROM population_register) AS register,
      (SELECT count(*)::int FROM appointment_slots WHERE starts_at > now()) AS future_slots,
      (SELECT count(*)::int FROM audit_log) AS audit_entries`),
    query('SELECT id, trigger, started_at, finished_at, result, error FROM job_runs ORDER BY started_at DESC LIMIT 10'),
    query('SELECT id, code, name, short_name FROM departments ORDER BY sort_order'),
  ]);
  res.json({ counts: counts.rows[0], jobRuns: runs.rows, departments: depts.rows });
}));

router.post('/automation/run', ah(async (req, res) => {
  const result = await runAutomation('manual');
  await audit(null, req, { action: 'AUTOMATION_RUN', details: result });
  res.json({ result, message: 'Automation finished.' });
}));

// ---------------------------------------------------------------- staff accounts
router.get('/staff', ah(async (_req, res) => {
  const { rows } = await query(
    `SELECT s.id, s.staff_number, s.full_name, s.email, s.role, s.is_active, s.department_id, s.office_id, s.last_login_at,
            s.must_change_password, d.short_name AS department, o.name AS office
       FROM staff s LEFT JOIN departments d ON d.id = s.department_id LEFT JOIN offices o ON o.id = s.office_id
      ORDER BY s.role = 'admin' DESC, d.sort_order, s.staff_number`
  );
  res.json({ staff: rows });
}));

const staffSchema = z.object({
  staffNumber: z.string().trim().min(2, 'Enter a staff number.').max(20),
  fullName: z.string().trim().min(3, 'Enter the full name.'),
  email: z.string().trim().email('Enter a valid work email.'),
  role: z.enum(['officer', 'supervisor']),
  departmentId: z.number({ invalid_type_error: 'Choose a department.' }).int(),
  officeId: z.number().int().nullable().optional(),
});

router.post('/staff', ah(async (req, res) => {
  const v = parse(staffSchema, req.body);
  const pw = tempPassword();
  const r = await query(
    `INSERT INTO staff (staff_number, full_name, email, password_hash, department_id, office_id, role, must_change_password)
     VALUES (upper($1),$2,lower($3),$4,$5,$6,$7,true) RETURNING id, staff_number`,
    [v.staffNumber, v.fullName, v.email, await bcrypt.hash(pw, 10), v.departmentId, v.officeId ?? null, v.role]
  );
  await audit(null, req, { action: 'STAFF_CREATED', entityType: 'staff', entityId: r.rows[0].id, details: { staffNumber: r.rows[0].staff_number, role: v.role, departmentId: v.departmentId } });
  res.status(201).json({ id: r.rows[0].id, temporaryPassword: pw, message: 'Account created. Give the temporary password to the employee in person. They must change it at first login.' });
}));

router.patch('/staff/:id', ah(async (req, res) => {
  const v = parse(z.object({
    role: z.enum(['officer', 'supervisor']).optional(),
    departmentId: z.number().int().optional(),
    officeId: z.number().int().nullable().optional(),
    isActive: z.boolean().optional(),
  }), req.body);
  const s = (await query('SELECT * FROM staff WHERE id = $1', [req.params.id])).rows[0];
  if (!s) throw notFound('Staff member not found.');
  if (s.role === 'admin') throw badRequest('The administrator account cannot be changed here.');
  const r = await query(
    `UPDATE staff SET role = COALESCE($2, role), department_id = COALESCE($3, department_id),
       office_id = CASE WHEN $5 THEN $4 ELSE office_id END, is_active = COALESCE($6, is_active),
       session_version = session_version + 1 WHERE id = $1 RETURNING id`,
    [s.id, v.role ?? null, v.departmentId ?? null, v.officeId ?? null, v.officeId !== undefined, v.isActive ?? null]
  );
  await audit(null, req, { action: 'STAFF_UPDATED', entityType: 'staff', entityId: s.id, details: v });
  res.json({ id: r.rows[0].id, message: 'Staff account updated. The employee has been signed out so the change takes effect.' });
}));

router.post('/staff/:id/reset-password', ah(async (req, res) => {
  const pw = tempPassword();
  const r = await query(
    `UPDATE staff SET password_hash = $2, must_change_password = true, session_version = session_version + 1, failed_logins = 0, locked_until = NULL
      WHERE id = $1 AND role <> 'admin' RETURNING id`, [req.params.id, await bcrypt.hash(pw, 10)]
  );
  if (!r.rowCount) throw notFound('Staff member not found.');
  await audit(null, req, { action: 'STAFF_PASSWORD_RESET', entityType: 'staff', entityId: req.params.id });
  res.json({ temporaryPassword: pw, message: 'Password reset. Give the temporary password to the employee in person.' });
}));

// ---------------------------------------------------------------- services, requirements, fees
router.get('/services', ah(async (_req, res) => {
  const services = await query(
    `SELECT s.*, d.short_name AS department FROM services s JOIN departments d ON d.id = s.department_id ORDER BY d.sort_order, s.sort_order`
  );
  const reqs = await query('SELECT * FROM service_requirements ORDER BY service_id, sort_order, id');
  const fees = await query('SELECT * FROM service_fees ORDER BY service_id, amount');
  res.json({
    services: services.rows.map((s) => ({
      ...s,
      requirements: reqs.rows.filter((r) => r.service_id === s.id),
      fees: fees.rows.filter((f) => f.service_id === s.id),
    })),
  });
}));

router.patch('/services/:id', ah(async (req, res) => {
  const v = parse(z.object({
    name: z.string().trim().min(3).optional(),
    summary: z.string().trim().min(3).optional(),
    inPersonNote: z.string().trim().min(3).optional(),
    isActive: z.boolean().optional(),
    requirementsVerified: z.boolean().optional(),
    requiresAppointment: z.boolean().optional(),
    minAge: z.number().int().min(0).max(120).nullable().optional(),
  }), req.body);
  const r = await query(
    `UPDATE services SET name = COALESCE($2, name), summary = COALESCE($3, summary), in_person_note = COALESCE($4, in_person_note),
       is_active = COALESCE($5, is_active), requirements_verified = COALESCE($6, requirements_verified),
       requires_appointment = COALESCE($7, requires_appointment), min_age = CASE WHEN $9 THEN $8 ELSE min_age END
     WHERE id = $1 RETURNING id`,
    [req.params.id, v.name ?? null, v.summary ?? null, v.inPersonNote ?? null, v.isActive ?? null, v.requirementsVerified ?? null,
      v.requiresAppointment ?? null, v.minAge ?? null, v.minAge !== undefined]
  );
  if (!r.rowCount) throw notFound('Service not found.');
  await audit(null, req, { action: 'SERVICE_UPDATED', entityType: 'service', entityId: req.params.id, details: v });
  res.json({ message: 'Service updated.' });
}));

const reqSchema = z.object({
  applicantCategory: z.enum(['adult', 'minor', 'any']),
  label: z.string().trim().min(2, 'Enter the requirement.'),
  detail: z.string().trim().max(300).optional().default(''),
  isFee: z.boolean().optional().default(false),
  isVerified: z.boolean().optional().default(false),
});

router.post('/services/:id/requirements', ah(async (req, res) => {
  const v = parse(reqSchema, req.body);
  const r = await query(
    `INSERT INTO service_requirements (service_id, applicant_category, label, detail, is_fee, is_verified, sort_order)
     VALUES ($1,$2,$3,$4,$5,$6,(SELECT COALESCE(max(sort_order),0)+1 FROM service_requirements WHERE service_id = $1)) RETURNING id`,
    [req.params.id, v.applicantCategory, v.label, v.detail, v.isFee, v.isVerified]
  );
  await audit(null, req, { action: 'REQUIREMENT_ADDED', entityType: 'service', entityId: req.params.id, details: v });
  res.status(201).json({ id: r.rows[0].id });
}));

router.patch('/requirements/:id', ah(async (req, res) => {
  const v = parse(reqSchema.partial(), req.body);
  await query(
    `UPDATE service_requirements SET applicant_category = COALESCE($2, applicant_category), label = COALESCE($3, label),
       detail = COALESCE($4, detail), is_fee = COALESCE($5, is_fee), is_verified = COALESCE($6, is_verified) WHERE id = $1`,
    [req.params.id, v.applicantCategory ?? null, v.label ?? null, v.detail ?? null, v.isFee ?? null, v.isVerified ?? null]
  );
  await audit(null, req, { action: 'REQUIREMENT_UPDATED', entityType: 'requirement', entityId: req.params.id, details: v });
  res.json({ message: 'Requirement updated.' });
}));

router.delete('/requirements/:id', ah(async (req, res) => {
  const used = await query('SELECT 1 FROM document_checks WHERE requirement_id = $1 LIMIT 1', [req.params.id]);
  if (used.rowCount) throw badRequest('This requirement has already been used in document checks, so it cannot be deleted.');
  await query('DELETE FROM service_requirements WHERE id = $1', [req.params.id]);
  await audit(null, req, { action: 'REQUIREMENT_REMOVED', entityType: 'requirement', entityId: req.params.id });
  res.json({ message: 'Requirement removed.' });
}));

router.post('/services/:id/fees', ah(async (req, res) => {
  const v = parse(z.object({
    code: z.string().trim().min(2).max(20), label: z.string().trim().min(2),
    amount: z.number().min(0), note: z.string().optional().default(''), isVerified: z.boolean().optional().default(false),
  }), req.body);
  await query(
    'INSERT INTO service_fees (service_id, code, label, amount, note, is_verified) VALUES ($1, upper($2), $3, $4, $5, $6)',
    [req.params.id, v.code, v.label, v.amount, v.note, v.isVerified]
  );
  await audit(null, req, { action: 'FEE_ADDED', entityType: 'service', entityId: req.params.id, details: v });
  res.status(201).json({ message: 'Fee added.' });
}));

router.patch('/fees/:id', ah(async (req, res) => {
  const v = parse(z.object({
    label: z.string().trim().min(2).optional(), amount: z.number().min(0).optional(), note: z.string().optional(),
    isVerified: z.boolean().optional(), isActive: z.boolean().optional(),
  }), req.body);
  await query(
    `UPDATE service_fees SET label = COALESCE($2,label), amount = COALESCE($3,amount), note = COALESCE($4,note),
       is_verified = COALESCE($5,is_verified), is_active = COALESCE($6,is_active) WHERE id = $1`,
    [req.params.id, v.label ?? null, v.amount ?? null, v.note ?? null, v.isVerified ?? null, v.isActive ?? null]
  );
  await audit(null, req, { action: 'FEE_UPDATED', entityType: 'fee', entityId: req.params.id, details: v });
  res.json({ message: 'Fee updated.' });
}));

// ---------------------------------------------------------------- offices
router.get('/offices', ah(async (_req, res) => {
  const { rows } = await query(
    `SELECT o.*, d.short_name AS department FROM offices o JOIN departments d ON d.id = o.department_id ORDER BY d.sort_order, o.district`
  );
  res.json({ offices: rows });
}));

const officeSchema = z.object({
  departmentId: z.number().int().optional(),
  name: z.string().trim().min(3).optional(),
  district: z.string().trim().min(2).optional(),
  location: z.string().trim().min(3).optional(),
  phone: z.string().trim().max(30).nullable().optional(),
  hours: z.string().trim().min(3).optional(),
  openTime: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  closeTime: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  slotMinutes: z.number().int().min(10).max(120).optional(),
  slotCapacity: z.number().int().min(1).max(100).optional(),
  detailsVerified: z.boolean().optional(),
  isActive: z.boolean().optional(),
});

router.post('/offices', ah(async (req, res) => {
  const v = parse(officeSchema.required({ departmentId: true, name: true, district: true }), req.body);
  const r = await query(
    `INSERT INTO offices (department_id, name, district, location, phone, hours) VALUES ($1,$2,$3,COALESCE($4,'Address to be confirmed'),$5,COALESCE($6,'Monday to Friday, 08:00 to 16:30')) RETURNING id`,
    [v.departmentId, v.name, v.district, v.location ?? null, v.phone || null, v.hours ?? null]
  );
  await audit(null, req, { action: 'OFFICE_ADDED', entityType: 'office', entityId: r.rows[0].id, details: v });
  res.status(201).json({ id: r.rows[0].id, message: 'Office added. Visit times are created at the next automation run.' });
}));

router.patch('/offices/:id', ah(async (req, res) => {
  const v = parse(officeSchema, req.body);
  await query(
    `UPDATE offices SET name = COALESCE($2,name), district = COALESCE($3,district), location = COALESCE($4,location),
       phone = CASE WHEN $13 THEN $5 ELSE phone END, hours = COALESCE($6,hours), open_time = COALESCE($7::time,open_time),
       close_time = COALESCE($8::time,close_time), slot_minutes = COALESCE($9,slot_minutes), slot_capacity = COALESCE($10,slot_capacity),
       details_verified = COALESCE($11,details_verified), is_active = COALESCE($12,is_active)
     WHERE id = $1`,
    [req.params.id, v.name ?? null, v.district ?? null, v.location ?? null, v.phone || null, v.hours ?? null, v.openTime ?? null,
      v.closeTime ?? null, v.slotMinutes ?? null, v.slotCapacity ?? null, v.detailsVerified ?? null, v.isActive ?? null, v.phone !== undefined]
  );
  if (v.slotCapacity) {
    await query('UPDATE appointment_slots SET capacity = GREATEST($2, booked) WHERE office_id = $1 AND starts_at > now()', [req.params.id, v.slotCapacity]);
  }
  await audit(null, req, { action: 'OFFICE_UPDATED', entityType: 'office', entityId: req.params.id, details: v });
  res.json({ message: 'Office updated.' });
}));

// ---------------------------------------------------------------- holidays
router.get('/holidays', ah(async (_req, res) => {
  const { rows } = await query("SELECT to_char(holiday_date,'YYYY-MM-DD') AS date, name FROM holidays ORDER BY holiday_date");
  res.json({ holidays: rows });
}));
router.post('/holidays', ah(async (req, res) => {
  const v = parse(z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Choose a date.'), name: z.string().trim().min(2, 'Enter the holiday name.') }), req.body);
  const blocked = await tx(async (db) => {
    await db.query('INSERT INTO holidays VALUES ($1,$2) ON CONFLICT (holiday_date) DO UPDATE SET name = EXCLUDED.name', [v.date, v.name]);
    // Close empty slots on that day; booked ones stay so staff can contact citizens.
    const r = await db.query(
      `UPDATE appointment_slots SET is_blocked = true WHERE (starts_at AT TIME ZONE 'Africa/Maseru')::date = $1::date RETURNING booked`, [v.date]
    );
    return r.rows.reduce((n, x) => n + x.booked, 0);
  });
  await audit(null, req, { action: 'HOLIDAY_ADDED', details: v });
  res.status(201).json({ message: blocked ? `Holiday saved. ${blocked} visit(s) were already booked that day: contact those citizens.` : 'Holiday saved. Visit times on that day are closed.' });
}));
router.delete('/holidays/:date', ah(async (req, res) => {
  await query('DELETE FROM holidays WHERE holiday_date = $1', [req.params.date]);
  await query(`UPDATE appointment_slots SET is_blocked = false WHERE (starts_at AT TIME ZONE 'Africa/Maseru')::date = $1::date`, [req.params.date]);
  await audit(null, req, { action: 'HOLIDAY_REMOVED', details: { date: req.params.date } });
  res.json({ message: 'Holiday removed.' });
}));

// ---------------------------------------------------------------- information sharing rules
router.get('/sharing', ah(async (_req, res) => {
  const [perms, policies] = await Promise.all([
    query('SELECT department_id, field FROM department_field_permissions'),
    query('SELECT p.*, d.short_name AS department FROM data_sharing_policies p JOIN departments d ON d.id = p.requesting_department_id ORDER BY d.sort_order, p.field'),
  ]);
  res.json({ permissions: perms.rows, policies: policies.rows, fieldLabels: CITIZEN_FIELDS });
}));

router.put('/sharing/permissions/:departmentId', ah(async (req, res) => {
  const { fields } = parse(z.object({ fields: z.array(z.enum(Object.keys(CITIZEN_FIELDS))) }), req.body);
  await tx(async (db) => {
    await db.query('DELETE FROM department_field_permissions WHERE department_id = $1', [req.params.departmentId]);
    for (const f of fields) await db.query('INSERT INTO department_field_permissions VALUES ($1,$2)', [req.params.departmentId, f]);
    await audit(db, req, { action: 'FIELD_PERMISSIONS_UPDATED', entityType: 'department', entityId: req.params.departmentId, details: { fields } });
  });
  res.json({ message: 'Default access updated.' });
}));

const policySchema = z.object({
  requestingDepartmentId: z.number().int(),
  field: z.enum(Object.keys(CITIZEN_FIELDS)),
  purpose: z.string().trim().min(10, 'Describe the purpose (at least 10 characters).'),
  requiresConsent: z.boolean(),
  autoApprove: z.boolean(),
  maxDays: z.number().int().min(1).max(365),
});
router.post('/sharing/policies', ah(async (req, res) => {
  const v = parse(policySchema, req.body);
  await query(
    `INSERT INTO data_sharing_policies (requesting_department_id, field, purpose, requires_consent, auto_approve, max_days)
     VALUES ($1,$2,$3,$4,$5,$6)
     ON CONFLICT (requesting_department_id, field) DO UPDATE SET purpose = EXCLUDED.purpose, requires_consent = EXCLUDED.requires_consent,
       auto_approve = EXCLUDED.auto_approve, max_days = EXCLUDED.max_days`,
    [v.requestingDepartmentId, v.field, v.purpose, v.requiresConsent, v.autoApprove, v.maxDays]
  );
  await audit(null, req, { action: 'SHARING_POLICY_SAVED', details: v });
  res.json({ message: 'Policy saved.' });
}));
router.delete('/sharing/policies/:id', ah(async (req, res) => {
  await query('DELETE FROM data_sharing_policies WHERE id = $1', [req.params.id]);
  await audit(null, req, { action: 'SHARING_POLICY_REMOVED', entityType: 'policy', entityId: req.params.id });
  res.json({ message: 'Policy removed.' });
}));

// ---------------------------------------------------------------- settings
router.get('/settings', ah(async (_req, res) => {
  const { rows } = await query('SELECT key, value, description FROM settings ORDER BY key');
  res.json({ settings: rows });
}));
router.patch('/settings', ah(async (req, res) => {
  const v = parse(z.record(z.number().int().min(0).max(3650)), req.body);
  for (const [k, val] of Object.entries(v)) {
    const r = await query('UPDATE settings SET value = $2 WHERE key = $1', [k, JSON.stringify(val)]);
    if (!r.rowCount) throw badRequest(`Unknown setting: ${k}`);
  }
  clearSettingsCache();
  await audit(null, req, { action: 'SETTINGS_UPDATED', details: v });
  res.json({ message: 'Settings saved.' });
}));

// ---------------------------------------------------------------- population register import
router.get('/register', ah(async (_req, res) => {
  const { rows } = await query(
    `SELECT count(*)::int AS total, count(*) FILTER (WHERE is_demo)::int AS demo, max(imported_at) AS last_import FROM population_register`
  );
  res.json(rows[0]);
}));

/** CSV columns: national_id,first_name,surname,date_of_birth(YYYY-MM-DD),sex(F/M),district[,life_status] */
router.post('/register/import', ah(async (req, res) => {
  const { csv } = parse(z.object({ csv: z.string().min(10, 'Paste the CSV content.').max(5_000_000) }), req.body);
  const lines = csv.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (/national_id/i.test(lines[0])) lines.shift();
  const errors = [];
  let imported = 0;
  await tx(async (db) => {
    for (const [i, line] of lines.entries()) {
      const [nid, fn, sn, dob, sex, district, life = 'alive'] = line.split(',').map((s) => s.trim());
      if (!/^[A-Za-z0-9]{6,15}$/.test(nid || '') || !fn || !sn || !/^\d{4}-\d{2}-\d{2}$/.test(dob || '') || !['F', 'M'].includes((sex || '').toUpperCase())) {
        errors.push(`Line ${i + 1}: check the values`);
        continue;
      }
      await db.query(
        `INSERT INTO population_register (national_id, first_name, surname, date_of_birth, sex, district, life_status)
         VALUES (upper($1),$2,$3,$4,upper($5),$6,$7)
         ON CONFLICT (national_id) DO UPDATE SET first_name = EXCLUDED.first_name, surname = EXCLUDED.surname,
           date_of_birth = EXCLUDED.date_of_birth, sex = EXCLUDED.sex, district = EXCLUDED.district,
           life_status = EXCLUDED.life_status, is_demo = false, imported_at = now()`,
        [nid, fn, sn, dob, sex, district || null, life === 'deceased' ? 'deceased' : 'alive']
      );
      imported++;
    }
    await audit(db, req, { action: 'REGISTER_IMPORTED', details: { imported, errors: errors.length } });
  });
  res.json({ imported, errors: errors.slice(0, 50), message: `${imported} record(s) imported.${errors.length ? ` ${errors.length} line(s) skipped.` : ''}` });
}));

export default router;
