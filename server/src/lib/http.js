import { ZodError } from 'zod';

export class HttpError extends Error {
  constructor(status, message, extra = {}) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

export const badRequest = (msg, fields) => new HttpError(400, msg, fields ? { fields } : {});
export const notFound = (msg = 'We could not find that record.') => new HttpError(404, msg);
export const forbidden = (msg, extra) => new HttpError(403, msg, { code: 'ACCESS_DENIED', ...extra });
export const conflict = (msg) => new HttpError(409, msg);

/** Wrap async route handlers so errors reach the error middleware. */
export const ah = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

/** Validate req.body with a zod schema; returns parsed data or throws a 400 with field messages. */
export function parse(schema, data) {
  try {
    return schema.parse(data ?? {});
  } catch (err) {
    if (err instanceof ZodError) {
      const fields = {};
      for (const issue of err.issues) {
        const key = issue.path.join('.') || '_';
        if (!fields[key]) fields[key] = issue.message;
      }
      throw badRequest('Please correct the highlighted fields.', fields);
    }
    throw err;
  }
}

export function errorHandler(err, req, res, _next) {
  if (err instanceof HttpError) {
    return res.status(err.status).json({ error: err.message, ...err.extra });
  }
  if (err.code === '23505') {
    // unique violation
    if (err.constraint === 'applications_one_open_idx') {
      return res.status(409).json({ error: 'You already have an open application for this service. Open it from My Applications instead of starting a new one.' });
    }
    return res.status(409).json({ error: 'This record already exists.' });
  }
  console.error('[error]', err);
  res.status(500).json({ error: 'Something went wrong on our side. Please try again in a moment.' });
}
