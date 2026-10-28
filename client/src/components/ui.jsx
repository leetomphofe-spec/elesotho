import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  AlertTriangle, CheckCircle2, Info, XCircle, Loader2, ArrowLeft, FileEdit, FolderOpen, CalendarCheck2,
  Send, Search, MessageSquareWarning, BadgeCheck, Ban, X, CircleSlash,
} from 'lucide-react';

// ---------------------------------------------------------------- buttons
export function Button({ variant = 'primary', size, icon: Icon, loading, children, className = '', ...rest }) {
  return (
    <button
      className={`btn btn-${variant}${size ? ` btn-${size}` : ''} ${className}`}
      disabled={loading || rest.disabled}
      aria-busy={loading ? 'true' : undefined}
      {...rest}
    >
      {loading ? <Loader2 className="spin" size={18} aria-hidden /> : Icon ? <Icon size={18} aria-hidden /> : null}
      <span>{children}</span>
    </button>
  );
}

export function LinkButton({ to, variant = 'primary', size, icon: Icon, children, className = '', ...rest }) {
  return (
    <Link to={to} className={`btn btn-${variant}${size ? ` btn-${size}` : ''} ${className}`} {...rest}>
      {Icon ? <Icon size={18} aria-hidden /> : null}
      <span>{children}</span>
    </Link>
  );
}

// ---------------------------------------------------------------- form fields
export function Field({ id, label, hint, error, required, children, optional }) {
  return (
    <div className={`field${error ? ' has-error' : ''}`}>
      <label htmlFor={id} className="field-label">
        {label}
        {optional && <span className="field-optional"> (optional)</span>}
        {required && <span className="sr-only"> (required)</span>}
      </label>
      {hint && <p className="field-hint" id={`${id}-hint`}>{hint}</p>}
      {error && (
        <p className="field-error" id={`${id}-error`} role="alert">
          <XCircle size={16} aria-hidden /> {error}
        </p>
      )}
      {children}
    </div>
  );
}

const describedBy = (id, hint, error) => [hint && `${id}-hint`, error && `${id}-error`].filter(Boolean).join(' ') || undefined;

export function Input({ id, label, hint, error, required, optional, className = '', ...rest }) {
  return (
    <Field id={id} label={label} hint={hint} error={error} required={required} optional={optional}>
      <input id={id} className={`input ${className}`} aria-invalid={error ? 'true' : undefined}
        aria-describedby={describedBy(id, hint, error)} required={required} {...rest} />
    </Field>
  );
}

export function Select({ id, label, hint, error, required, optional, children, ...rest }) {
  return (
    <Field id={id} label={label} hint={hint} error={error} required={required} optional={optional}>
      <select id={id} className="input" aria-invalid={error ? 'true' : undefined}
        aria-describedby={describedBy(id, hint, error)} required={required} {...rest}>
        {children}
      </select>
    </Field>
  );
}

export function Textarea({ id, label, hint, error, required, optional, ...rest }) {
  return (
    <Field id={id} label={label} hint={hint} error={error} required={required} optional={optional}>
      <textarea id={id} className="input" rows={4} aria-invalid={error ? 'true' : undefined}
        aria-describedby={describedBy(id, hint, error)} required={required} {...rest} />
    </Field>
  );
}

