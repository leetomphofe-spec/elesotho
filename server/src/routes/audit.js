import { Router } from 'express';
import { query } from '../db.js';
import { ah } from '../lib/http.js';
import { audit } from '../lib/audit.js';
import { requireStaff, requirePasswordChanged, requireRole } from '../middleware/auth.js';

const router = Router();
router.use(requireStaff, requirePasswordChanged, requireRole('supervisor', 'admin'));

/** Supervisors see their own department's log. The administrator sees everything. */
router.get('/', ah(async (req, res) => {
  const isAdmin = req.staff.role === 'admin';
  const dept = isAdmin ? (req.query.department ? Number(req.query.department) : null) : req.staff.department_id;
  const action = String(req.query.action || '');
  const outcome = String(req.query.outcome || '');
  const q = String(req.query.q || '').trim();
  const from = req.query.from || null;
  const to = req.query.to || null;
  const page = Math.max(1, Number(req.query.page || 1));
  const pageSize = 50;

  const where = `
    WHERE ($1::int IS NULL OR l.department_id = $1)
      AND ($2 = '' OR l.action = $2)
      AND ($3 = '' OR l.outcome = $3)
      AND ($4 = '' OR l.actor_label ILIKE '%' || $4 || '%' OR l.entity_id ILIKE '%' || $4 || '%' OR l.details::text ILIKE '%' || $4 || '%')
      AND ($5::date IS NULL OR l.at >= $5::date)
      AND ($6::date IS NULL OR l.at < $6::date + 1)`;
  const params = [dept, action, outcome, q, from, to];
  const [rows, total, actions] = await Promise.all([
    query(`SELECT l.id, l.at, l.actor_type, l.actor_label, l.action, l.entity_type, l.entity_id, l.outcome, l.details, l.ip,
                  d.short_name AS department
             FROM audit_log l LEFT JOIN departments d ON d.id = l.department_id ${where}
            ORDER BY l.at DESC, l.id DESC LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`, params),
    query(`SELECT count(*)::int AS n FROM audit_log l ${where}`, params),
    query('SELECT DISTINCT action FROM audit_log ORDER BY action'),
  ]);
  await audit(null, req, { action: 'VIEW_AUDIT_LOG', details: { department: dept, action, page } });

  if (req.query.format === 'csv') {
    const esc = (s) => `"${String(s ?? '').replace(/"/g, '""')}"`;
    const lines = ['time,actor_type,actor,department,action,entity,outcome,details'];
    for (const r of rows.rows) {
      lines.push([new Date(r.at).toISOString(), r.actor_type, r.actor_label, r.department, r.action, `${r.entity_type || ''}:${r.entity_id || ''}`, r.outcome, JSON.stringify(r.details)].map(esc).join(','));
    }
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="audit-log.csv"');
    return res.send(lines.join('\n'));
  }
  res.json({ entries: rows.rows, total: total.rows[0].n, page, pageSize, actions: actions.rows.map((r) => r.action), scope: isAdmin ? 'all' : 'department' });
}));

export default router;
