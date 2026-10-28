/**
 * Least-privilege access to the single citizen profile.
 * A department sees only its default fields plus fields granted through an
 * approved, unexpired access request for that specific citizen.
 */
import { CITIZEN_FIELDS, maskId } from './util.js';
import { notify } from './notify.js';
import { audit, auditSystem } from './audit.js';
import { badRequest, forbidden } from './http.js';
import { nextAccessReference } from './reference.js';
import { getSettings } from './util.js';

export async function departmentFields(db, departmentId) {
  const { rows } = await db.query('SELECT field FROM department_field_permissions WHERE department_id = $1', [departmentId]);
  return new Set(rows.map((r) => r.field));
}

export async function grantedFields(db, departmentId, citizenId) {
  const { rows } = await db.query(
    `SELECT fields, expires_at, reference FROM access_requests
      WHERE requesting_department_id = $1 AND citizen_id = $2 AND status = 'approved' AND expires_at > now()`,
    [departmentId, citizenId]
  );
  const granted = new Map();
  for (const r of rows) for (const f of r.fields) granted.set(f, { expires_at: r.expires_at, reference: r.reference });
  return granted;
}

/** Build the citizen view for a staff member: visible values, locked placeholders for the rest. */
export async function citizenViewFor(db, staff, citizenId) {
  const { rows } = await db.query('SELECT * FROM citizens WHERE id = $1', [citizenId]);
  const c = rows[0];
  if (!c) return null;
  const base = await departmentFields(db, staff.department_id);
  const granted = await grantedFields(db, staff.department_id, citizenId);
  const raw = {
    full_name: `${c.first_name} ${c.surname}`,
    date_of_birth: c.date_of_birth,
    sex: c.sex === 'F' ? 'Female' : c.sex === 'M' ? 'Male' : null,
    national_id: c.national_id,
    national_id_masked: maskId(c.national_id),
    phone: c.phone,
    email: c.email,
    address: c.address,
    district: c.district,
    verification_status: c.verification_status,
  };
  const view = {};
  const shown = [];
  for (const [field, label] of Object.entries(CITIZEN_FIELDS)) {
    // Showing the full ID makes the masked version redundant
    if (field === 'national_id_masked' && (base.has('national_id') || granted.has('national_id'))) continue;
    if (base.has(field)) { view[field] = { label, value: raw[field], visible: true, source: 'department' }; shown.push(field); }
    else if (granted.has(field)) {
      view[field] = { label, value: raw[field], visible: true, source: 'granted', ...granted.get(field) };
      shown.push(field);
    } else view[field] = { label, visible: false };
  }
  return { view, shown };
}

/**
 * Create an access request and let the system decide what it can:
 *  - no policy for a field      -> denied automatically
 *  - consent required           -> citizen is asked first
 *  - all fields auto-approvable -> approved by the system after consent
 *  - otherwise                  -> sent to a Home Affairs supervisor
 */
