import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { query, tx } from '../db.js';
import { ah, parse, badRequest, notFound } from '../lib/http.js';
import { audit } from '../lib/audit.js';
import { notify } from '../lib/notify.js';
import { normalisePhone, CITIZEN_FIELDS, STATUS_LABELS } from '../lib/util.js';
import { routeForApproval } from '../lib/access.js';
import { requireCitizen } from '../middleware/auth.js';
import { citizenDto } from './auth.js';

const router = Router();
router.use(requireCitizen);

router.get('/dashboard', ah(async (req, res) => {
  const id = req.citizen.id;
  const [apps, counts, upcoming, notes, consents] = await Promise.all([
    query(
      `SELECT a.id, a.reference, a.status, a.last_status_at, a.created_at, s.name AS service_name, s.code AS service_code,
              d.short_name AS department_name, d.code AS department_code
         FROM applications a JOIN services s ON s.id = a.service_id JOIN departments d ON d.id = a.department_id
        WHERE a.citizen_id = $1 ORDER BY a.last_status_at DESC LIMIT 5`, [id]),
    query(`SELECT status, count(*)::int AS n FROM applications WHERE citizen_id = $1 GROUP BY status`, [id]),
    query(
      `SELECT a.id, a.reference, s.name AS service_name, sl.starts_at, o.name AS office_name, o.location
         FROM applications a JOIN services s ON s.id = a.service_id
         JOIN appointment_slots sl ON sl.id = a.slot_id JOIN offices o ON o.id = sl.office_id
        WHERE a.citizen_id = $1 AND a.status = 'ready_for_visit' AND sl.starts_at > now()
        ORDER BY sl.starts_at LIMIT 3`, [id]),
    query(`SELECT id, type, title, body, link, is_read, created_at FROM notifications WHERE citizen_id = $1 ORDER BY created_at DESC LIMIT 4`, [id]),
    query(`SELECT count(*)::int AS n FROM access_requests WHERE citizen_id = $1 AND status = 'pending_consent'`, [id]),
  ]);
  const byStatus = Object.fromEntries(counts.rows.map((r) => [r.status, r.n]));
  res.json({
    citizen: citizenDto(req.citizen),
    summary: {
      active: ['draft', 'preparing_documents', 'ready_for_visit', 'submitted', 'under_review'].reduce((n, s) => n + (byStatus[s] || 0), 0),
      actionNeeded: (byStatus.additional_info_required || 0) + (byStatus.draft || 0) + (byStatus.preparing_documents || 0),
      completed: byStatus.completed || 0,
      byStatus,
    },
    recentApplications: apps.rows.map((a) => ({ ...a, status_label: STATUS_LABELS[a.status] })),
    upcomingVisits: upcoming.rows,
    notifications: notes.rows,
    pendingConsents: consents.rows[0].n,
  });
}));

// ---------------------------------------------------------------- profile
router.get('/profile', (req, res) => res.json({ citizen: citizenDto(req.citizen) }));

const profileSchema = z.object({
  phone: z.string().transform(normalisePhone).pipe(z.string().regex(/^[256]\d{7}$/, 'Enter an 8-digit Lesotho number, for example 5800 0000.')),
  email: z.string().trim().email('Enter a valid email address, like name@example.com.').or(z.literal('')).nullable().optional(),
  address: z.string().trim().max(200, 'Keep the address under 200 characters.').optional().nullable(),
  district: z.string().min(1, 'Choose your district.'),
});

router.patch('/profile', ah(async (req, res) => {
  const v = parse(profileSchema, req.body);
  const email = v.email ? v.email.toLowerCase() : null;
  const c = req.citizen;
  const clash = await query(
    'SELECT phone, lower(email) AS email FROM citizens WHERE id <> $1 AND (phone = $2 OR lower(email) = $3)', [c.id, v.phone, email]
  );
  const fields = {};
  for (const r of clash.rows) {
    if (r.phone === v.phone) fields.phone = 'This phone number is used by another account.';
    if (email && r.email === email) fields.email = 'This email is used by another account.';
  }
  if (Object.keys(fields).length) throw badRequest('Some details are already used by another account.', fields);

  const changed = [];
  if (v.phone !== c.phone) changed.push('phone');
  if ((email || null) !== (c.email || null)) changed.push('email');
  if ((v.address || null) !== (c.address || null)) changed.push('address');
  if (v.district !== c.district) changed.push('district');
  if (!changed.length) return res.json({ citizen: citizenDto(c), message: 'Nothing changed.' });

  const r = await query(
    'UPDATE citizens SET phone = $2, email = $3, address = $4, district = $5 WHERE id = $1 RETURNING *',
    [c.id, v.phone, email, v.address || null, v.district]
  );
  await audit(null, req, { action: 'PROFILE_UPDATED', entityType: 'citizen', entityId: c.id, citizenId: c.id, details: { changed } });
  await notify(null, c.id, { type: 'system', title: 'Profile updated', body: `You changed: ${changed.join(', ')}. If this was not you, change your password now.`, link: '/profile' });
  res.json({ citizen: citizenDto(r.rows[0]), message: 'Your profile was updated.' });
}));

