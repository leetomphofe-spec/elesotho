import { Router } from 'express';
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { tx, query } from '../db.js';
import { config } from '../config.js';
import { ah, parse, badRequest, HttpError } from '../lib/http.js';
import { audit } from '../lib/audit.js';
import { notify } from '../lib/notify.js';
import { sendMail, mailEnabled } from '../lib/mailer.js';
import { ageOn, normalisePhone, normaliseNid, maskId } from '../lib/util.js';
import { issueSession, clearSession, requireCitizen, requireStaff } from '../middleware/auth.js';

const router = Router();
const limiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 30, standardHeaders: true, legacyHeaders: false,
  message: { error: 'Too many attempts. Wait 15 minutes and try again.' } });

const password = z.string()
  .min(8, 'Use at least 8 characters.')
  .regex(/[A-Za-z]/, 'Include at least one letter.')
  .regex(/[0-9]/, 'Include at least one number.');

const phone = z.string().transform(normalisePhone).pipe(z.string().regex(/^[256]\d{7}$/, 'Enter an 8-digit Lesotho number, for example 5800 0000.'));

const registerSchema = z.object({
  hasNationalId: z.boolean(),
  nationalId: z.string().optional().nullable(),
  firstName: z.string().trim().min(1, 'Enter your first name.').max(60),
  surname: z.string().trim().min(1, 'Enter your surname.').max(60),
  dateOfBirth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Enter your date of birth.'),
  sex: z.enum(['F', 'M'], { errorMap: () => ({ message: 'Choose female or male.' }) }),
  phone,
  email: z.string().trim().email('Enter a valid email address, like name@example.com.').optional().or(z.literal('')).nullable(),
  district: z.string().min(1, 'Choose your district.'),
  password,
  acceptTerms: z.literal(true, { errorMap: () => ({ message: 'You must agree before creating an account.' }) }),
}).superRefine((v, ctx) => {
  if (v.hasNationalId && !/^[A-Za-z0-9]{6,15}$/.test((v.nationalId || '').replace(/\s/g, ''))) {
    ctx.addIssue({ path: ['nationalId'], code: 'custom', message: 'Enter your National ID number (6 to 15 letters or digits).' });
  }
  const d = new Date(v.dateOfBirth);
  if (Number.isNaN(d.getTime()) || d > new Date()) ctx.addIssue({ path: ['dateOfBirth'], code: 'custom', message: 'Enter a real date in the past.' });
  else if (ageOn(v.dateOfBirth) < 16) {
    ctx.addIssue({ path: ['dateOfBirth'], code: 'custom', message: 'You must be 16 or older to have an account. A parent or guardian can apply for a child from their own account.' });
  }
});

const cleanName = (s) => String(s || '').toLowerCase().replace(/[^a-z]/g, '');

export function citizenDto(c, extra = {}) {
  return {
    id: c.id,
    firstName: c.first_name,
    surname: c.surname,
    dateOfBirth: c.date_of_birth,
    sex: c.sex,
    phone: c.phone,
    email: c.email,
    district: c.district,
    address: c.address,
    nationalIdMasked: maskId(c.national_id),
    hasNationalId: Boolean(c.national_id),
    verificationStatus: c.verification_status,
    verificationNote: c.verification_note,
    verifiedAt: c.verified_at,
    age: ageOn(c.date_of_birth),
    ...extra,
  };
}

