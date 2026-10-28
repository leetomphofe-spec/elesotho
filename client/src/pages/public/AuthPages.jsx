import { useState } from 'react';
import { Link, Navigate, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { ShieldCheck } from 'lucide-react';
import { useAuth } from '../../context/AuthContext.jsx';
import { api } from '../../api.js';
import { Alert, Button, ErrorSummary, Input, PageHeader, useToast } from '../../components/ui.jsx';

export function Login() {
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState({});
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const { loginCitizen, citizen, endedReason } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  if (citizen) return <Navigate to="/home" replace />;

  const submit = async (ev) => {
    ev.preventDefault();
    const e = {};
    if (!identifier.trim()) e.identifier = 'Enter your ID number, phone number or email.';
    if (!password) e.password = 'Enter your password.';
    setErrors(e);
    if (Object.keys(e).length) return;
    setBusy(true); setError(null);
    try {
      await loginCitizen(identifier, password);
      navigate(location.state?.from || '/home', { replace: true });
    } catch (err) { setError(err); setErrors(err.fields || {}); } finally { setBusy(false); }
  };

  return (
    <div className="narrow">
      <PageHeader title="Log in" back="/" backLabel="Back to start" />
      {endedReason && <Alert tone="info">{endedReason}</Alert>}
      <ErrorSummary error={error} />
      <form onSubmit={submit} noValidate className="form">
        <Input id="identifier" label="National ID number, phone number or email" value={identifier}
          onChange={(e) => setIdentifier(e.target.value)} error={errors.identifier} autoComplete="username" required />
        <Input id="password" type="password" label="Password" value={password} onChange={(e) => setPassword(e.target.value)}
          error={errors.password} autoComplete="current-password" required />
        <div className="form-actions">
          <Button type="submit" size="lg" loading={busy}>Log in</Button>
          <Link to="/forgot-password">Forgot your password?</Link>
        </div>
        <p className="muted">New here? <Link to="/register">Create an account</Link></p>
      </form>
    </div>
  );
}

export function ForgotPassword() {
  const [identifier, setIdentifier] = useState('');
  const [error, setError] = useState(null);
  const [fieldError, setFieldError] = useState(null);
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const submit = async (ev) => {
    ev.preventDefault();
    if (!identifier.trim()) { setFieldError('Enter your ID number, phone number or email.'); return; }
    setBusy(true); setError(null); setFieldError(null);
    try { setResult(await api.post('/auth/forgot-password', { identifier })); } catch (err) { setError(err); } finally { setBusy(false); }
  };
  return (
    <div className="narrow">
      <PageHeader title="Reset your password" back="/login" backLabel="Back to log in"
        intro="Enter the ID number, phone number or email you use to log in." />
      <ErrorSummary error={error} />
      {result ? (
        <>
          <Alert tone="success" title="Check your email">{result.message}</Alert>
          {result.demoResetLink && (
            <Alert tone="warning" title="Demonstration mode">
              Email is not set up on this deployment, so the reset link is shown here: <Link to={result.demoResetLink}>Open reset link</Link>
            </Alert>
          )}
          <Link to="/login" className="btn btn-secondary">Back to log in</Link>
        </>
      ) : (
        <form onSubmit={submit} noValidate className="form">
          <Input id="identifier" label="ID number, phone number or email" value={identifier} onChange={(e) => setIdentifier(e.target.value)} error={fieldError} required />
          <div className="form-actions"><Button type="submit" loading={busy}>Send reset instructions</Button></div>
        </form>
      )}
    </div>
  );
}

export function ResetPassword() {
  const [params] = useSearchParams();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [errors, setErrors] = useState({});
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const navigate = useNavigate();
  const token = params.get('token');
  const submit = async (ev) => {
    ev.preventDefault();
    const e = {};
    if (password.length < 8 || !/[A-Za-z]/.test(password) || !/\d/.test(password)) e.password = 'Use at least 8 characters with a letter and a number.';
    if (confirm !== password) e.confirm = 'The two passwords do not match.';
    setErrors(e);
    if (Object.keys(e).length) return;
    setBusy(true); setError(null);
    try {
      const r = await api.post('/auth/reset-password', { token, password });
      toast(r.message);
      navigate('/login');
    } catch (err) { setError(err); } finally { setBusy(false); }
  };
  if (!token) return <div className="narrow"><Alert tone="error" title="This reset link is not complete">Ask for a new link from the log in page.</Alert></div>;
  return (
    <div className="narrow">
      <PageHeader title="Choose a new password" />
      <ErrorSummary error={error} />
      <form onSubmit={submit} noValidate className="form">
        <Input id="password" type="password" label="New password" hint="At least 8 characters with a letter and a number."
          value={password} onChange={(e) => setPassword(e.target.value)} error={errors.password} autoComplete="new-password" />
        <Input id="confirm" type="password" label="Type it again" value={confirm} onChange={(e) => setConfirm(e.target.value)} error={errors.confirm} autoComplete="new-password" />
        <div className="form-actions"><Button type="submit" loading={busy}>Save new password</Button></div>
      </form>
    </div>
  );
}

export function StaffLogin() {
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  const { loginStaff, staff, endedReason } = useAuth();
  const navigate = useNavigate();
  if (staff) return <Navigate to={staff.role === 'admin' ? '/staff/admin' : '/staff'} replace />;
  const submit = async (ev) => {
    ev.preventDefault();
    const e = {};
    if (!identifier.trim()) e.identifier = 'Enter your staff number or work email.';
    if (!password) e.password = 'Enter your password.';
    setErrors(e);
    if (Object.keys(e).length) return;
    setBusy(true); setError(null);
    try {
      const s = await loginStaff(identifier, password);
      navigate(s.mustChangePassword ? '/staff/password' : s.role === 'admin' ? '/staff/admin' : '/staff', { replace: true });
    } catch (err) { setError(err); } finally { setBusy(false); }
  };
  return (
    <div className="narrow">
      <PageHeader title="Staff sign in" back="/" backLabel="Back to citizen site"
        intro="For authorised government employees only. Every action you take is recorded in the audit log." />
      {endedReason && <Alert tone="info">{endedReason}</Alert>}
      <ErrorSummary error={error} />
      <form onSubmit={submit} noValidate className="form form-staff">
        <Input id="identifier" label="Staff number or work email" value={identifier} onChange={(e) => setIdentifier(e.target.value)} error={errors.identifier} autoComplete="username" />
        <Input id="password" type="password" label="Password" value={password} onChange={(e) => setPassword(e.target.value)} error={errors.password} autoComplete="current-password" />
        <div className="form-actions"><Button type="submit" icon={ShieldCheck} loading={busy}>Sign in</Button></div>
        <p className="muted small">Forgotten your password? Ask the system administrator to reset it. You will be signed out after 15 minutes without activity.</p>
      </form>
    </div>
  );
}
