/**
 * Application workflow engine.
 * Every status change goes through transition(): it checks the change is allowed
 * for that actor, records history, notifies the citizen and writes the audit log.
 */
import { HttpError, conflict } from './http.js';
import { notify } from './notify.js';
import { audit, auditSystem } from './audit.js';
import { STATUS_LABELS, ageOn, getSettings, formatDateTime } from './util.js';

// from -> to -> actors allowed to make that change
const TRANSITIONS = {
  draft: {
    preparing_documents: ['citizen', 'system'],
    cancelled: ['citizen', 'system'],
  },
  preparing_documents: {
    ready_for_visit: ['system'],
    submitted: ['system'],
    cancelled: ['citizen', 'system'],
  },
  ready_for_visit: {
    submitted: ['staff'],
    additional_info_required: ['staff'],
    preparing_documents: ['system', 'citizen'],
    cancelled: ['citizen'],
  },
  submitted: {
    under_review: ['system'],
    additional_info_required: ['system', 'staff'],
    rejected: ['system'],
  },
  under_review: {
    completed: ['staff'],
    additional_info_required: ['staff'],
    rejected: ['staff'],
  },
  additional_info_required: {
    under_review: ['system'],
    ready_for_visit: ['system'],
    cancelled: ['citizen'],
  },
};

export const FINAL_STATUSES = ['completed', 'rejected', 'cancelled'];
export const OPEN_STATUSES = ['draft', 'preparing_documents', 'ready_for_visit', 'submitted', 'under_review', 'additional_info_required'];

export function allowedNext(from, actor) {
  return Object.entries(TRANSITIONS[from] || {})
    .filter(([, actors]) => actors.includes(actor))
    .map(([to]) => to);
}

export async function loadApplication(db, id, { lock = false } = {}) {
  const { rows } = await db.query(
    `SELECT a.*, s.code AS service_code, s.name AS service_name, s.requires_appointment, s.min_age,
            s.requires_national_id, d.short_name AS department_name, d.code AS department_code
       FROM applications a
       JOIN services s ON s.id = a.service_id
       JOIN departments d ON d.id = a.department_id
      WHERE a.id = $1 ${lock ? 'FOR UPDATE OF a' : ''}`,
    [id]
  );
  return rows[0] || null;
}

export async function requirementsFor(db, serviceId, category) {
  const { rows } = await db.query(
    `SELECT id, label, detail, is_fee, is_verified, applicant_category
       FROM service_requirements
      WHERE service_id = $1 AND applicant_category IN ($2, 'any')
      ORDER BY sort_order, id`,
    [serviceId, category]
  );
  return rows;
}

export function checklistProgress(requirements, checklist) {
  const done = requirements.filter((r) => checklist?.[r.id] === true).length;
  return { done, total: requirements.length, complete: requirements.length > 0 && done === requirements.length };
}

/**
 * Change an application's status.
 * actor: { type: 'citizen'|'staff'|'system', id, label, req }
 */
