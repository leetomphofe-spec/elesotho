import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { query } from '../db.js';
import { HttpError } from '../lib/http.js';

const COOKIE = 'gs_session';

function ttlMinutes(type) {
  return type === 'staff' ? config.staffIdleMinutes : config.citizenIdleMinutes;
}

/** Issue a session cookie. Payload: { t: 'citizen'|'staff', id, v: session_version } */
export function issueSession(res, payload) {
  const minutes = ttlMinutes(payload.t);
  const token = jwt.sign({ t: payload.t, id: payload.id, v: payload.v }, config.jwtSecret, { expiresIn: minutes * 60 });
  res.cookie(COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.isProd,
    maxAge: minutes * 60 * 1000,
    path: '/',
  });
  return new Date(Date.now() + minutes * 60 * 1000);
}

export function clearSession(res) {
  // Must use the same attributes as when set, or browsers keep the Secure cookie
  res.clearCookie(COOKIE, { path: '/', httpOnly: true, sameSite: 'lax', secure: config.isProd });
}

/** Read the session cookie and slide the idle timeout forward on activity. */
export function loadSession(req, res, next) {
  const token = req.cookies?.[COOKIE];
  if (!token) return next();
  try {
    const p = jwt.verify(token, config.jwtSecret);
    req.session = p;
    const remainingMs = p.exp * 1000 - Date.now();
    // Requests marked as passive (e.g. polling) do not extend the session.
    if (req.get('x-passive') !== '1' && remainingMs < (ttlMinutes(p.t) * 60 * 1000) / 2) {
      req.sessionExpiresAt = issueSession(res, p);
    } else {
      req.sessionExpiresAt = new Date(p.exp * 1000);
    }
  } catch {
    clearSession(res);
  }
  next();
}

/** Simple CSRF guard: state-changing requests must carry our custom header. */
export function csrfGuard(req, _res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  if (req.get('x-requested-with') !== 'gov-portal') {
    return next(new HttpError(403, 'Request blocked for security reasons. Reload the page and try again.'));
  }
  next();
}

export async function requireCitizen(req, _res, next) {
  try {
    if (req.session?.t !== 'citizen') throw new HttpError(401, 'Please log in to continue.', { code: 'AUTH' });
    const { rows } = await query('SELECT * FROM citizens WHERE id = $1', [req.session.id]);
    const c = rows[0];
    if (!c || c.session_version !== req.session.v) throw new HttpError(401, 'Your session has ended. Please log in again.', { code: 'AUTH' });
    req.citizen = c;
    next();
  } catch (err) {
    next(err);
  }
}

export async function requireStaff(req, _res, next) {
  try {
    if (req.session?.t !== 'staff') throw new HttpError(401, 'Please log in to the staff workspace.', { code: 'AUTH' });
    const { rows } = await query(
      `SELECT s.*, d.code AS department_code, d.name AS department_name, d.is_data_owner
         FROM staff s LEFT JOIN departments d ON d.id = s.department_id WHERE s.id = $1`,
      [req.session.id]
    );
    const s = rows[0];
    if (!s || !s.is_active || s.session_version !== req.session.v) {
      throw new HttpError(401, 'Your session has ended. Please log in again.', { code: 'AUTH' });
    }
    req.staff = s;
    next();
  } catch (err) {
    next(err);
  }
}

/** Blocks staff who still have to replace a temporary password. */
export function requirePasswordChanged(req, _res, next) {
  if (req.staff?.must_change_password) {
    return next(new HttpError(403, 'Change your temporary password before continuing.', { code: 'PASSWORD_CHANGE' }));
  }
  next();
}

export const requireRole = (...roles) => (req, _res, next) => {
  if (!req.staff || !roles.includes(req.staff.role)) {
    return next(new HttpError(403, 'Your role does not allow this action.', { code: 'ACCESS_DENIED' }));
  }
  next();
};