router.post('/reveal-id', ah(async (req, res) => {
  const { password } = parse(z.object({ password: z.string().min(1, 'Enter your password.') }), req.body);
  if (!(await bcrypt.compare(password, req.citizen.password_hash))) {
    await audit(null, req, { action: 'ID_REVEAL_FAILED', entityType: 'citizen', entityId: req.citizen.id, citizenId: req.citizen.id, outcome: 'failed' });
    throw badRequest('Your password is not correct.', { password: 'Your password is not correct.' });
  }
  await audit(null, req, { action: 'ID_REVEALED', entityType: 'citizen', entityId: req.citizen.id, citizenId: req.citizen.id });
  res.json({ nationalId: req.citizen.national_id });
}));

router.post('/change-password', ah(async (req, res) => {
  const v = parse(z.object({
    currentPassword: z.string().min(1, 'Enter your current password.'),
    newPassword: z.string().min(8, 'Use at least 8 characters.').regex(/[A-Za-z]/, 'Include a letter.').regex(/[0-9]/, 'Include a number.'),
  }), req.body);
  if (!(await bcrypt.compare(v.currentPassword, req.citizen.password_hash))) {
    throw badRequest('Your current password is not correct.', { currentPassword: 'Your current password is not correct.' });
  }
  await query('UPDATE citizens SET password_hash = $2 WHERE id = $1', [req.citizen.id, await bcrypt.hash(v.newPassword, 10)]);
  await audit(null, req, { action: 'PASSWORD_CHANGED', entityType: 'citizen', entityId: req.citizen.id, citizenId: req.citizen.id });
  res.json({ message: 'Your password was changed.' });
}));

// ---------------------------------------------------------------- notifications
router.get('/notifications', ah(async (req, res) => {
  const { rows } = await query(
    'SELECT id, type, title, body, link, is_read, created_at FROM notifications WHERE citizen_id = $1 ORDER BY created_at DESC LIMIT 200',
    [req.citizen.id]
  );
  res.json({ notifications: rows });
}));

router.post('/notifications/:id/read', ah(async (req, res) => {
  const r = await query('UPDATE notifications SET is_read = true WHERE id = $1 AND citizen_id = $2 RETURNING id', [req.params.id, req.citizen.id]);
  if (!r.rowCount) throw notFound('Notification not found.');
  res.json({ ok: true });
}));

router.post('/notifications/read-all', ah(async (req, res) => {
  const r = await query('UPDATE notifications SET is_read = true WHERE citizen_id = $1 AND NOT is_read', [req.citizen.id]);
  res.json({ updated: r.rowCount });
}));

// ---------------------------------------------------------------- previous passports
router.get('/previous-passports', ah(async (req, res) => {
  const { rows } = await query(
    'SELECT id, issue_year, passport_type, reference, created_at FROM previous_passports WHERE citizen_id = $1 ORDER BY issue_year DESC, id DESC',
    [req.citizen.id]
  );
  res.json({ records: rows });
}));

router.post('/previous-passports', ah(async (req, res) => {
  const year = new Date().getFullYear();
  const v = parse(z.object({
    issueYear: z.coerce.number({ invalid_type_error: 'Enter the year the passport was issued.' }).int().min(1966, 'Enter a year from 1966.').max(year, `The year cannot be after ${year}.`),
    passportType: z.string().min(1, 'Choose the passport type.'),
    reference: z.string().trim().max(60).optional().nullable(),
  }), req.body);
  const r = await query(
    'INSERT INTO previous_passports (citizen_id, issue_year, passport_type, reference) VALUES ($1,$2,$3,$4) RETURNING *',
    [req.citizen.id, v.issueYear, v.passportType, v.reference || null]
  );
  await audit(null, req, { action: 'PASSPORT_HISTORY_ADDED', entityType: 'previous_passport', entityId: r.rows[0].id, citizenId: req.citizen.id });
  res.status(201).json({ record: r.rows[0] });
}));

router.delete('/previous-passports/:id', ah(async (req, res) => {
  const r = await query('DELETE FROM previous_passports WHERE id = $1 AND citizen_id = $2', [req.params.id, req.citizen.id]);
  if (!r.rowCount) throw notFound('Record not found.');
  await audit(null, req, { action: 'PASSPORT_HISTORY_REMOVED', entityType: 'previous_passport', entityId: req.params.id, citizenId: req.citizen.id });
  res.json({ ok: true });
}));

