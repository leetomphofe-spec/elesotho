import { query } from '../db.js';
import { sendMail } from './mailer.js';

/**
 * Create an in-app notification (and email copy when the citizen has an email
 * and SMTP is configured). dedupeKey stops automation sending duplicates.
 */
export async function notify(db, citizenId, { type, title, body, link = null, dedupeKey = null }) {
  const r = await (db || { query }).query(
    `INSERT INTO notifications (citizen_id, type, title, body, link, dedupe_key)
     VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (dedupe_key) DO NOTHING RETURNING id`,
    [citizenId, type, title, body, link, dedupeKey]
  );
  if (r.rowCount > 0) {
    const c = await (db || { query }).query('SELECT email FROM citizens WHERE id = $1', [citizenId]);
    if (c.rows[0]?.email) {
      // fire and forget
      sendMail(c.rows[0].email, title, `${body}\n\nLog in to the Government Services portal to see more.`);
    }
  }
  return r.rowCount > 0;
}
