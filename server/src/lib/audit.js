import { query } from '../db.js';

/**
 * Append an entry to the audit log. Every access, update, request and decision
 * goes through here. `db` may be a transaction client.
 */
export async function audit(db, req, entry) {
  const actor = actorFromReq(req);
  const {
    action, entityType = null, entityId = null, citizenId = null, outcome = 'success', details = {},
    departmentId = actor.departmentId, actorType = actor.type, actorId = actor.id, actorLabel = actor.label,
  } = entry;
  await (db || { query }).query(
    `INSERT INTO audit_log (actor_type, actor_id, actor_label, department_id, action, entity_type, entity_id, citizen_id, outcome, details, ip)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
    [actorType, actorId, actorLabel, departmentId ?? null, action, entityType, entityId ? String(entityId) : null,
      citizenId, outcome, JSON.stringify(details), req?.ip ?? null]
  );
}

/** Audit entry written by the automation engine. */
export function auditSystem(db, entry) {
  return audit(db, null, { actorType: 'system', actorId: 'SYSTEM', actorLabel: 'Automation', ...entry });
}

function actorFromReq(req) {
  if (!req) return { type: 'system', id: 'SYSTEM', label: 'Automation', departmentId: null };
  if (req.staff) {
    return {
      type: 'staff', id: req.staff.id,
      label: `${req.staff.full_name} (${req.staff.staff_number})`,
      departmentId: req.staff.department_id,
    };
  }
  if (req.session?.t === 'citizen') return { type: 'citizen', id: req.session.id, label: 'Citizen', departmentId: null };
  return { type: 'anonymous', id: null, label: 'Anonymous', departmentId: null };
}
