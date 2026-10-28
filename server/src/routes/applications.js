import { Router } from 'express';
import { z } from 'zod';
import { query, tx } from '../db.js';
import { ah, parse, badRequest, notFound, conflict } from '../lib/http.js';
import { audit } from '../lib/audit.js';
import { notify } from '../lib/notify.js';
import { ageOn, getSettings, STATUS_LABELS, formatDateTime } from '../lib/util.js';
import { nextApplicationReference } from '../lib/reference.js';
import {
  transition, loadApplication, requirementsFor, checklistProgress, confirmApplication, FINAL_STATUSES,
} from '../lib/workflow.js';
import { requireCitizen } from '../middleware/auth.js';

const router = Router();
router.use(requireCitizen);

const EDITABLE = ['draft', 'preparing_documents', 'additional_info_required'];
const citizenActor = (req) => ({ type: 'citizen', id: req.citizen.id, label: `${req.citizen.first_name} ${req.citizen.surname}`, req });

async function ownApplication(db, req, id) {
  const app = await loadApplication(db, id);
  if (!app || app.citizen_id !== req.citizen.id) throw notFound('We could not find that application in your account.');
  return app;
}

router.get('/', ah(async (req, res) => {
  const { rows } = await query(
    `SELECT a.id, a.reference, a.status, a.applicant_category, a.applicant, a.created_at, a.submitted_at, a.last_status_at,
            s.name AS service_name, s.code AS service_code, d.short_name AS department_name, d.code AS department_code,
            o.name AS office_name, sl.starts_at AS visit_at
       FROM applications a
       JOIN services s ON s.id = a.service_id JOIN departments d ON d.id = a.department_id
       LEFT JOIN offices o ON o.id = a.office_id LEFT JOIN appointment_slots sl ON sl.id = a.slot_id
      WHERE a.citizen_id = $1 ORDER BY a.last_status_at DESC`,
    [req.citizen.id]
  );
  res.json({ applications: rows.map((a) => ({ ...a, status_label: STATUS_LABELS[a.status] })) });
}));

const minorSchema = z.object({
  firstName: z.string().trim().min(1, "Enter the child's first name."),
  surname: z.string().trim().min(1, "Enter the child's surname."),
  dateOfBirth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Enter the child's date of birth."),
  birthCertificateNo: z.string().trim().min(3, 'Enter the birth certificate number.').max(30),
  relationship: z.enum(['parent', 'guardian'], { errorMap: () => ({ message: 'Choose parent or legal guardian.' }) }),
});

