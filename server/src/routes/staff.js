import { Router } from 'express';
import { z } from 'zod';
import { query, tx } from '../db.js';
import { ah, parse, badRequest, notFound, forbidden, conflict } from '../lib/http.js';
import { audit } from '../lib/audit.js';
import { notify } from '../lib/notify.js';
import { STATUS_LABELS, ageOn, CITIZEN_FIELDS } from '../lib/util.js';
import { transition, loadApplication, requirementsFor, checklistProgress, allowedNext } from '../lib/workflow.js';
import { citizenViewFor } from '../lib/access.js';
import { requireStaff, requirePasswordChanged, requireRole } from '../middleware/auth.js';

const router = Router();
router.use(requireStaff, requirePasswordChanged, requireRole('officer', 'supervisor'));

const staffActor = (req) => ({ type: 'staff', id: req.staff.id, label: `${req.staff.full_name} (${req.staff.staff_number})`, req });

/** Department guard. Denied attempts are recorded and nothing is revealed. */
async function departmentApplication(db, req, id) {
  const app = await loadApplication(db, id);
  if (!app) throw notFound('Application not found.');
  if (app.department_id !== req.staff.department_id) {
    await audit(db, req, { action: 'ACCESS_DENIED', entityType: 'application', entityId: id, outcome: 'denied',
      details: { reason: 'Application belongs to another department' } });
    throw forbidden(`Access denied. This application is handled by another department. ${req.staff.department_name} staff cannot open it. If you need information from it, submit an information request.`);
  }
  return app;
}

router.get('/dashboard', ah(async (req, res) => {
  const dept = req.staff.department_id;
  const [counts, today, myRequests, approvals, recent] = await Promise.all([
    query('SELECT status, count(*)::int AS n FROM applications WHERE department_id = $1 GROUP BY status', [dept]),
    query(
      `SELECT a.id, a.reference, s.name AS service_name, sl.starts_at, o.name AS office_name, a.status,
              c.first_name || ' ' || c.surname AS applicant_name
         FROM applications a JOIN services s ON s.id = a.service_id JOIN appointment_slots sl ON sl.id = a.slot_id
         JOIN offices o ON o.id = sl.office_id JOIN citizens c ON c.id = a.citizen_id
        WHERE a.department_id = $1 AND a.status = 'ready_for_visit'
          AND (sl.starts_at AT TIME ZONE 'Africa/Maseru')::date BETWEEN (now() AT TIME ZONE 'Africa/Maseru')::date
              AND (now() AT TIME ZONE 'Africa/Maseru')::date + 1
          AND ($2::int IS NULL OR o.id = $2)
        ORDER BY sl.starts_at LIMIT 30`, [dept, req.staff.office_id]),
    query(`SELECT status, count(*)::int AS n FROM access_requests WHERE requesting_department_id = $1 GROUP BY status`, [dept]),
    req.staff.is_data_owner && req.staff.role === 'supervisor'
      ? query(`SELECT count(*)::int AS n FROM access_requests WHERE status = 'pending_approval'`)
      : { rows: [{ n: 0 }] },
    query(
      `SELECT a.id, a.reference, a.status, a.last_status_at, s.name AS service_name
         FROM applications a JOIN services s ON s.id = a.service_id
        WHERE a.department_id = $1 AND a.status IN ('ready_for_visit','under_review','additional_info_required')
        ORDER BY a.last_status_at DESC LIMIT 8`, [dept]),
  ]);
  const identityPending = req.staff.is_data_owner
    ? (await query(`SELECT count(*)::int AS n FROM citizens WHERE verification_status = 'pending_office'`)).rows[0].n : 0;
  res.json({
    counts: Object.fromEntries(counts.rows.map((r) => [r.status, r.n])),
    visits: today.rows,
    accessRequests: Object.fromEntries(myRequests.rows.map((r) => [r.status, r.n])),
    pendingApprovals: approvals.rows[0].n,
    identityPending,
    recent: recent.rows.map((a) => ({ ...a, status_label: STATUS_LABELS[a.status] })),
  });
}));

