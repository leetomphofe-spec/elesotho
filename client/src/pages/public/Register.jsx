import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Check, Eye, EyeOff } from 'lucide-react';
import { useAuth } from '../../context/AuthContext.jsx';
import { DISTRICTS } from '../../api.js';
import { Button, Input, Select, Field, ErrorSummary, PageHeader, useToast } from '../../components/ui.jsx';

const EMPTY = {
  hasNationalId: true, nationalId: '', firstName: '', surname: '', dateOfBirth: '', sex: '', phone: '', email: '',
  district: '', password: '', confirm: '', acceptTerms: false,
};

function validate(f) {
  const e = {};
  if (f.hasNationalId && !/^[A-Za-z0-9]{6,15}$/.test(f.nationalId.replace(/\s/g, ''))) e.nationalId = 'Enter your National ID number (6 to 15 letters or digits).';
  if (!f.firstName.trim()) e.firstName = 'Enter your first name.';
  if (!f.surname.trim()) e.surname = 'Enter your surname.';
  if (!f.dateOfBirth) e.dateOfBirth = 'Enter your date of birth.';
  if (!f.sex) e.sex = 'Choose female or male.';
  if (!/^(\+?266)?[256]\d{7}$/.test(f.phone.replace(/[\s-]/g, ''))) e.phone = 'Enter an 8-digit Lesotho number, for example 5800 0000.';
  if (f.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.email)) e.email = 'Enter a valid email address, like name@example.com.';
  if (!f.district) e.district = 'Choose your district.';
  if (f.password.length < 8 || !/[A-Za-z]/.test(f.password) || !/\d/.test(f.password)) e.password = 'Use at least 8 characters with a letter and a number.';
  if (f.confirm !== f.password) e.confirm = 'The two passwords do not match.';
  if (!f.acceptTerms) e.acceptTerms = 'You must agree before creating an account.';
  return e;
}

export default function Register() {
  const [f, setF] = useState(EMPTY);
  const [errors, setErrors] = useState({});
  const [summary, setSummary] = useState(null);
  const [busy, setBusy] = useState(false);
  const [show, setShow] = useState(false);
  const { register } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const set = (k) => (ev) => setF((x) => ({ ...x, [k]: ev.target.type === 'checkbox' ? ev.target.checked : ev.target.value }));

  const submit = async (ev) => {
    ev.preventDefault();
    const e = validate(f);
    setErrors(e);
    if (Object.keys(e).length) { setSummary({ message: 'Please correct the highlighted fields.', fields: e }); return; }
    setBusy(true); setSummary(null);
    try {
      const { confirm, ...data } = f;
      const c = await register({ ...data, email: data.email || null, nationalId: data.hasNationalId ? data.nationalId : null });
      toast(c.verificationStatus === 'verified' ? 'Account created and identity verified.' : 'Account created.');
      navigate('/home');
    } catch (err) {
      setErrors(err.fields || {});
      setSummary(err);
    } finally { setBusy(false); }
  };

  const pw = f.password;
  const rules = [[pw.length >= 8, 'At least 8 characters'], [/[A-Za-z]/.test(pw), 'A letter'], [/\d/.test(pw), 'A number']];

  return (
    <div className="narrow">
      <PageHeader title="Create your account" back="/" backLabel="Back to start"
        intro="One account for all government services. It takes about three minutes." />
      <ErrorSummary error={summary} />
      <form onSubmit={submit} noValidate className="form">
        <fieldset className="fieldset">
          <legend>Your identity</legend>
          <Field id="hasId" label="Do you have a Lesotho National ID card?">
            <div className="radio-row" id="hasId">
              <label className="radio-card"><input type="radio" name="hasId" checked={f.hasNationalId} onChange={() => setF({ ...f, hasNationalId: true })} /> Yes, I have one</label>
              <label className="radio-card"><input type="radio" name="hasId" checked={!f.hasNationalId} onChange={() => setF({ ...f, hasNationalId: false, nationalId: '' })} /> Not yet</label>
            </div>
          </Field>
          {f.hasNationalId ? (
            <Input id="nationalId" label="National ID number" value={f.nationalId} onChange={set('nationalId')} error={errors.nationalId}
              hint="We check this against the population register so your identity is verified straight away." autoComplete="off" required />
          ) : (
            <p className="note">You can still create an account and apply for your first National ID. Other services need a verified ID.</p>
          )}
          <div className="grid-2">
            <Input id="firstName" label="First name" value={f.firstName} onChange={set('firstName')} error={errors.firstName} autoComplete="given-name" required />
            <Input id="surname" label="Surname" value={f.surname} onChange={set('surname')} error={errors.surname} autoComplete="family-name" required />
          </div>
          <Input id="dateOfBirth" type="date" label="Date of birth" value={f.dateOfBirth} onChange={set('dateOfBirth')} error={errors.dateOfBirth}
            hint="Must match your ID card. You must be 16 or older." max={new Date().toISOString().slice(0, 10)} required />
          <Field id="sex" label="Sex" error={errors.sex}>
            <div className="radio-row" id="sex">
              <label className="radio-card"><input type="radio" name="sex" checked={f.sex === 'F'} onChange={() => setF({ ...f, sex: 'F' })} /> Female</label>
              <label className="radio-card"><input type="radio" name="sex" checked={f.sex === 'M'} onChange={() => setF({ ...f, sex: 'M' })} /> Male</label>
            </div>
          </Field>
        </fieldset>

        <fieldset className="fieldset">
          <legend>How we contact you</legend>
          <Input id="phone" type="tel" inputMode="tel" label="Mobile phone number" value={f.phone} onChange={set('phone')} error={errors.phone}
            hint="You can log in with this number." autoComplete="tel" required />
          <Input id="email" type="email" label="Email address" optional value={f.email} onChange={set('email')} error={errors.email}
            hint="Useful for password resets and updates, but not required." autoComplete="email" />
          <Select id="district" label="District you live in" value={f.district} onChange={set('district')} error={errors.district} required>
            <option value="">Choose a district</option>
            {DISTRICTS.map((d) => <option key={d}>{d}</option>)}
          </Select>
        </fieldset>

        <fieldset className="fieldset">
          <legend>Choose a password</legend>
          <Input id="password" type={show ? 'text' : 'password'} label="Password" value={f.password} onChange={set('password')}
            error={errors.password} autoComplete="new-password" required />
          <ul className="rules" aria-label="Password rules">
            {rules.map(([okRule, label]) => <li key={label} className={okRule ? 'rule-ok' : ''}><Check size={16} aria-hidden /> {label}</li>)}
          </ul>
          <Input id="confirm" type={show ? 'text' : 'password'} label="Type the password again" value={f.confirm} onChange={set('confirm')}
            error={errors.confirm} autoComplete="new-password" required />
          <button type="button" className="link-btn" onClick={() => setShow(!show)}>
            {show ? <EyeOff size={16} aria-hidden /> : <Eye size={16} aria-hidden />} {show ? 'Hide passwords' : 'Show passwords'}
          </button>
        </fieldset>

        <Field id="acceptTerms" label="" error={errors.acceptTerms}>
          <label className="check">
            <input id="acceptTerms" type="checkbox" checked={f.acceptTerms} onChange={set('acceptTerms')} />
            <span>I confirm these details are mine and true. I understand Home Affairs keeps my identity record and other departments
              can only see the parts they need, with my consent where the law requires it.</span>
          </label>
        </Field>
        <div className="form-actions">
          <Button type="submit" size="lg" loading={busy}>Create account</Button>
          <p>Already registered? <Link to="/login">Log in</Link></p>
        </div>
      </form>
    </div>
  );
}
