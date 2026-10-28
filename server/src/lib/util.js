import { query } from '../db.js';

export function maskId(id) {
  if (!id) return null;
  const s = String(id);
  if (s.length <= 3) return '•••';
  return '•'.repeat(Math.max(3, s.length - 3)) + s.slice(-3);
}

export function ageOn(dob, on = new Date()) {
  const d = new Date(`${dob}T00:00:00Z`);
  let age = on.getUTCFullYear() - d.getUTCFullYear();
  const m = on.getUTCMonth() - d.getUTCMonth();
  if (m < 0 || (m === 0 && on.getUTCDate() < d.getUTCDate())) age--;
  return age;
}

/** Normalise Lesotho phone numbers to 8 digits (drops +266 / 266 prefix). */
export function normalisePhone(p) {
  if (!p) return p;
  let s = String(p).replace(/[\s-]/g, '');
  if (s.startsWith('+266')) s = s.slice(4);
  else if (s.startsWith('266') && s.length === 11) s = s.slice(3);
  return s;
}

export function normaliseNid(n) {
  return n ? String(n).trim().toUpperCase().replace(/\s/g, '') : null;
}

const settingsCache = { at: 0, values: {} };
export async function getSettings(db) {
  if (Date.now() - settingsCache.at < 30_000 && !db) return settingsCache.values;
  const { rows } = await (db || { query }).query('SELECT key, value FROM settings');
  settingsCache.values = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  settingsCache.at = Date.now();
  return settingsCache.values;
}
export function clearSettingsCache() { settingsCache.at = 0; }

export const STATUS_LABELS = {
  draft: 'Draft',
  preparing_documents: 'Preparing documents',
  ready_for_visit: 'Ready for office visit',
  submitted: 'Submitted',
  under_review: 'Under review',
  additional_info_required: 'Additional information required',
  completed: 'Completed',
  rejected: 'Rejected',
  cancelled: 'Cancelled',
};

export const CITIZEN_FIELDS = {
  full_name: 'Full name',
  date_of_birth: 'Date of birth',
  sex: 'Sex',
  national_id: 'National ID number (full)',
  national_id_masked: 'National ID number (last 3 digits)',
  phone: 'Phone number',
  email: 'Email address',
  address: 'Home address',
  district: 'District',
  verification_status: 'Identity verification status',
};

export function formatDateTime(ts) {
  return new Date(ts).toLocaleString('en-GB', {
    timeZone: 'Africa/Maseru', weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}