router.get('/applications', ah(async (req, res) => {
  const status = req.query.status || '';
  const q = String(req.query.q || '').trim();
  const day = req.query.date || '';
  const { rows } = await query(
    `SELECT a.id, a.reference, a.status, a.applicant_category, a.last_status_at, a.created_at, s.name AS service_name,
            o.name AS office_name, sl.starts_at AS visit_at, c.first_name || ' ' || c.surname AS applicant_name
       FROM applications a
       JOIN services s ON s.id = a.service_id JOIN citizens c ON c.id = a.citizen_id
       LEFT JOIN offices o ON o.id = a.office_id LEFT JOIN appointment_slots sl ON sl.id = a.slot_id
      WHERE a.department_id = $1 AND a.status <> 'draft'
        AND ($2 = '' OR a.status = $2)
        AND ($3 = '' OR a.reference ILIKE '%' || $3 || '%' OR (c.first_name || ' ' || c.surname) ILIKE '%' || $3 || '%')
        AND ($4 = '' OR (sl.starts_at AT TIME ZONE 'Africa/Maseru')::date = NULLIF($4,'')::date)
      ORDER BY a.last_status_at DESC LIMIT 200`,
    [req.staff.department_id, status, q, day]
  );
  await audit(null, req, { action: 'SEARCH_APPLICATIONS', details: { status, q, day, results: rows.length } });
  res.json({ applications: rows.map((a) => ({ ...a, status_label: STATUS_LABELS[a.status] })) });
}));

/** Open any application by its reference. Other departments' applications are refused. */
router.get('/lookup', ah(async (req, res) => {
  const ref = String(req.query.reference || '').trim().toUpperCase();
  if (!ref) throw badRequest('Enter a reference number.');
  const r = (await query('SELECT id FROM applications WHERE reference = $1', [ref])).rows[0];
  if (!r) throw notFound(`No application has the reference ${ref}.`);
  await departmentApplication({ query }, req, r.id);
  res.json({ id: r.id });
}));

router.get('/applications/:id', ah(async (req, res) => {
  const app = await departmentApplication({ query }, req, req.params.id);
  const [reqs, events, info, checks, office, slot, access] = await Promise.all([
    requirementsFor({ query }, app.service_id, app.applicant_category),
    query('SELECT from_status, to_status, note, actor_type, actor_label, created_at FROM application_events WHERE application_id = $1 ORDER BY created_at, id', [app.id]),
    query('SELECT id, kind, message, response, responded_at, created_at FROM info_requests WHERE application_id = $1 ORDER BY created_at DESC', [app.id]),
    query(
      `SELECT dc.requirement_id, dc.result, dc.note, dc.created_at, s.full_name AS staff_name
         FROM document_checks dc JOIN staff s ON s.id = dc.staff_id WHERE dc.application_id = $1 ORDER BY dc.created_at DESC`, [app.id]),
    app.office_id ? query('SELECT id, name, district FROM offices WHERE id = $1', [app.office_id]) : { rows: [] },
    app.slot_id ? query('SELECT starts_at FROM appointment_slots WHERE id = $1', [app.slot_id]) : { rows: [] },
    query(
      `SELECT id, reference, fields, purpose, status, consent_status, created_at, expires_at, decision_note
         FROM access_requests WHERE application_id = $1 ORDER BY created_at DESC`, [app.id]),
  ]);
  const { view, shown } = await citizenViewFor({ query }, req.staff, app.citizen_id);
  await audit(null, req, { action: 'VIEW_CITIZEN_RECORD', entityType: 'application', entityId: app.id, citizenId: app.citizen_id,
    details: { reference: app.reference, fields: shown, purpose: `Processing ${app.service_name}` } });

  const applicantAge = app.applicant_category === 'minor' && app.applicant?.date_of_birth ? ageOn(app.applicant.date_of_birth) : null;
  res.json({
    application: {
      id: app.id, reference: app.reference, status: app.status, statusLabel: STATUS_LABELS[app.status], statusReason: app.status_reason,
      category: app.applicant_category, applicant: app.applicant, applicantAge, formData: app.form_data,
      feeAmount: app.fee_amount, createdAt: app.created_at, submittedAt: app.submitted_at, lastStatusAt: app.last_status_at,
      service: { code: app.service_code, name: app.service_name },
      department: { code: app.department_code, name: app.department_name },
      citizenChecklist: checklistProgress(reqs, app.checklist),
    },
    citizen: view,
    requirements: reqs,
    office: office.rows[0] || null,
    visitAt: slot.rows[0]?.starts_at || null,
    events: events.rows.map((e) => ({ ...e, to_label: STATUS_LABELS[e.to_status] })),
    infoRequests: info.rows,
    documentChecks: checks.rows,
    accessRequests: access.rows,
    allowedActions: allowedNext(app.status, 'staff'),
    fieldLabels: CITIZEN_FIELDS,
  });
}));