// ---------------------------------------------------------------- citizens
router.post('/register', limiter, ah(async (req, res) => {
  const v = parse(registerSchema, req.body);
  const nid = v.hasNationalId ? normaliseNid(v.nationalId) : null;
  const email = v.email ? v.email.toLowerCase() : null;

  const citizen = await tx(async (db) => {
    const dupes = await db.query(
      'SELECT national_id, phone, lower(email) AS email FROM citizens WHERE national_id = $1 OR phone = $2 OR lower(email) = $3',
      [nid, v.phone, email]
    );
    const fields = {};
    for (const d of dupes.rows) {
      if (nid && d.national_id === nid) fields.nationalId = 'An account already exists for this ID number. Log in or reset your password.';
      if (d.phone === v.phone) fields.phone = 'This phone number is already used by another account.';
      if (email && d.email === email) fields.email = 'This email is already used by another account.';
    }
    if (Object.keys(fields).length) throw badRequest('Some details are already registered.', fields);

    // Automatic identity verification against the population register
    let status = 'unverified';
    let note = 'You have no National ID on record. Apply for a National ID under Home Affairs.';
    let registerId = null;
    let sex = v.sex;
    if (nid) {
      const r = (await db.query('SELECT * FROM population_register WHERE national_id = $1', [nid])).rows[0];
      if (!r) {
        status = 'pending_office';
        note = 'We could not find this ID number in the population register. Visit a Home Affairs office with your ID card to verify your identity.';
      } else if (r.life_status !== 'alive') {
        status = 'pending_office';
        note = 'Your record needs to be checked by an officer. Visit a Home Affairs office with your ID card.';
      } else if (cleanName(r.surname) === cleanName(v.surname) && r.date_of_birth === v.dateOfBirth) {
        status = 'verified';
        note = 'Matched automatically with the population register.';
        registerId = r.id;
        sex = r.sex;
      } else {
        status = 'pending_office';
        note = 'Your surname or date of birth does not match the population register. Visit a Home Affairs office with your ID card to correct it.';
      }
    }

    const hash = await bcrypt.hash(v.password, 10);
    const ins = await db.query(
      `INSERT INTO citizens (register_id, national_id, first_name, surname, date_of_birth, sex, phone, email, district,
         password_hash, verification_status, verification_note, verified_at, verified_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12, CASE WHEN $11 = 'verified' THEN now() END, CASE WHEN $11 = 'verified' THEN 'SYSTEM' END)
       RETURNING *`,
      [registerId, nid, v.firstName, v.surname, v.dateOfBirth, sex, v.phone, email, v.district, hash, status, note]
    );
    const c = ins.rows[0];
    req.session = { t: 'citizen', id: c.id };
    await audit(db, req, { action: 'CITIZEN_REGISTERED', entityType: 'citizen', entityId: c.id, citizenId: c.id,
      details: { verification: status } });
    if (status === 'verified') {
      await audit(db, null, { actorType: 'system', actorId: 'SYSTEM', actorLabel: 'Automation', action: 'IDENTITY_VERIFIED',
        entityType: 'citizen', entityId: c.id, citizenId: c.id, details: { method: 'population register match' } });
    }
    await notify(db, c.id, {
      type: 'system',
      title: status === 'verified' ? 'Your account is verified' : 'Your account is created',
      body: status === 'verified'
        ? 'Your identity was confirmed with the population register. You can now apply for services.'
        : note,
      link: '/profile',
    });
    return c;
  });

  const expiresAt = issueSession(res, { t: 'citizen', id: citizen.id, v: citizen.session_version });
  res.status(201).json({ citizen: citizenDto(citizen), sessionExpiresAt: expiresAt });
}));

const loginSchema = z.object({
  identifier: z.string().trim().min(1, 'Enter your ID number, phone number or email.'),
  password: z.string().min(1, 'Enter your password.'),
});

async function checkLock(row) {
  if (row.locked_until && new Date(row.locked_until) > new Date()) {
    const mins = Math.ceil((new Date(row.locked_until) - Date.now()) / 60000);
    throw new HttpError(423, `This account is locked after too many failed attempts. Try again in ${mins} minute${mins === 1 ? '' : 's'}.`);
  }
}

async function recordFailure(table, row, req) {
  const failed = row.failed_logins + 1;
  const lock = failed >= config.maxFailedLogins;
  await query(
    `UPDATE ${table} SET failed_logins = $2, locked_until = CASE WHEN $3 THEN now() + ($4 || ' minutes')::interval ELSE locked_until END WHERE id = $1`,
    [row.id, lock ? 0 : failed, lock, String(config.lockMinutes)]
  );
  await audit(null, req, { action: 'LOGIN_FAILED', entityType: table === 'citizens' ? 'citizen' : 'staff', entityId: row.id,
    citizenId: table === 'citizens' ? row.id : null, outcome: 'failed', details: { locked: lock } });
  const left = config.maxFailedLogins - failed;
  return lock
    ? `Too many failed attempts. The account is locked for ${config.lockMinutes} minutes.`
    : `The details you entered do not match our records. ${left} attempt${left === 1 ? '' : 's'} left before the account is locked.`;
}