router.post('/', ah(async (req, res) => {
  const v = parse(z.object({
    serviceCode: z.string().min(1),
    category: z.enum(['adult', 'minor']),
    minor: minorSchema.optional(),
  }), req.body);
  const c = req.citizen;
  const settings = await getSettings();
  const minorLimit = Number(settings.minor_age_limit ?? 16);

  const svc = (await query('SELECT * FROM services WHERE code = $1 AND is_active', [v.serviceCode])).rows[0];
  if (!svc) throw notFound('That service is not available.');

  // Rules the system can check before anything is created
  if (v.category === 'minor' && svc.applies_to === 'self') throw badRequest('This service cannot be requested on behalf of a child.');
  if (v.category === 'adult' && svc.applies_to === 'minor') throw badRequest('This service is only for children.');
  if (v.category === 'adult') {
    const age = ageOn(c.date_of_birth);
    if (svc.min_age && age < svc.min_age) {
      const d = new Date(`${c.date_of_birth}T00:00:00Z`);
      d.setUTCFullYear(d.getUTCFullYear() + svc.min_age);
      throw badRequest(`This service is for people aged ${svc.min_age} or older. You can apply from ${d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}.`);
    }
  }
  if (svc.code === 'NATIONAL_ID' && c.national_id) {
    throw badRequest('You already have a National ID on record. Use "Replace a lost or damaged ID card" instead.');
  }
  if (svc.requires_national_id && !c.national_id) {
    throw badRequest('You need a National ID for this service. Apply for a National ID under Home Affairs first.');
  }
  if (v.category === 'minor') {
    if (!v.minor) throw badRequest("Enter the child's details.", { minor: "Enter the child's details." });
    const childAge = ageOn(v.minor.dateOfBirth);
    if (new Date(v.minor.dateOfBirth) > new Date()) throw badRequest('Check the date of birth.', { 'minor.dateOfBirth': 'The date of birth cannot be in the future.' });
    if (childAge >= minorLimit) {
      throw badRequest(`The child is ${childAge}. From age ${minorLimit} a person applies as an adult with their own National ID.`, { 'minor.dateOfBirth': `The child must be below ${minorLimit}.` });
    }
  }
  const reqs = await requirementsFor({ query }, svc.id, v.category);
  if (reqs.length === 0) {
    throw badRequest('The requirements for this application have not been confirmed by the department yet, so it cannot be started online. Contact the office for guidance.');
  }

  const app = await tx(async (db) => {
    const ref = await nextApplicationReference(db, svc.ref_prefix);
    const applicant = v.category === 'minor' ? { ...v.minor, applyingAdult: `${c.first_name} ${c.surname}` } : {};
    const key = v.category === 'minor' ? v.minor.birthCertificateNo.toUpperCase() : 'SELF';
    const r = await db.query(
      `INSERT INTO applications (reference, citizen_id, service_id, department_id, applicant_category, applicant_key, applicant)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
      [ref, c.id, svc.id, svc.department_id, v.category, key, JSON.stringify(applicant)]
    );
    await db.query(
      `INSERT INTO application_events (application_id, to_status, note, actor_type, actor_id, actor_label)
       VALUES ($1,'draft','Application started','citizen',$2,$3)`,
      [r.rows[0].id, c.id, `${c.first_name} ${c.surname}`]
    );
    await audit(db, req, { action: 'APPLICATION_CREATED', entityType: 'application', entityId: r.rows[0].id, citizenId: c.id,
      departmentId: svc.department_id, details: { reference: ref, service: svc.code, category: v.category } });
    return loadApplication(db, r.rows[0].id);
  });
  res.status(201).json({ application: { id: app.id, reference: app.reference, status: app.status } });
}));

router.get('/:id', ah(async (req, res) => {
  const app = await ownApplication({ query }, req, req.params.id);
  const [reqs, fees, events, info, checks, office, slot] = await Promise.all([
    requirementsFor({ query }, app.service_id, app.applicant_category),
    query('SELECT id, code, label, amount, note, is_verified FROM service_fees WHERE service_id = $1 AND is_active ORDER BY amount', [app.service_id]),
    query('SELECT from_status, to_status, note, actor_type, actor_label, created_at FROM application_events WHERE application_id = $1 ORDER BY created_at, id', [app.id]),
    query('SELECT id, kind, message, response, responded_at, created_at FROM info_requests WHERE application_id = $1 ORDER BY created_at DESC', [app.id]),
    query(
      `SELECT dc.requirement_id, dc.result, dc.note, dc.created_at, r.label FROM document_checks dc
         JOIN service_requirements r ON r.id = dc.requirement_id WHERE dc.application_id = $1 ORDER BY dc.created_at DESC`, [app.id]),
    app.office_id ? query('SELECT id, name, district, location, phone, hours FROM offices WHERE id = $1', [app.office_id]) : { rows: [] },
    app.slot_id ? query(
      `SELECT id, starts_at, to_char(starts_at AT TIME ZONE 'Africa/Maseru','YYYY-MM-DD') AS day,
              to_char(starts_at AT TIME ZONE 'Africa/Maseru','HH24:MI') AS time FROM appointment_slots WHERE id = $1`, [app.slot_id]) : { rows: [] },
  ]);
  let proposedSlot = null;
  if (app.form_data?.proposedSlotId && !app.slot_id) {
    proposedSlot = (await query(
      `SELECT id, starts_at, capacity - booked AS available, to_char(starts_at AT TIME ZONE 'Africa/Maseru','YYYY-MM-DD') AS day,
              to_char(starts_at AT TIME ZONE 'Africa/Maseru','HH24:MI') AS time FROM appointment_slots WHERE id = $1`,
      [app.form_data.proposedSlotId]
    )).rows[0] || null;
  }
  const progress = checklistProgress(reqs, app.checklist);
  const openInfo = info.rows.find((i) => !i.responded_at);
  res.json({
    application: {
      id: app.id, reference: app.reference, status: app.status, statusLabel: STATUS_LABELS[app.status], statusReason: app.status_reason,
      category: app.applicant_category, applicant: app.applicant, formData: app.form_data, checklist: app.checklist,
      feeId: app.fee_id, feeAmount: app.fee_amount, createdAt: app.created_at, submittedAt: app.submitted_at,
      lastStatusAt: app.last_status_at, completedAt: app.completed_at,
      service: { code: app.service_code, name: app.service_name, requiresAppointment: app.requires_appointment },
      department: { code: app.department_code, name: app.department_name },
    },
    requirements: reqs,
    progress,
    fees: fees.rows,
    office: office.rows[0] || null,
    slot: slot.rows[0] || null,
    proposedSlot,
    events: events.rows.map((e) => ({ ...e, to_label: STATUS_LABELS[e.to_status] })),
    infoRequests: info.rows,
    documentChecks: checks.rows,
    actions: {
      canEdit: EDITABLE.includes(app.status) && !(app.status === 'additional_info_required' && openInfo && openInfo.kind !== 'documents'),
      canCancel: ['draft', 'preparing_documents', 'ready_for_visit', 'additional_info_required'].includes(app.status),
      canReschedule: app.status === 'ready_for_visit',
      canRespond: app.status === 'additional_info_required' && openInfo && openInfo.kind === 'information',
      needsNewVisit: app.status === 'additional_info_required' && openInfo?.kind === 'documents',
      isFinal: FINAL_STATUSES.includes(app.status),
    },
  });
}));

/** Autosave: checklist, fee, office, proposed slot and service answers. */
router.patch('/:id', ah(async (req, res) => {
  const v = parse(z.object({
    checklist: z.record(z.boolean()).optional(),
    feeId: z.number().int().nullable().optional(),
    officeId: z.number().int().nullable().optional(),
    proposedSlotId: z.number().int().nullable().optional(),
    formData: z.record(z.any()).optional(),
    requirementsReviewed: z.boolean().optional(),
  }), req.body);
  const result = await tx(async (db) => {
    const app = await ownApplication(db, req, req.params.id);
    if (!EDITABLE.includes(app.status)) throw conflict(`This application is "${STATUS_LABELS[app.status]}" and can no longer be changed.`);

    const reqs = await requirementsFor(db, app.service_id, app.applicant_category);
    const sets = [];
    const params = [app.id];
    const add = (sql, val) => { params.push(val); sets.push(`${sql} = $${params.length}`); };

    if (v.checklist) {
      const allowed = new Set(reqs.map((r) => String(r.id)));
      const clean = Object.fromEntries(Object.entries(v.checklist).filter(([k]) => allowed.has(k)));
      add('checklist', JSON.stringify(clean));
    }
    if (v.feeId !== undefined) {
      if (v.feeId !== null) {
        const f = (await db.query('SELECT id, amount FROM service_fees WHERE id = $1 AND service_id = $2 AND is_active', [v.feeId, app.service_id])).rows[0];
        if (!f) throw badRequest('Choose a passport type from the list.');
        add('fee_id', f.id); add('fee_amount', f.amount);
      } else { add('fee_id', null); add('fee_amount', null); }
    }
    if (v.officeId !== undefined && v.officeId !== null) {
      const o = (await db.query('SELECT id FROM offices WHERE id = $1 AND department_id = $2 AND is_active', [v.officeId, app.department_id])).rows[0];
      if (!o) throw badRequest('Choose an office from the list.');
      add('office_id', o.id);
    }
    if (v.formData || v.proposedSlotId !== undefined) {
      const fd = { ...(app.form_data || {}), ...(v.formData || {}) };
      if (v.proposedSlotId !== undefined) fd.proposedSlotId = v.proposedSlotId;
      add('form_data', JSON.stringify(fd));
    }
    if (sets.length) await db.query(`UPDATE applications SET ${sets.join(', ')} WHERE id = $1`, params);
    if (v.requirementsReviewed && app.status === 'draft') {
      await transition(db, app.id, 'preparing_documents', citizenActor(req), { note: 'Requirements reviewed' });
    }
    return loadApplication(db, app.id);
  });
  const reqs = await requirementsFor({ query }, result.service_id, result.applicant_category);
  res.json({ status: result.status, progress: checklistProgress(reqs, result.checklist), savedAt: new Date() });
}));

async function bookSlot(db, app, slotId) {
  const slot = (await db.query('SELECT * FROM appointment_slots WHERE id = $1 FOR UPDATE', [slotId])).rows[0];
  if (!slot || slot.is_blocked) throw badRequest('That visit time is not available. Choose another time.');
  if (new Date(slot.starts_at) < new Date(Date.now() + 2 * 3600_000)) throw badRequest('That time has already passed. Choose a later time.');
  const office = (await db.query('SELECT id, department_id FROM offices WHERE id = $1', [slot.office_id])).rows[0];
  if (office.department_id !== app.department_id) throw badRequest('That office does not handle this service.');
  if (slot.booked >= slot.capacity) throw conflict('Someone has just taken the last place at that time. Choose another time.');
  if (app.slot_id) {
    await db.query('UPDATE appointment_slots SET booked = GREATEST(booked - 1, 0) WHERE id = $1 AND starts_at > now()', [app.slot_id]);
  }
  await db.query('UPDATE appointment_slots SET booked = booked + 1 WHERE id = $1', [slot.id]);
  await db.query(
    `UPDATE applications SET slot_id = $2, office_id = $3, form_data = form_data - 'proposedSlotId' WHERE id = $1`,
    [app.id, slot.id, slot.office_id]
  );
  return slot;
}

/** "Confirm visit" / "Submit application": books the chosen time and moves the application forward. */
router.post('/:id/confirm', ah(async (req, res) => {
  const { slotId } = parse(z.object({ slotId: z.number().int().optional() }), req.body);
  const result = await tx(async (db) => {
    const app = await ownApplication(db, req, req.params.id);
    if (!['draft', 'preparing_documents', 'additional_info_required'].includes(app.status)) {
      throw conflict(`This application is "${STATUS_LABELS[app.status]}". There is nothing to confirm.`);
    }
    if (app.requires_national_id && req.citizen.verification_status !== 'verified') {
      throw badRequest('Your identity must be verified before you can confirm. Check your profile for what to do.');
    }
    const s = slotId ?? app.form_data?.proposedSlotId;
    if (app.requires_appointment && s && s !== app.slot_id) {
      // Only book once the checklist is complete, so places are not held by unfinished applications
      const reqs = await requirementsFor(db, app.service_id, app.applicant_category);
      if (checklistProgress(reqs, app.checklist).complete) await bookSlot(db, app, s);
    }
    return confirmApplication(db, app.id, citizenActor(req));
  });
  res.json({ status: result.status, statusLabel: STATUS_LABELS[result.status], reference: result.reference });
}));

router.post('/:id/reschedule', ah(async (req, res) => {
  const { slotId } = parse(z.object({ slotId: z.number({ required_error: 'Choose a new time.' }).int() }), req.body);
  await tx(async (db) => {
    const app = await ownApplication(db, req, req.params.id);
    if (app.status !== 'ready_for_visit') throw conflict('Only booked visits can be moved.');
    const slot = await bookSlot(db, app, slotId);
    const office = (await db.query('SELECT name FROM offices WHERE id = $1', [slot.office_id])).rows[0];
    await db.query(
      `INSERT INTO application_events (application_id, from_status, to_status, note, actor_type, actor_id, actor_label)
       VALUES ($1,'ready_for_visit','ready_for_visit',$2,'citizen',$3,$4)`,
      [app.id, `Visit moved to ${formatDateTime(slot.starts_at)} at ${office.name}`, req.citizen.id, `${req.citizen.first_name} ${req.citizen.surname}`]
    );
    await audit(db, req, { action: 'VISIT_RESCHEDULED', entityType: 'application', entityId: app.id, citizenId: app.citizen_id,
      departmentId: app.department_id, details: { slot: slot.id } });
    await notify(db, app.citizen_id, { type: 'visit_booked', title: 'Visit moved',
      body: `${app.service_name} (${app.reference}): your visit is now on ${formatDateTime(slot.starts_at)} at ${office.name}.`, link: `/applications/${app.id}` });
  });
  res.json({ message: 'Your visit was moved.' });
}));

router.post('/:id/cancel', ah(async (req, res) => {
  const { reason } = parse(z.object({ reason: z.string().max(300).optional() }), req.body);
  const app = await tx(async (db) => {
    const a = await ownApplication(db, req, req.params.id);
    return transition(db, a.id, 'cancelled', citizenActor(req), { reason: reason ? `Cancelled by you: ${reason}` : 'Cancelled by you.' });
  });
  res.json({ status: app.status, message: 'Your application was cancelled. Any booked visit was released.' });
}));

router.post('/:id/respond', ah(async (req, res) => {
  const { infoRequestId, response } = parse(z.object({
    infoRequestId: z.number().int(),
    response: z.string().trim().min(2, 'Write your answer.').max(2000),
  }), req.body);
  const app = await tx(async (db) => {
    const a = await ownApplication(db, req, req.params.id);
    if (a.status !== 'additional_info_required') throw conflict('This application is not waiting for information from you.');
    const ir = (await db.query('SELECT * FROM info_requests WHERE id = $1 AND application_id = $2 AND responded_at IS NULL FOR UPDATE', [infoRequestId, a.id])).rows[0];
    if (!ir) throw notFound('That question was already answered.');
    if (ir.kind !== 'information') throw badRequest('This request needs an office visit, not a written answer.');
    await db.query('UPDATE info_requests SET response = $2, responded_at = now() WHERE id = $1', [ir.id, response]);
    await audit(db, req, { action: 'INFO_PROVIDED', entityType: 'application', entityId: a.id, citizenId: a.citizen_id, departmentId: a.department_id });
    return transition(db, a.id, 'under_review', { type: 'system', id: 'SYSTEM', label: 'System' }, { note: 'Citizen answered. Returned to review automatically.' });
  });
  res.json({ status: app.status, message: 'Thank you. Your answer was sent and the application is back under review.' });
}));

export default router;