export function ErrorSummary({ error }) {
  const ref = useRef(null);
  useEffect(() => { if (error) ref.current?.focus(); }, [error]);
  if (!error) return null;
  const fields = Object.values(error.fields || {});
  return (
    <div className="alert alert-error" role="alert" tabIndex={-1} ref={ref}>
      <XCircle size={22} aria-hidden className="alert-icon" />
      <div>
        <p className="alert-title">{error.message}</p>
        {fields.length > 1 && <ul className="alert-list">{fields.map((f) => <li key={f}>{f}</li>)}</ul>}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- feedback
const ALERT_ICONS = { info: Info, success: CheckCircle2, warning: AlertTriangle, error: XCircle };
export function Alert({ tone = 'info', title, children, action }) {
  const Icon = ALERT_ICONS[tone];
  return (
    <div className={`alert alert-${tone}`} role={tone === 'error' ? 'alert' : 'status'}>
      <Icon size={22} aria-hidden className="alert-icon" />
      <div className="alert-body">
        {title && <p className="alert-title">{title}</p>}
        {children && <div className="alert-text">{children}</div>}
        {action && <div className="alert-action">{action}</div>}
      </div>
    </div>
  );
}

const STATUS_META = {
  draft: { icon: FileEdit, tone: 'neutral' },
  preparing_documents: { icon: FolderOpen, tone: 'neutral' },
  ready_for_visit: { icon: CalendarCheck2, tone: 'info' },
  submitted: { icon: Send, tone: 'info' },
  under_review: { icon: Search, tone: 'info' },
  additional_info_required: { icon: MessageSquareWarning, tone: 'warning' },
  completed: { icon: BadgeCheck, tone: 'success' },
  rejected: { icon: Ban, tone: 'error' },
  cancelled: { icon: CircleSlash, tone: 'muted' },
  // access requests
  pending_consent: { icon: MessageSquareWarning, tone: 'warning' },
  pending_approval: { icon: Search, tone: 'info' },
  approved: { icon: BadgeCheck, tone: 'success' },
  denied: { icon: Ban, tone: 'error' },
  expired: { icon: CircleSlash, tone: 'muted' },
  revoked: { icon: CircleSlash, tone: 'muted' },
  verified: { icon: BadgeCheck, tone: 'success' },
  pending_office: { icon: MessageSquareWarning, tone: 'warning' },
  unverified: { icon: CircleSlash, tone: 'muted' },
};
export const STATUS_TEXT = {
  draft: 'Draft', preparing_documents: 'Preparing documents', ready_for_visit: 'Ready for office visit', submitted: 'Submitted',
  under_review: 'Under review', additional_info_required: 'Additional information required', completed: 'Completed',
  rejected: 'Rejected', cancelled: 'Cancelled', pending_consent: 'Waiting for citizen consent', pending_approval: 'Waiting for approval',
  approved: 'Approved', denied: 'Denied', expired: 'Expired', revoked: 'Withdrawn', verified: 'Verified',
  pending_office: 'Office visit needed', unverified: 'Not verified',
};

export function StatusBadge({ status, label }) {
  const m = STATUS_META[status] || { icon: Info, tone: 'neutral' };
  const Icon = m.icon;
  return (
    <span className={`badge badge-${m.tone}`}>
      <Icon size={15} aria-hidden /> {label || STATUS_TEXT[status] || status}
    </span>
  );
}

export function Loading({ label = 'Loading' }) {
  return (
    <div className="loading" role="status">
      <Loader2 className="spin" size={28} aria-hidden />
      <span>{label}…</span>
    </div>
  );
}

export function Empty({ icon: Icon = FolderOpen, title, children, action }) {
  return (
    <div className="empty">
      <Icon size={36} aria-hidden />
      <p className="empty-title">{title}</p>
      {children && <div className="empty-text">{children}</div>}
      {action && <div className="empty-action">{action}</div>}
    </div>
  );
}

export function LoadError({ error, onRetry }) {
  return (
    <Alert tone="error" title="This page could not load" action={onRetry && <Button variant="secondary" onClick={onRetry}>Try again</Button>}>
      {error?.message}
    </Alert>
  );
}

export function ProgressBar({ done, total, label }) {
  const pct = total ? Math.round((done / total) * 100) : 0;
  return (
    <div className="progress">
      <div className="progress-head">
        <span className="progress-label">{label ?? `${done} of ${total} documents confirmed`}</span>
        <span className="progress-pct">{pct}%</span>
      </div>
      <div className="progress-track" role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={done} aria-label={label ?? `${done} of ${total} documents confirmed`}>
        <div className="progress-fill" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

export function Stepper({ steps, current, onStep }) {
  return (
    <ol className="stepper" aria-label="Application steps">
      {steps.map((s, i) => {
        const state = i < current ? 'done' : i === current ? 'current' : 'todo';
        const canJump = onStep && i < current;
        return (
          <li key={s} className={`step step-${state}`} aria-current={state === 'current' ? 'step' : undefined}>
            {canJump ? (
              <button type="button" className="step-btn" onClick={() => onStep(i)}>
                <span className="step-num">{i + 1}</span><span className="step-name">{s}</span>
              </button>
            ) : (
              <span className="step-btn"><span className="step-num">{i + 1}</span><span className="step-name">{s}</span></span>
            )}
          </li>
        );
      })}
    </ol>
  );
}

export function PageHeader({ title, intro, back, backLabel = 'Back', actions }) {
  return (
    <header className="page-header">
      {back && (
        <Link to={back} className="back-link"><ArrowLeft size={18} aria-hidden /> {backLabel}</Link>
      )}
      <div className="page-header-row">
        <div>
          <h1 className="page-title">{title}</h1>
          {intro && <p className="page-intro">{intro}</p>}
        </div>
        {actions && <div className="page-actions">{actions}</div>}
      </div>
    </header>
  );
}

// ---------------------------------------------------------------- dialogs
export function Modal({ open, title, onClose, children, actions, tone }) {
  const ref = useRef(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog ref={ref} className={`modal${tone ? ` modal-${tone}` : ''}`} onClose={onClose} onCancel={onClose} aria-labelledby="modal-title">
      {open && (
        <div className="modal-inner">
          <div className="modal-head">
            <h2 id="modal-title">{title}</h2>
            <button type="button" className="icon-btn" onClick={onClose} aria-label="Close"><X size={20} /></button>
          </div>
          <div className="modal-body">{children}</div>
          {actions && <div className="modal-actions">{actions}</div>}
        </div>
      )}
    </dialog>
  );
}

// ---------------------------------------------------------------- toasts
const ToastContext = createContext(() => {});
export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const push = useCallback((message, tone = 'success') => {
    const id = Math.random().toString(36).slice(2);
    setToasts((t) => [...t, { id, message, tone }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 6000);
  }, []);
  return (
    <ToastContext.Provider value={push}>
      {children}
      <div className="toasts" aria-live="polite" aria-atomic="false">
        {toasts.map((t) => {
          const Icon = ALERT_ICONS[t.tone] || Info;
          return (
            <div key={t.id} className={`toast toast-${t.tone}`}>
              <Icon size={20} aria-hidden /> <span>{t.message}</span>
              <button className="icon-btn" aria-label="Dismiss" onClick={() => setToasts((x) => x.filter((y) => y.id !== t.id))}><X size={16} /></button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}
export const useToast = () => useContext(ToastContext);

// ---------------------------------------------------------------- data loading
export function useLoad(fn, deps = []) {
  const [state, setState] = useState({ data: null, error: null, loading: true });
  const run = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const data = await fn();
      setState({ data, error: null, loading: false });
    } catch (error) {
      setState({ data: null, error, loading: false });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useEffect(() => { run(); }, [run]);
  return { ...state, reload: run, setData: (d) => setState((s) => ({ ...s, data: typeof d === 'function' ? d(s.data) : d })) };
}

export function DefinitionList({ items }) {
  return (
    <dl className="deflist">
      {items.filter(Boolean).map(([k, v]) => (
        <div key={k} className="deflist-row"><dt>{k}</dt><dd>{v ?? <span className="muted">Not provided</span>}</dd></div>
      ))}
    </dl>
  );
}
