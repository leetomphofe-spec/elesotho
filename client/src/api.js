// Small fetch wrapper. All requests are same-origin and carry the session cookie.
export class ApiError extends Error {
  constructor(status, body) {
    super(body?.error || 'Something went wrong. Please try again.');
    this.status = status;
    this.fields = body?.fields || {};
    this.code = body?.code;
    this.body = body;
  }
}

async function request(method, path, body, { passive = false, silent = false } = {}) {
  let res;
  try {
    res = await fetch(`/api${path}`, {
      method,
      credentials: 'same-origin',
      headers: {
        'Content-Type': 'application/json',
        'X-Requested-With': 'gov-portal',
        ...(passive ? { 'X-Passive': '1' } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, { error: 'You appear to be offline. Check your connection and try again. Anything you entered is still here.' });
  }
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = { error: text }; }
  if (!res.ok) {
    const err = new ApiError(res.status, data);
    if (res.status === 401 && data?.code === 'AUTH' && !silent) window.dispatchEvent(new CustomEvent('session-ended'));
    throw err;
  }
  return data;
}

export const api = {
  get: (p, o) => request('GET', p, undefined, o),
  post: (p, b, o) => request('POST', p, b ?? {}, o),
  patch: (p, b) => request('PATCH', p, b ?? {}),
  put: (p, b) => request('PUT', p, b ?? {}),
  del: (p) => request('DELETE', p),
};

export const fmtDate = (d) => (d ? new Date(d.length === 10 ? `${d}T00:00:00` : d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '');
export const fmtDateTime = (d) => (d ? new Date(d).toLocaleString('en-GB', { timeZone: 'Africa/Maseru', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '');
export const fmtLongDay = (day) => new Date(`${day}T12:00:00`).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
export const money = (n) => `M${Number(n).toFixed(2)}`;

export const DISTRICTS = ['Maseru', 'Berea', 'Leribe', 'Butha-Buthe', 'Mokhotlong', 'Thaba-Tseka', "Qacha's Nek", 'Quthing', "Mohale's Hoek", 'Mafeteng'];