router.post('/login', limiter, ah(async (req, res) => {
  const { identifier, password: pw } = parse(loginSchema, req.body);
  const { rows } = await query(
    'SELECT * FROM citizens WHERE national_id = $1 OR phone = $2 OR lower(email) = lower($3) LIMIT 1',
    [normaliseNid(identifier), normalisePhone(identifier), identifier]
  );
  const c = rows[0];
  if (!c) throw new HttpError(401, 'The details you entered do not match our records. Check your ID number, phone or email and password.');
  await checkLock(c);
  if (!(await bcrypt.compare(pw, c.password_hash))) throw new HttpError(401, await recordFailure('citizens', c, req));

  await query('UPDATE citizens SET failed_logins = 0, locked_until = NULL, last_login_at = now() WHERE id = $1', [c.id]);
  req.session = { t: 'citizen', id: c.id };
  await audit(null, req, { action: 'LOGIN', entityType: 'citizen', entityId: c.id, citizenId: c.id });
  const expiresAt = issueSession(res, { t: 'citizen', id: c.id, v: c.session_version });
  res.json({ citizen: citizenDto(c), sessionExpiresAt: expiresAt });
}));

router.post('/logout', ah(async (req, res) => {
  if (req.session) await audit(null, req, { action: 'LOGOUT', entityType: req.session.t, entityId: req.session.id,
    citizenId: req.session.t === 'citizen' ? req.session.id : null });
  clearSession(res);
  res.json({ ok: true });
}));

router.get('/me', requireCitizen, ah(async (req, res) => {
  const unread = await query('SELECT count(*)::int AS n FROM notifications WHERE citizen_id = $1 AND NOT is_read', [req.citizen.id]);
  res.json({ citizen: citizenDto(req.citizen, { unreadNotifications: unread.rows[0].n }), sessionExpiresAt: req.sessionExpiresAt });
}));

router.post('/forgot-password', limiter, ah(async (req, res) => {
  const { identifier } = parse(z.object({ identifier: z.string().trim().min(1, 'Enter your ID number, phone number or email.') }), req.body);
  const { rows } = await query(
    'SELECT * FROM citizens WHERE national_id = $1 OR phone = $2 OR lower(email) = lower($3) LIMIT 1',
    [normaliseNid(identifier), normalisePhone(identifier), identifier]
  );
  const c = rows[0];
  const response = {
    message: 'If an account matches these details, we have sent password reset instructions to the email on the account. '
      + 'If your account has no email, visit any Home Affairs office with your ID card and an officer will help you.',
  };
  if (c) {
    const token = crypto.randomBytes(32).toString('hex');
    const hash = crypto.createHash('sha256').update(token).digest('hex');
    await query(
      `INSERT INTO password_resets (account_type, account_id, token_hash, expires_at) VALUES ('citizen',$1,$2, now() + interval '30 minutes')`,
      [c.id, hash]
    );
    const link = `${config.appUrl}/reset-password?token=${token}`;
    if (c.email) await sendMail(c.email, 'Reset your Government Services password', `Use this link within 30 minutes to choose a new password:\n\n${link}\n\nIf you did not ask for this, ignore this email.`);
    await audit(null, req, { action: 'PASSWORD_RESET_REQUESTED', entityType: 'citizen', entityId: c.id, citizenId: c.id,
      details: { emailSent: Boolean(c.email && mailEnabled()) } });
    if (config.showResetLink) response.demoResetLink = `/reset-password?token=${token}`;
  }
  res.json(response);
}));