/** Office visit: the officer checks each original document. */
router.post('/applications/:id/check-in', ah(async (req, res) => {
  const v = parse(z.object({
    results: z.record(z.enum(['verified', 'missing', 'invalid'])),
    note: z.string().max(500).optional(),
  }), req.body);
  const app = await tx(async (db) => {
    const a = await departmentApplication(db, req, req.params.id);
    if (a.status !== 'ready_for_visit') throw conflict('Only applications that are ready for an office visit can be checked in.');
    const reqs = await requirementsFor(db, a.service_id, a.applicant_category);
    const missingAnswer = reqs.filter((r) => !v.results[r.id]);
    if (missingAnswer.length) throw badRequest(`Record a result for every document: ${missingAnswer.map((r) => r.label).join(', ')}.`);
    for (const r of reqs) {
      await db.query('INSERT INTO document_checks (application_id, requirement_id, result, note, staff_id) VALUES ($1,$2,$3,$4,$5)',
        [a.id, r.id, v.results[r.id], v.note || null, req.staff.id]);
    }
    await audit(db, req, { action: 'DOCUMENTS_CHECKED', entityType: 'application', entityId: a.id, citizenId: a.citizen_id,
      details: { reference: a.reference, results: v.results } });
    const problems = reqs.filter((r) => v.results[r.id] !== 'verified');
    if (problems.length === 0) {
      return transition(db, a.id, 'submitted', staffActor(req), { note: 'All original documents checked at the office.' });
    }
    const list = problems.map((r) => `${r.label} (${v.results[r.id]})`).join(', ');
    const message = `These documents could not be accepted at your visit: ${list}. Bring them and book a new visit.${v.note ? ` Officer note: ${v.note}` : ''}`;
    await db.query(`INSERT INTO info_requests (application_id, kind, message, requested_by) VALUES ($1,'documents',$2,$3)`, [a.id, message, req.staff.id]);
    return transition(db, a.id, 'additional_info_required', staffActor(req), { reason: message });
  });
  res.json({ status: app.status, statusLabel: STATUS_LABELS[app.status],
    message: app.status === 'under_review' ? 'Documents accepted. Automatic checks passed and the application is under review.'
      : `Status is now "${STATUS_LABELS[app.status]}". The citizen has been notified.` });
}));

router.post('/applications/:id/status', ah(async (req, res) => {
  const v = parse(z.object({
    to: z.enum(['completed', 'rejected', 'additional_info_required']),
    note: z.string().trim().max(1000).optional(),
  }), req.body);
  if (v.to !== 'completed' && (!v.note || v.note.length < 10)) {
    throw badRequest('Explain the reason in at least 10 characters so the citizen knows what to do.', { note: 'Give a clear reason (at least 10 characters).' });
  }
  const app = await tx(async (db) => {
    const a = await departmentApplication(db, req, req.params.id);
    if (v.to === 'additional_info_required') {
      if (a.status !== 'under_review') throw conflict('You can only ask for information while the application is under review.');
      await db.query(`INSERT INTO info_requests (application_id, kind, message, requested_by) VALUES ($1,'information',$2,$3)`, [a.id, v.note, req.staff.id]);
    }
    const reason = v.to === 'completed'
      ? (v.note || 'Processing is finished. Collect your document at the office you visited and bring your ID card.')
      : v.note;
    return transition(db, a.id, v.to, staffActor(req), { reason });
  });
  res.json({ status: app.status, statusLabel: STATUS_LABELS[app.status], message: `Status changed to "${STATUS_LABELS[app.status]}". The citizen has been notified.` });
}));

// ---------------------------------------------------------------- identity verification (Home Affairs only)
function homeAffairsOnly(req, _res, next) {
  if (!req.staff.is_data_owner) return next(forbidden('Only Home Affairs staff can verify identities.'));
  next();
}

router.get('/identity', homeAffairsOnly, ah(async (req, res) => {
  const status = req.query.status || 'pending_office';
  const q = String(req.query.q || '').trim();
  const { rows } = await query(
    `SELECT id, first_name, surname, date_of_birth, national_id, phone, district, verification_status, verification_note, created_at
       FROM citizens WHERE verification_status = $1
        AND ($2 = '' OR national_id ILIKE $2 || '%' OR (first_name || ' ' || surname) ILIKE '%' || $2 || '%')
      ORDER BY created_at LIMIT 100`, [status, q]
  );
  await audit(null, req, { action: 'SEARCH_IDENTITY_QUEUE', details: { status, results: rows.length } });
  res.json({ citizens: rows });
}));

