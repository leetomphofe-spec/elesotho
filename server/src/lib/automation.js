/**
 * Automation engine. Runs on a timer, on startup, and lazily on incoming
 * requests (so it still runs on hosting plans that sleep when idle).
 */
import { pool, tx } from '../db.js';
import { config } from '../config.js';
import { notify } from './notify.js';
import { auditSystem } from './audit.js';
import { transition } from './workflow.js';
import { getSettings, formatDateTime } from './util.js';

let running = false;
let lastRunAt = 0;

export async function generateSlots(db, horizonDays) {
  const r = await db.query(
    `INSERT INTO appointment_slots (office_id, starts_at, capacity)
     SELECT o.id, ((d::date + t::time) AT TIME ZONE 'Africa/Maseru'), o.slot_capacity
       FROM offices o
       CROSS JOIN generate_series((now() AT TIME ZONE 'Africa/Maseru')::date + 1,
                                  (now() AT TIME ZONE 'Africa/Maseru')::date + $1::int, interval '1 day') AS d
       CROSS JOIN LATERAL generate_series(timestamp '2000-01-01' + o.open_time,
                                          timestamp '2000-01-01' + o.close_time - make_interval(mins => o.slot_minutes),
                                          make_interval(mins => o.slot_minutes)) AS t
      WHERE o.is_active
        AND extract(isodow FROM d) < 6
        AND d::date NOT IN (SELECT holiday_date FROM holidays)
     ON CONFLICT (office_id, starts_at) DO NOTHING`,
    [horizonDays]
  );
  return r.rowCount;
}

async function visitReminders(db, hours) {
  const { rows } = await db.query(
    `SELECT a.id, a.citizen_id, a.reference, a.slot_id, s.name AS service, sl.starts_at, o.name AS office
       FROM applications a
       JOIN services s ON s.id = a.service_id
       JOIN appointment_slots sl ON sl.id = a.slot_id
       JOIN offices o ON o.id = sl.office_id
      WHERE a.status = 'ready_for_visit' AND sl.starts_at BETWEEN now() AND now() + ($1 || ' hours')::interval`,
    [String(hours)]
  );
  let n = 0;
  for (const a of rows) {
    const sent = await notify(db, a.citizen_id, {
      type: 'visit_reminder', title: 'Upcoming office visit',
      body: `Reminder: ${a.service} (${a.reference}) visit on ${formatDateTime(a.starts_at)} at ${a.office}. Bring your original documents.`,
      link: `/applications/${a.id}`, dedupeKey: `visit:${a.id}:${a.slot_id}`,
    });
    if (sent) n++;
  }
  return n;
}

async function missedVisits(db) {
  // A visit is missed if the slot ended more than 2 hours ago with no check-in.
  const { rows } = await db.query(
    `SELECT a.id FROM applications a JOIN appointment_slots sl ON sl.id = a.slot_id
      WHERE a.status = 'ready_for_visit' AND sl.starts_at < now() - interval '2 hours'`
  );
  for (const a of rows) {
    await tx((c) => transition(c, a.id, 'preparing_documents', { type: 'system', id: 'SYSTEM', label: 'Automation' },
      { reason: 'The booked visit time passed without a check-in at the office.' }));
  }
  return rows.length;
}

async function draftReminders(db, days) {
  const { rows } = await db.query(
    `SELECT a.id, a.citizen_id, a.reference, s.name AS service, a.updated_at::date AS d
       FROM applications a JOIN services s ON s.id = a.service_id
      WHERE a.status IN ('draft','preparing_documents') AND a.updated_at < now() - ($1 || ' days')::interval`,
    [String(days)]
  );
  let n = 0;
  for (const a of rows) {
    const sent = await notify(db, a.citizen_id, {
      type: 'checklist_incomplete', title: 'Your application is not finished',
      body: `${a.service} (${a.reference}) still needs your document checklist and office visit. Continue where you left off.`,
      link: `/applications/${a.id}`, dedupeKey: `draft:${a.id}:${a.d}`,
    });
    if (sent) n++;
  }
  return n;
}

async function expireDrafts(days) {
  const { rows } = await pool.query(
    `SELECT id FROM applications WHERE status IN ('draft','preparing_documents') AND updated_at < now() - ($1 || ' days')::interval`,
    [String(days)]
  );
  for (const a of rows) {
    await tx((c) => transition(c, a.id, 'cancelled', { type: 'system', id: 'SYSTEM', label: 'Automation' },
      { reason: `It was not continued for ${days} days. You can start a new application at any time.` }));
  }
  return rows.length;
}