// ---------------------------------------------------------------- privacy and consent
router.get('/privacy', ah(async (req, res) => {
  const id = req.citizen.id;
  const requests = await query(
    `SELECT ar.id, ar.reference, ar.fields, ar.purpose, ar.status, ar.consent_status, ar.created_at, ar.decided_at, ar.expires_at,
            ar.decision_note, d.name AS department_name, a.reference AS application_reference
       FROM access_requests ar JOIN departments d ON d.id = ar.requesting_department_id
       LEFT JOIN applications a ON a.id = ar.application_id
      WHERE ar.citizen_id = $1 ORDER BY ar.created_at DESC LIMIT 100`, [id]
  );
  const log = await query(
    `SELECT l.at, l.action, l.outcome, l.details, d.name AS department_name
       FROM audit_log l LEFT JOIN departments d ON d.id = l.department_id
      WHERE l.citizen_id = $1 AND l.actor_type IN ('staff','system')
        AND l.action IN ('VIEW_CITIZEN_RECORD','ACCESS_REQUEST_DECIDED','ACCESS_EXPIRED','IDENTITY_VERIFIED','IDENTITY_REJECTED','APPLICATION_STATUS_CHANGED')
      ORDER BY l.at DESC LIMIT 100`, [id]
  );
  const defaults = await query(
    `SELECT d.name, array_agg(p.field ORDER BY p.field) AS fields
       FROM department_field_permissions p JOIN departments d ON d.id = p.department_id
      GROUP BY d.name, d.sort_order ORDER BY d.sort_order`
  );
  res.json({
    fieldLabels: CITIZEN_FIELDS,
    requests: requests.rows,
    accessLog: log.rows.map((r) => ({ at: r.at, action: r.action, outcome: r.outcome, department: r.department_name, fields: r.details?.fields, purpose: r.details?.purpose, reference: r.details?.reference })),
    departmentDefaults: defaults.rows,
  });
}));

router.post('/consents/:id', ah(async (req, res) => {
  const { decision } = parse(z.object({ decision: z.enum(['give', 'refuse']) }), req.body);
  const result = await tx(async (db) => {
    const ar = (await db.query('SELECT * FROM access_requests WHERE id = $1 AND citizen_id = $2 FOR UPDATE', [req.params.id, req.citizen.id])).rows[0];
    if (!ar) throw notFound('Request not found.');
    if (ar.status !== 'pending_consent') throw badRequest('This request is no longer waiting for your answer.');
    if (decision === 'refuse') {
      const r = await db.query(
        `UPDATE access_requests SET consent_status = 'refused', consent_at = now(), status = 'denied', decided_by_system = true,
           decided_at = now(), decision_note = 'The citizen did not give consent.' WHERE id = $1 RETURNING *`, [ar.id]
      );
      await audit(db, req, { action: 'CONSENT_REFUSED', entityType: 'access_request', entityId: ar.reference, citizenId: ar.citizen_id,
        departmentId: ar.requesting_department_id, details: { fields: ar.fields } });
      return r.rows[0];
    }
    const r = await db.query(`UPDATE access_requests SET consent_status = 'given', consent_at = now() WHERE id = $1 RETURNING *`, [ar.id]);
    await audit(db, req, { action: 'CONSENT_GIVEN', entityType: 'access_request', entityId: ar.reference, citizenId: ar.citizen_id,
      departmentId: ar.requesting_department_id, details: { fields: ar.fields } });
    return routeForApproval(db, r.rows[0]);
  });
  const message = decision === 'refuse'
    ? 'You refused. The department cannot see this information.'
    : result.status === 'approved'
      ? `You gave consent. The department can see this information until ${new Date(result.expires_at).toLocaleDateString('en-GB')}.`
      : 'You gave consent. A Home Affairs supervisor will now review the request.';
  res.json({ request: result, message });
}));

router.post('/access/:id/revoke', ah(async (req, res) => {
  const r = await tx(async (db) => {
    const ar = (await db.query(
      `UPDATE access_requests SET status = 'revoked', decision_note = 'Access withdrawn by the citizen.'
        WHERE id = $1 AND citizen_id = $2 AND status = 'approved' RETURNING *`, [req.params.id, req.citizen.id]
    )).rows[0];
    if (!ar) throw badRequest('Only active access can be withdrawn.');
    await audit(db, req, { action: 'CONSENT_WITHDRAWN', entityType: 'access_request', entityId: ar.reference, citizenId: ar.citizen_id,
      departmentId: ar.requesting_department_id });
    return ar;
  });
  res.json({ request: r, message: 'Access withdrawn. The department can no longer see this information.' });
}));

export default router;