router.get('/identity/:id', homeAffairsOnly, ah(async (req, res) => {
  const c = (await query('SELECT * FROM citizens WHERE id = $1', [req.params.id])).rows[0];
  if (!c) throw notFound('Citizen not found.');
  const reg = c.national_id ? (await query('SELECT * FROM population_register WHERE national_id = $1', [c.national_id])).rows[0] : null;
  await audit(null, req, { action: 'VIEW_CITIZEN_RECORD', entityType: 'citizen', entityId: c.id, citizenId: c.id,
    details: { purpose: 'Identity verification', fields: ['full_name', 'date_of_birth', 'national_id', 'phone', 'district'] } });
  res.json({
    citizen: { id: c.id, firstName: c.first_name, surname: c.surname, dateOfBirth: c.date_of_birth, sex: c.sex, nationalId: c.national_id,
      phone: c.phone, district: c.district, status: c.verification_status, note: c.verification_note },
    register: reg ? { firstName: reg.first_name, surname: reg.surname, dateOfBirth: reg.date_of_birth, sex: reg.sex, district: reg.district,
      lifeStatus: reg.life_status, isDemo: reg.is_demo } : null,
  });
}));

router.post('/identity/:id', homeAffairsOnly, ah(async (req, res) => {
  const v = parse(z.object({
    decision: z.enum(['verify', 'reject']),
    note: z.string().trim().min(5, 'Write a short note about what you checked.').max(500),
    correctRecord: z.boolean().optional(),
  }), req.body);
  const out = await tx(async (db) => {
    const c = (await db.query('SELECT * FROM citizens WHERE id = $1 FOR UPDATE', [req.params.id])).rows[0];
    if (!c) throw notFound('Citizen not found.');
    if (c.verification_status === 'verified') throw conflict('This identity is already verified.');
    let registerId = null;
    if (v.decision === 'verify') {
      const reg = c.national_id ? (await db.query('SELECT * FROM population_register WHERE national_id = $1', [c.national_id])).rows[0] : null;
      if (!reg) throw badRequest('This ID number is not in the population register. Register the person first, or reject with a reason.');
      if (reg.life_status !== 'alive') throw badRequest('The register shows this person as deceased. This must be corrected through civil registration first.');
      registerId = reg.id;
      // The officer has seen the original card: account details are aligned to the register.
      await db.query(
        `UPDATE citizens SET register_id = $2, first_name = $3, surname = $4, date_of_birth = $5, sex = $6,
           verification_status = 'verified', verification_note = $7, verified_at = now(), verified_by = $8 WHERE id = $1`,
        [c.id, reg.id, reg.first_name, reg.surname, reg.date_of_birth, reg.sex, `Verified at the office: ${v.note}`, req.staff.id]
      );
    } else {
      await db.query(`UPDATE citizens SET verification_status = 'rejected', verification_note = $2 WHERE id = $1`, [c.id, v.note]);
    }
    await audit(db, req, { action: v.decision === 'verify' ? 'IDENTITY_VERIFIED' : 'IDENTITY_REJECTED', entityType: 'citizen',
      entityId: c.id, citizenId: c.id, details: { note: v.note, registerId } });
    await notify(db, c.id, {
      type: 'system',
      title: v.decision === 'verify' ? 'Your identity is verified' : 'Identity could not be verified',
      body: v.decision === 'verify' ? 'A Home Affairs officer verified your identity. You can now confirm applications and book visits.'
        : `A Home Affairs officer could not verify your identity: ${v.note}`,
      link: '/profile',
    });

    // Automation: applications that were waiting only for identity continue on their own.
    let resumed = 0;
    if (v.decision === 'verify') {
      const waiting = await db.query(
        `SELECT DISTINCT a.id FROM applications a JOIN info_requests ir ON ir.application_id = a.id
          WHERE a.citizen_id = $1 AND a.status = 'additional_info_required' AND ir.kind = 'identity' AND ir.responded_at IS NULL`, [c.id]
      );
      for (const w of waiting.rows) {
        await db.query(`UPDATE info_requests SET response = 'Identity verified at the office', responded_at = now() WHERE application_id = $1 AND kind = 'identity' AND responded_at IS NULL`, [w.id]);
        await transition(db, w.id, 'under_review', { type: 'system', id: 'SYSTEM', label: 'System' }, { note: 'Identity verified. Returned to review automatically.' });
        resumed++;
      }
    }
    return { resumed };
  });
  res.json({ message: v.decision === 'verify'
    ? `Identity verified.${out.resumed ? ` ${out.resumed} waiting application(s) moved back to review automatically.` : ''}`
    : 'Identity marked as not verified. The citizen has been told why.' });
}));

export default router;