export async function transition(db, appId, to, actor, { note = null, reason = null } = {}) {
  const app = await loadApplication(db, appId, { lock: true });
  if (!app) throw new HttpError(404, 'Application not found.');
  const from = app.status;
  const allowed = TRANSITIONS[from]?.[to];
  if (!allowed || !allowed.includes(actor.type)) {
    throw conflict(`This application is "${STATUS_LABELS[from]}" and cannot be moved to "${STATUS_LABELS[to]}".`);
  }

  // Release a future appointment slot when leaving the visit stage
  let releaseSlot = false;
  if (app.slot_id && ['cancelled', 'preparing_documents'].includes(to)) {
    releaseSlot = true;
    await db.query(
      `UPDATE appointment_slots SET booked = GREATEST(booked - 1, 0) WHERE id = $1 AND starts_at > now()`,
      [app.slot_id]
    );
  }

  await db.query(
    `UPDATE applications
        SET status = $2, status_reason = $3, last_status_at = now(),
            submitted_at = CASE WHEN $2 = 'submitted' THEN now() ELSE submitted_at END,
            completed_at = CASE WHEN $2 IN ('completed','rejected','cancelled') THEN now() ELSE completed_at END,
            slot_id = CASE WHEN $4 THEN NULL ELSE slot_id END
      WHERE id = $1`,
    [appId, to, reason, releaseSlot]
  );
  await db.query(
    `INSERT INTO application_events (application_id, from_status, to_status, note, actor_type, actor_id, actor_label)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [appId, from, to, note || reason, actor.type, actor.id ? String(actor.id) : null, actor.label || null]
  );

  await notifyStatus(db, app, to, reason);

  const entry = {
    action: 'APPLICATION_STATUS_CHANGED', entityType: 'application', entityId: appId, citizenId: app.citizen_id,
    departmentId: app.department_id, details: { reference: app.reference, from, to, note: note || reason },
  };
  if (actor.type === 'system') await auditSystem(db, entry);
  else await audit(db, actor.req, entry);

  // Submitted applications go straight through the automatic checks
  if (to === 'submitted') await runAutomatedChecks(db, appId);

  return loadApplication(db, appId);
}

async function notifyStatus(db, app, to, reason) {
  const link = `/applications/${app.id}`;
  const ref = app.reference;
  const svc = app.service_name;
  const messages = {
    ready_for_visit: async () => {
      const s = app.slot_id || (await db.query('SELECT slot_id FROM applications WHERE id=$1', [app.id])).rows[0]?.slot_id;
      const slot = s ? (await db.query(
        'SELECT sl.starts_at, o.name FROM appointment_slots sl JOIN offices o ON o.id = sl.office_id WHERE sl.id = $1', [s]
      )).rows[0] : null;
      return ['visit_booked', 'Office visit booked',
        slot ? `${svc} (${ref}): your visit is on ${formatDateTime(slot.starts_at)} at ${slot.name}. Bring the documents on your checklist.`
          : `${svc} (${ref}) is ready for your office visit.`];
    },
    submitted: () => ['status_changed', 'Documents received', `${svc} (${ref}): your documents were checked at the office.`],
    under_review: () => ['status_changed', 'Application under review', `${svc} (${ref}) passed the automatic checks and is now under review.`],
    additional_info_required: () => ['info_required', 'More information needed', `${svc} (${ref}): ${reason || 'the department needs more information.'} Open the application to respond.`],
    completed: () => ['completed', 'Application completed', `${svc} (${ref}) is completed. ${reason || ''}`.trim()],
    rejected: () => ['status_changed', 'Application not approved', `${svc} (${ref}) could not be approved. Reason: ${reason || 'not given'}.`],
    cancelled: () => ['status_changed', 'Application cancelled', `${svc} (${ref}) was cancelled. ${reason || ''}`.trim()],
    preparing_documents: () => (app.status === 'ready_for_visit'
      ? ['status_changed', 'Visit needs to be rebooked', `${svc} (${ref}): ${reason || 'your visit was cancelled.'} Book a new visit when you are ready.`]
      : null),
  };
  const fn = messages[to];
  if (!fn) return;
  const m = await fn();
  if (!m) return;
  await notify(db, app.citizen_id, { type: m[0], title: m[1], body: m[2], link });
}

/**
 * Automatic checks run by the system once documents are confirmed at the office.
 * Anything the system can decide on its own, it decides here.
 */
export async function runAutomatedChecks(db, appId) {
  const app = await loadApplication(db, appId, { lock: true });
  if (!app || app.status !== 'submitted') return;
  const settings = await getSettings(db);
  const minorLimit = Number(settings.minor_age_limit ?? 16);
  const { rows } = await db.query(
    `SELECT c.verification_status, c.date_of_birth, r.life_status
       FROM citizens c LEFT JOIN population_register r ON r.id = c.register_id WHERE c.id = $1`,
    [app.citizen_id]
  );
  const c = rows[0];
  const results = [];
  const sys = { type: 'system', id: 'SYSTEM', label: 'Automatic checks' };

  if (c.life_status === 'deceased') {
    return transition(db, appId, 'rejected', sys, { reason: 'The population register records this person as deceased. Visit Home Affairs if this is wrong.' });
  }
  if (app.requires_national_id && c.verification_status !== 'verified') {
    await db.query(
      `INSERT INTO info_requests (application_id, kind, message, requested_by) VALUES ($1,'identity',$2,'SYSTEM')`,
      [appId, 'Your identity is not yet verified. Visit a Home Affairs office with your ID card so an officer can verify it.']
    );
    return transition(db, appId, 'additional_info_required', sys, { reason: 'Your identity must be verified at a Home Affairs office first.' });
  }
  results.push('identity verified');

  if (app.applicant_category === 'adult') {
    const age = ageOn(c.date_of_birth);
    if (age < minorLimit) {
      return transition(db, appId, 'rejected', sys, { reason: `The applicant is ${age}. Applicants below ${minorLimit} must apply as a minor with a parent or guardian.` });
    }
    if (app.min_age && age < app.min_age) {
      return transition(db, appId, 'rejected', sys, { reason: `This service is for people aged ${app.min_age} or older. The applicant is ${age}.` });
    }
    results.push('age rules met');
  } else {
    const dob = app.applicant?.date_of_birth;
    if (!dob || ageOn(dob) >= minorLimit) {
      return transition(db, appId, 'rejected', sys, { reason: `A minor application must be for a child below ${minorLimit}.` });
    }
    results.push('child is below the minor age limit');
  }
  results.push('no duplicate open application');
  return transition(db, appId, 'under_review', sys, { note: `Automatic checks passed: ${results.join(', ')}.` });
}

/**
 * Called when the citizen confirms. Moves the application forward if everything
 * the system needs is in place, otherwise explains what is missing.
 */
export async function confirmApplication(db, appId, actor) {
  const app = await loadApplication(db, appId, { lock: true });
  const reqs = await requirementsFor(db, app.service_id, app.applicant_category);
  const progress = checklistProgress(reqs, app.checklist);
  const problems = [];
  if (reqs.length === 0) problems.push('The requirements for this service have not been confirmed yet. Contact the office.');
  if (!progress.complete) problems.push(`Confirm all documents on your checklist (${progress.done} of ${progress.total} confirmed).`);
  if (app.requires_appointment && !app.slot_id) problems.push('Choose an office and a visit time.');
  if (problems.length) throw new HttpError(400, problems.join(' '), { problems });

  if (app.status === 'draft') {
    await transition(db, appId, 'preparing_documents', actor, { note: 'Requirements reviewed' });
  }
  const sys = { type: 'system', id: 'SYSTEM', label: 'System' };
  const current = (await loadApplication(db, appId)).status;
  if (app.requires_appointment) {
    if (current === 'preparing_documents' || current === 'additional_info_required') {
      return transition(db, appId, 'ready_for_visit', sys, { note: 'Checklist complete and visit booked' });
    }
  } else if (current === 'preparing_documents') {
    return transition(db, appId, 'submitted', sys, { note: 'Submitted online' });
  }
  return loadApplication(db, appId);
}
