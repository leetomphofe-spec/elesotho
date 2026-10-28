import { Router } from 'express';
import { z } from 'zod';
import { query, tx } from '../db.js';
import { ah, parse, notFound, forbidden } from '../lib/http.js';
import { createAccessRequest, decideBySupervisor } from '../lib/access.js';
import { CITIZEN_FIELDS } from '../lib/util.js';
import { requireStaff, requirePasswordChanged, requireRole } from '../middleware/auth.js';
import { audit } from '../lib/audit.js';

const router = Router();
router.use(requireStaff, requirePasswordChanged, requireRole('officer', 'supervisor'));

const isApprover = (s) => s.is_data_owner && s.role === 'supervisor';

const SELECT = `
  SELECT ar.*, rd.name AS requesting_department, s.full_name AS requested_by_name, s.staff_number AS requested_by_number,
         ds.full_name AS decided_by_name, a.reference AS application_reference, sv.name AS service_name,
         c.first_name || ' ' || c.surname AS citizen_name
    FROM access_requests ar
    JOIN departments rd ON rd.id = ar.requesting_department_id
    JOIN staff s ON s.id = ar.requested_by
    LEFT JOIN staff ds ON ds.id = ar.decided_by
    LEFT JOIN applications a ON a.id = ar.application_id
    LEFT JOIN services sv ON sv.id = a.service_id
    JOIN citizens c ON c.id = ar.citizen_id`;

router.get('/', ah(async (req, res) => {
  const scope = req.query.scope || 'department';
  let rows;
  if (scope === 'approvals') {
    if (!isApprover(req.staff)) throw forbidden('Only Home Affairs supervisors approve information requests.');
    rows = (await query(`${SELECT} WHERE ar.status = 'pending_approval' OR (ar.decided_by IS NOT NULL AND ar.decided_at > now() - interval '30 days')
      ORDER BY (ar.status = 'pending_approval') DESC, ar.created_at DESC LIMIT 200`)).rows;
  } else {
    rows = (await query(`${SELECT} WHERE ar.requesting_department_id = $1 ORDER BY ar.created_at DESC LIMIT 200`, [req.staff.department_id])).rows;
  }
  // The citizen's name is only shown to the requesting department (it already serves them) and the approver.
  res.json({ requests: rows, fieldLabels: CITIZEN_FIELDS, canApprove: isApprover(req.staff) });
}));

router.get('/policies', ah(async (req, res) => {
  const { rows } = await query(
    'SELECT field, purpose, requires_consent, auto_approve, max_days FROM data_sharing_policies WHERE requesting_department_id = $1 ORDER BY field',
    [req.staff.department_id]
  );
  const base = await query('SELECT field FROM department_field_permissions WHERE department_id = $1', [req.staff.department_id]);
  res.json({ policies: rows, defaultFields: base.rows.map((r) => r.field), fieldLabels: CITIZEN_FIELDS });
}));

router.post('/', ah(async (req, res) => {
  const v = parse(z.object({
    applicationId: z.string().uuid('Choose an application.'),
    fields: z.array(z.string()).min(1, 'Choose at least one piece of information.'),
    purpose: z.string().trim().min(15, 'Explain why you need this information (at least 15 characters).').max(500),
  }), req.body);
  const ar = await tx((db) => createAccessRequest(db, req, v));
  const messages = {
    denied: `Request ${ar.reference} was refused automatically. ${ar.decision_note}`,
    pending_consent: `Request ${ar.reference} was sent to the citizen for consent.`,
    pending_approval: `Request ${ar.reference} is waiting for a Home Affairs supervisor.`,
    approved: `Request ${ar.reference} was approved automatically under the data-sharing policy.`,
  };
  res.status(201).json({ request: ar, message: messages[ar.status] });
}));

router.get('/:id', ah(async (req, res) => {
  const r = (await query(`${SELECT} WHERE ar.id = $1`, [req.params.id])).rows[0];
  if (!r) throw notFound('Request not found.');
  if (r.requesting_department_id !== req.staff.department_id && !isApprover(req.staff)) {
    await audit(null, req, { action: 'ACCESS_DENIED', entityType: 'access_request', entityId: r.reference, outcome: 'denied' });
    throw forbidden('Access denied. This request belongs to another department.');
  }
  const trail = await query(
    `SELECT at, actor_type, actor_label, action, outcome, details FROM audit_log
      WHERE entity_type = 'access_request' AND entity_id = $1 ORDER BY at`, [r.reference]
  );
  res.json({ request: r, trail: trail.rows, fieldLabels: CITIZEN_FIELDS, canDecide: isApprover(req.staff) && r.status === 'pending_approval' && r.requested_by !== req.staff.id });
}));

router.post('/:id/decision', ah(async (req, res) => {
  if (!isApprover(req.staff)) throw forbidden('Only Home Affairs supervisors approve information requests.');
  const v = parse(z.object({
    decision: z.enum(['approved', 'denied']),
    note: z.string().trim().min(5, 'Write a short reason for your decision.').max(500),
  }), req.body);
  const ar = await tx(async (db) => {
    const row = (await db.query('SELECT * FROM access_requests WHERE id = $1 FOR UPDATE', [req.params.id])).rows[0];
    if (!row) throw notFound('Request not found.');
    return decideBySupervisor(db, req, row, v.decision, v.note);
  });
  res.json({ request: ar, message: v.decision === 'approved' ? `Approved until ${new Date(ar.expires_at).toLocaleDateString('en-GB')}.` : 'Request denied.' });
}));

export default router;