router.post('/reset-password', limiter, ah(async (req, res) => {
  const { token, password: pw } = parse(z.object({ token: z.string().min(10, 'This reset link is not valid.'), password }), req.body);
  const hash = crypto.createHash('sha256').update(token).digest('hex');
  await tx(async (db) => {
    const r = (await db.query(
      `SELECT * FROM password_resets WHERE token_hash = $1 AND used_at IS NULL AND expires_at > now() FOR UPDATE`, [hash]
    )).rows[0];
    if (!r) throw badRequest('This reset link has expired or was already used. Ask for a new one.');
    const table = r.account_type === 'citizen' ? 'citizens' : 'staff';
    await db.query(
      `UPDATE ${table} SET password_hash = $2, session_version = session_version + 1, failed_logins = 0, locked_until = NULL WHERE id = $1`,
      [r.account_id, await bcrypt.hash(pw, 10)]
    );
    await db.query('UPDATE password_resets SET used_at = now() WHERE id = $1', [r.id]);
    await audit(db, req, { action: 'PASSWORD_RESET', entityType: r.account_type, entityId: r.account_id,
      citizenId: r.account_type === 'citizen' ? r.account_id : null, actorType: 'anonymous' });
  });
  res.json({ message: 'Your password was changed. Log in with your new password.' });
}));

// ---------------------------------------------------------------- staff
export function staffDto(s) {
  return {
    id: s.id,
    staffNumber: s.staff_number,
    fullName: s.full_name,
    email: s.email,
    role: s.role,
    departmentId: s.department_id,
    departmentCode: s.department_code ?? null,
    departmentName: s.department_name ?? (s.role === 'admin' ? 'System administration' : null),
    isDataOwner: Boolean(s.is_data_owner),
    officeId: s.office_id,
    mustChangePassword: s.must_change_password,
  };
}

router.post('/staff/login', limiter, ah(async (req, res) => {
  const { identifier, password: pw } = parse(z.object({
    identifier: z.string().trim().min(1, 'Enter your staff number or work email.'),
    password: z.string().min(1, 'Enter your password.'),
  }), req.body);
  const { rows } = await query(
    `SELECT s.*, d.code AS department_code, d.name AS department_name, d.is_data_owner
       FROM staff s LEFT JOIN departments d ON d.id = s.department_id
      WHERE upper(s.staff_number) = upper($1) OR lower(s.email) = lower($1) LIMIT 1`,
    [identifier]
  );
  const s = rows[0];
  if (!s || !s.is_active) throw new HttpError(401, 'The staff number or password is not correct, or the account is not active.');
  await checkLock(s);
  if (!(await bcrypt.compare(pw, s.password_hash))) throw new HttpError(401, await recordFailure('staff', s, req));
  await query('UPDATE staff SET failed_logins = 0, locked_until = NULL, last_login_at = now() WHERE id = $1', [s.id]);
  req.staff = s;
  await audit(null, req, { action: 'STAFF_LOGIN', entityType: 'staff', entityId: s.id });
  const expiresAt = issueSession(res, { t: 'staff', id: s.id, v: s.session_version });
  res.json({ staff: staffDto(s), sessionExpiresAt: expiresAt });
}));

router.get('/staff/me', requireStaff, (req, res) => {
  res.json({ staff: staffDto(req.staff), sessionExpiresAt: req.sessionExpiresAt });
});

router.post('/staff/change-password', requireStaff, ah(async (req, res) => {
  const v = parse(z.object({ currentPassword: z.string().min(1, 'Enter your current password.'), newPassword: password }), req.body);
  if (!(await bcrypt.compare(v.currentPassword, req.staff.password_hash))) {
    throw badRequest('Your current password is not correct.', { currentPassword: 'Your current password is not correct.' });
  }
  if (v.currentPassword === v.newPassword) throw badRequest('Choose a password you have not used here before.', { newPassword: 'Choose a different password.' });
  const r = await query(
    `UPDATE staff SET password_hash = $2, must_change_password = false, session_version = session_version + 1 WHERE id = $1 RETURNING session_version`,
    [req.staff.id, await bcrypt.hash(v.newPassword, 10)]
  );
  await audit(null, req, { action: 'STAFF_PASSWORD_CHANGED', entityType: 'staff', entityId: req.staff.id });
  issueSession(res, { t: 'staff', id: req.staff.id, v: r.rows[0].session_version });
  res.json({ message: 'Password changed.' });
}));

export default router;
