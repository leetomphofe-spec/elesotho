import { Router } from 'express';
import { query } from '../db.js';
import { ah, notFound } from '../lib/http.js';

const router = Router();

router.get('/departments', ah(async (_req, res) => {
  const { rows } = await query(
    `SELECT d.code, d.name, d.short_name, d.description,
            count(s.id) FILTER (WHERE s.is_active)::int AS service_count
       FROM departments d LEFT JOIN services s ON s.department_id = d.id
      GROUP BY d.id ORDER BY d.sort_order`
  );
  res.json({ departments: rows });
}));

router.get('/departments/:code', ah(async (req, res) => {
  const d = (await query('SELECT id, code, name, short_name, description FROM departments WHERE code = $1', [req.params.code])).rows[0];
  if (!d) throw notFound('That department does not exist.');
  const { rows } = await query(
    `SELECT code, name, summary, applies_to, requires_appointment, requirements_verified, min_age
       FROM services WHERE department_id = $1 AND is_active ORDER BY sort_order`,
    [d.id]
  );
  res.json({ department: d, services: rows });
}));

router.get('/services/:code', ah(async (req, res) => {
  const s = (await query(
    `SELECT s.*, d.code AS department_code, d.name AS department_name
       FROM services s JOIN departments d ON d.id = s.department_id WHERE s.code = $1 AND s.is_active`,
    [req.params.code]
  )).rows[0];
  if (!s) throw notFound('That service does not exist or is not available.');
  const reqs = await query(
    `SELECT id, applicant_category, label, detail, is_fee, is_verified FROM service_requirements
      WHERE service_id = $1 ORDER BY sort_order, id`, [s.id]
  );
  const fees = await query(
    'SELECT id, code, label, amount, note, is_verified FROM service_fees WHERE service_id = $1 AND is_active ORDER BY amount', [s.id]
  );
  res.json({
    service: {
      code: s.code, name: s.name, summary: s.summary, description: s.description, appliesTo: s.applies_to,
      requiresNationalId: s.requires_national_id, requiresAppointment: s.requires_appointment, inPersonNote: s.in_person_note,
      minAge: s.min_age, requirementsVerified: s.requirements_verified,
      department: { code: s.department_code, name: s.department_name },
    },
    requirements: {
      adult: reqs.rows.filter((r) => ['adult', 'any'].includes(r.applicant_category)),
      minor: reqs.rows.filter((r) => ['minor', 'any'].includes(r.applicant_category)),
    },
    fees: fees.rows,
  });
}));

router.get('/offices', ah(async (req, res) => {
  const dept = req.query.department || 'PASSPORT';
  const q = String(req.query.q || '').trim();
  const { rows } = await query(
    `SELECT o.id, o.name, o.district, o.location, o.phone, o.hours, o.details_verified
       FROM offices o JOIN departments d ON d.id = o.department_id
      WHERE d.code = $1 AND o.is_active
        AND ($2 = '' OR o.name ILIKE '%' || $2 || '%' OR o.district ILIKE '%' || $2 || '%' OR o.location ILIKE '%' || $2 || '%')
      ORDER BY (o.district = 'Maseru') DESC, o.district`,
    [dept, q]
  );
  res.json({ offices: rows });
}));

router.get('/offices/:id/slots', ah(async (req, res) => {
  const office = (await query('SELECT id, name, district, location, phone, hours FROM offices WHERE id = $1 AND is_active', [req.params.id])).rows[0];
  if (!office) throw notFound('That office does not exist.');
  const { rows } = await query(
    `SELECT id, starts_at, capacity - booked AS available,
            to_char(starts_at AT TIME ZONE 'Africa/Maseru', 'YYYY-MM-DD') AS day,
            to_char(starts_at AT TIME ZONE 'Africa/Maseru', 'HH24:MI') AS time
       FROM appointment_slots
      WHERE office_id = $1 AND NOT is_blocked AND starts_at > now() + interval '2 hours'
        AND starts_at < now() + interval '60 days'
      ORDER BY starts_at`,
    [office.id]
  );
  // Group by day for the date picker
  const days = [];
  for (const s of rows) {
    let d = days.find((x) => x.day === s.day);
    if (!d) { d = { day: s.day, slots: [] }; days.push(d); }
    d.slots.push({ id: s.id, time: s.time, startsAt: s.starts_at, available: s.available });
  }
  const next = rows.find((s) => s.available > 0);
  res.json({ office, days, nextAvailable: next ? { id: next.id, day: next.day, time: next.time, startsAt: next.starts_at } : null });
}));

export default router;