export async function createAccessRequest(db, req, { applicationId, fields, purpose }) {
  const staff = req.staff;
  const app = (await db.query('SELECT id, citizen_id, department_id, reference, status FROM applications WHERE id = $1', [applicationId])).rows[0];
  if (!app) throw badRequest('Choose an application from your department.');
  if (app.department_id !== staff.department_id) {
    await audit(db, req, { action: 'ACCESS_REQUEST_BLOCKED', entityType: 'application', entityId: app.id, citizenId: app.citizen_id, outcome: 'denied',
      details: { reason: 'Application belongs to another department' } });
    throw forbidden('You can only request information for applications handled by your department.');
  }
  const unknown = fields.filter((f) => !CITIZEN_FIELDS[f]);
  if (unknown.length) throw badRequest(`Unknown fields: ${unknown.join(', ')}`);

  const base = await departmentFields(db, staff.department_id);
  const needed = fields.filter((f) => !base.has(f));
  if (!needed.length) throw badRequest('Your department can already see these fields. No request is needed.');

  const owner = (await db.query('SELECT id FROM departments WHERE is_data_owner LIMIT 1')).rows[0];
  const { rows: policies } = await db.query(
    'SELECT * FROM data_sharing_policies WHERE requesting_department_id = $1 AND field = ANY($2)', [staff.department_id, needed]
  );
  const byField = Object.fromEntries(policies.map((p) => [p.field, p]));
  const missing = needed.filter((f) => !byField[f]);
  const reference = await nextAccessReference(db);

  const insert = async (status, consentStatus, extra = {}) => {
    const r = await db.query(
      `INSERT INTO access_requests (reference, requested_by, requesting_department_id, owning_department_id, citizen_id, application_id,
         fields, purpose, status, consent_status, decided_by_system, decision_note, decided_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
      [reference, staff.id, staff.department_id, owner.id, app.citizen_id, app.id, needed, purpose, status, consentStatus,
        extra.system ?? false, extra.note ?? null, extra.decided ? new Date() : null]
    );
    return r.rows[0];
  };

  await audit(db, req, { action: 'ACCESS_REQUEST_CREATED', entityType: 'access_request', entityId: reference, citizenId: app.citizen_id,
    details: { fields: needed, purpose, application: app.reference } });

  if (missing.length) {
    const ar = await insert('denied', 'not_required', {
      system: true, decided: true,
      note: `No data-sharing policy allows your department to request: ${missing.map((f) => CITIZEN_FIELDS[f]).join(', ')}.`,
    });
    await auditSystem(db, { action: 'ACCESS_REQUEST_DECIDED', entityType: 'access_request', entityId: reference, citizenId: app.citizen_id,
      departmentId: staff.department_id, outcome: 'denied', details: { decision: 'denied', reason: ar.decision_note } });
    return ar;
  }

  const needsConsent = needed.some((f) => byField[f].requires_consent);
  if (needsConsent) {
    const ar = await insert('pending_consent', 'pending');
    const dept = (await db.query('SELECT name FROM departments WHERE id = $1', [staff.department_id])).rows[0];
    await notify(db, app.citizen_id, {
      type: 'consent_request',
      title: `${dept.name} is asking to see your information`,
      body: `${dept.name} wants to see: ${needed.map((f) => CITIZEN_FIELDS[f]).join(', ')}. Reason: ${purpose}. You decide whether to allow this.`,
      link: '/privacy',
    });
    return ar;
  }
  return routeForApproval(db, await insert('pending_approval', 'not_required'), byField);
}

/** After consent (or when consent is not needed): approve automatically or wait for a supervisor. */
export async function routeForApproval(db, ar, byFieldIn = null) {
  let byField = byFieldIn;
  if (!byField) {
    const { rows } = await db.query(
      'SELECT * FROM data_sharing_policies WHERE requesting_department_id = $1 AND field = ANY($2)', [ar.requesting_department_id, ar.fields]
    );
    byField = Object.fromEntries(rows.map((p) => [p.field, p]));
  }
  const auto = ar.fields.every((f) => byField[f]?.auto_approve);
  if (auto) {
    const days = Math.min(...ar.fields.map((f) => byField[f].max_days));
    const r = await db.query(
      `UPDATE access_requests SET status = 'approved', decided_by_system = true, decided_at = now(),
         decision_note = 'Approved automatically under the data-sharing policy.', expires_at = now() + ($2 || ' days')::interval
       WHERE id = $1 RETURNING *`,
      [ar.id, String(days)]
    );
    await auditSystem(db, { action: 'ACCESS_REQUEST_DECIDED', entityType: 'access_request', entityId: ar.reference, citizenId: ar.citizen_id,
      departmentId: ar.requesting_department_id, details: { decision: 'approved', by: 'policy', days } });
    return r.rows[0];
  }
  const r = await db.query(`UPDATE access_requests SET status = 'pending_approval' WHERE id = $1 RETURNING *`, [ar.id]);
  return r.rows[0];
}

export async function decideBySupervisor(db, req, ar, decision, note) {
  if (ar.status !== 'pending_approval') throw badRequest('This request is no longer waiting for a decision.');
  if (ar.requested_by === req.staff.id) throw forbidden('You cannot approve a request you made yourself.');
  let expires = null;
  if (decision === 'approved') {
    const { rows } = await db.query(
      'SELECT min(max_days) AS d FROM data_sharing_policies WHERE requesting_department_id = $1 AND field = ANY($2)',
      [ar.requesting_department_id, ar.fields]
    );
    expires = new Date(Date.now() + (rows[0].d || 7) * 86400000);
  }
  const r = await db.query(
    `UPDATE access_requests SET status = $2, decided_by = $3, decided_at = now(), decision_note = $4, expires_at = $5
      WHERE id = $1 RETURNING *`,
    [ar.id, decision, req.staff.id, note, expires]
  );
  await audit(db, req, { action: 'ACCESS_REQUEST_DECIDED', entityType: 'access_request', entityId: ar.reference, citizenId: ar.citizen_id,
    outcome: decision === 'approved' ? 'success' : 'denied', details: { decision, note } });
  return r.rows[0];
}

export async function consentExpiryDays(db) {
  const s = await getSettings(db);
  return Number(s.consent_expiry_days ?? 7);
}