async function expireAccess(db, consentDays) {
  const consent = await db.query(
    `UPDATE access_requests SET status = 'expired', decided_by_system = true, decided_at = now(),
       decision_note = 'The citizen did not respond in time.'
      WHERE status = 'pending_consent' AND created_at < now() - ($1 || ' days')::interval RETURNING reference, citizen_id, requesting_department_id`,
    [String(consentDays)]
  );
  const grants = await db.query(
    `UPDATE access_requests SET status = 'expired'
      WHERE status = 'approved' AND expires_at < now() RETURNING reference, citizen_id, requesting_department_id`
  );
  for (const r of [...consent.rows, ...grants.rows]) {
    await auditSystem(db, { action: 'ACCESS_EXPIRED', entityType: 'access_request', entityId: r.reference, citizenId: r.citizen_id,
      departmentId: r.requesting_department_id });
  }
  return consent.rowCount + grants.rowCount;
}

async function pensionNotices(db, noticeDays) {
  const svc = (await db.query("SELECT id, min_age FROM services WHERE code = 'OLD_AGE_PENSION' AND is_active")).rows[0];
  if (!svc?.min_age) return 0;
  const { rows } = await db.query(
    `SELECT c.id, (c.date_of_birth + make_interval(years => $1)) AS eligible_on
       FROM citizens c
      WHERE c.verification_status = 'verified'
        AND c.date_of_birth + make_interval(years => $1) <= (now() + ($2 || ' days')::interval)::date
        AND NOT EXISTS (SELECT 1 FROM applications a WHERE a.citizen_id = c.id AND a.service_id = $3 AND a.status <> 'cancelled')`,
    [svc.min_age, String(noticeDays), svc.id]
  );
  let n = 0;
  for (const c of rows) {
    const date = new Date(c.eligible_on).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
    const past = new Date(c.eligible_on) <= new Date();
    const sent = await notify(db, c.id, {
      type: 'system', title: 'You may qualify for the old age pension',
      body: past
        ? `Our records show you are ${svc.min_age} or older. You may apply for the old age pension under Pension Services.`
        : `You reach the qualifying age of ${svc.min_age} on ${date}. You can prepare your pension application under Pension Services.`,
      link: '/services/PENSION', dedupeKey: `pension:${c.id}`,
    });
    if (sent) n++;
  }
  return n;
}

export async function runAutomation(trigger = 'schedule') {
  if (running) return { skipped: true };
  running = true;
  lastRunAt = Date.now();
  const run = await pool.query('INSERT INTO job_runs (trigger) VALUES ($1) RETURNING id', [trigger]);
  const result = {};
  try {
    const s = await getSettings(pool);
    result.slotsCreated = await generateSlots(pool, Number(s.slot_horizon_days ?? 21));
    result.visitReminders = await visitReminders(pool, Number(s.visit_reminder_hours ?? 24));
    result.missedVisits = await missedVisits(pool);
    result.draftReminders = await draftReminders(pool, Number(s.draft_reminder_days ?? 3));
    result.draftsCancelled = await expireDrafts(Number(s.draft_expiry_days ?? 30));
    result.accessExpired = await expireAccess(pool, Number(s.consent_expiry_days ?? 7));
    result.pensionNotices = await pensionNotices(pool, Number(s.pension_notice_days ?? 60));
    await pool.query('UPDATE job_runs SET finished_at = now(), result = $2 WHERE id = $1', [run.rows[0].id, JSON.stringify(result)]);
    return result;
  } catch (err) {
    console.error('[automation] failed', err);
    await pool.query('UPDATE job_runs SET finished_at = now(), error = $2, result = $3 WHERE id = $1',
      [run.rows[0].id, err.message, JSON.stringify(result)]);
    throw err;
  } finally {
    running = false;
  }
}

/** Express middleware: kick off automation in the background if it is overdue. */
export function lazyAutomation(_req, _res, next) {
  if (!running && Date.now() - lastRunAt > config.automationIntervalMinutes * 60_000) {
    runAutomation('on-request').catch(() => {});
  }
  next();
}

export function startScheduler() {
  setInterval(() => runAutomation('schedule').catch(() => {}), config.automationIntervalMinutes * 60_000).unref();
}
