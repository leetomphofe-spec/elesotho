import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Eye, Lock, Pencil } from 'lucide-react';
import { api, fmtDate, DISTRICTS } from '../../api.js';
import { useAuth } from '../../context/AuthContext.jsx';
import {
  Alert, Button, DefinitionList, ErrorSummary, Input, LoadError, Loading, Modal, PageHeader, Select, StatusBadge, useLoad, useToast,
} from '../../components/ui.jsx';

export default function Profile() {
  const { data, error, loading, reload, setData } = useLoad(() => api.get('/citizen/profile'), []);
  const { setCitizen } = useAuth();
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState(null);
  const [formError, setFormError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [reveal, setReveal] = useState({ open: false, password: '', error: null, id: null });
  const [pw, setPw] = useState({ open: false, currentPassword: '', newPassword: '', error: null });
  const toast = useToast();

  if (loading) return <Loading />;
  if (error) return <LoadError error={error} onRetry={reload} />;
  const c = data.citizen;

  const startEdit = () => { setForm({ phone: c.phone, email: c.email || '', address: c.address || '', district: c.district || '' }); setEditing(true); setFormError(null); };
  const save = async (ev) => {
    ev.preventDefault();
    setBusy(true); setFormError(null);
    try {
      const r = await api.patch('/citizen/profile', { ...form, email: form.email || null });
      setData({ citizen: r.citizen }); setCitizen(r.citizen); setEditing(false); toast(r.message);
    } catch (err) { setFormError(err); } finally { setBusy(false); }
  };
  const doReveal = async () => {
    try {
      const r = await api.post('/citizen/reveal-id', { password: reveal.password });
      setReveal({ open: false, password: '', error: null, id: r.nationalId });
      setTimeout(() => setReveal((x) => ({ ...x, id: null })), 30000);
    } catch (err) { setReveal((x) => ({ ...x, error: err.fields?.password || err.message })); }
  };
  const changePw = async () => {
    try {
      const r = await api.post('/citizen/change-password', { currentPassword: pw.currentPassword, newPassword: pw.newPassword });
      setPw({ open: false, currentPassword: '', newPassword: '', error: null }); toast(r.message);
    } catch (err) { setPw((x) => ({ ...x, error: Object.values(err.fields || {})[0] || err.message })); }
  };

  return (
    <div className="narrow-wide">
      <PageHeader title="Your profile" back="/home" backLabel="Home"
        intro="This is your single citizen record. Departments use it instead of asking you for the same details again." />

      <section className="panel">
        <div className="panel-head">
          <h2 className="panel-title">Identity</h2>
          <StatusBadge status={c.verificationStatus} />
        </div>
        {c.verificationStatus !== 'verified' && <Alert tone="warning" title="What to do next">{c.verificationNote}</Alert>}
        <DefinitionList items={[
          ['Full name', `${c.firstName} ${c.surname}`],
          ['National ID number', c.hasNationalId ? (
            <span className="id-reveal">
              <code>{reveal.id || c.nationalIdMasked}</code>
              {!reveal.id && <button type="button" className="link-btn" onClick={() => setReveal({ ...reveal, open: true })}><Eye size={16} aria-hidden /> Show full number</button>}
            </span>
          ) : 'No National ID on record'],
          ['Date of birth', fmtDate(c.dateOfBirth)],
          ['Sex', c.sex === 'F' ? 'Female' : c.sex === 'M' ? 'Male' : null],
          ['Verification', c.verificationStatus === 'verified' ? `Verified ${c.verifiedAt ? fmtDate(c.verifiedAt) : ''}` : 'Not verified'],
        ]} />
        <p className="muted small"><Lock size={14} aria-hidden /> Name, date of birth and ID number come from the Home Affairs register. To correct them, visit a Home Affairs office with your ID card.</p>
      </section>

      <section className="panel">
        <div className="panel-head">
          <h2 className="panel-title">Contact details</h2>
          {!editing && <Button variant="secondary" size="sm" icon={Pencil} onClick={startEdit}>Edit contact details</Button>}
        </div>
        {editing ? (
          <form onSubmit={save} noValidate className="form">
            <ErrorSummary error={formError} />
            <Input id="phone" type="tel" label="Mobile phone number" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} error={formError?.fields?.phone} />
            <Input id="email" type="email" label="Email address" optional value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} error={formError?.fields?.email} />
            <Input id="address" label="Home address" optional hint="Village or street, and town" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} error={formError?.fields?.address} />
            <Select id="district" label="District" value={form.district} onChange={(e) => setForm({ ...form, district: e.target.value })} error={formError?.fields?.district}>
              <option value="">Choose a district</option>
              {DISTRICTS.map((d) => <option key={d}>{d}</option>)}
            </Select>
            <div className="form-actions">
              <Button type="submit" loading={busy}>Save changes</Button>
              <Button type="button" variant="ghost" onClick={() => setEditing(false)}>Cancel</Button>
            </div>
          </form>
        ) : (
          <DefinitionList items={[['Phone', c.phone], ['Email', c.email], ['Address', c.address], ['District', c.district]]} />
        )}
      </section>

      <section className="panel">
        <h2 className="panel-title">Security and privacy</h2>
        <div className="button-row">
          <Button variant="secondary" onClick={() => setPw({ ...pw, open: true })}>Change password</Button>
          <Link to="/privacy" className="btn btn-secondary">Who can see my information</Link>
        </div>
      </section>

      <Modal open={reveal.open} title="Confirm it is you" onClose={() => setReveal({ open: false, password: '', error: null, id: null })}
        actions={<><Button variant="ghost" onClick={() => setReveal({ open: false, password: '', error: null, id: null })}>Cancel</Button><Button onClick={doReveal}>Show number</Button></>}>
        <p>Enter your password to show your full ID number. It hides again after 30 seconds.</p>
        <Input id="reveal-pw" type="password" label="Password" value={reveal.password} error={reveal.error}
          onChange={(e) => setReveal({ ...reveal, password: e.target.value })} onKeyDown={(e) => e.key === 'Enter' && doReveal()} />
      </Modal>
      <Modal open={pw.open} title="Change password" onClose={() => setPw({ open: false, currentPassword: '', newPassword: '', error: null })}
        actions={<><Button variant="ghost" onClick={() => setPw({ open: false, currentPassword: '', newPassword: '', error: null })}>Cancel</Button><Button onClick={changePw}>Save password</Button></>}>
        {pw.error && <Alert tone="error">{pw.error}</Alert>}
        <Input id="cur-pw" type="password" label="Current password" value={pw.currentPassword} onChange={(e) => setPw({ ...pw, currentPassword: e.target.value })} />
        <Input id="new-pw" type="password" label="New password" hint="At least 8 characters with a letter and a number." value={pw.newPassword} onChange={(e) => setPw({ ...pw, newPassword: e.target.value })} />
      </Modal>
    </div>
  );
}
