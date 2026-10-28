import { useState } from 'react';
import { Play, Plus, Trash2, UserPlus, KeyRound, Pencil, Upload, CheckCircle2 } from 'lucide-react';
import { api, fmtDate, fmtDateTime, money, DISTRICTS } from '../../api.js';
import {
  Alert, Button, ErrorSummary, Input, LoadError, Loading, Modal, PageHeader, Select, Textarea, useLoad, useToast,
} from '../../components/ui.jsx';

// ---------------------------------------------------------------- overview
export function AdminOverview() {
  const { data, error, loading, reload } = useLoad(() => api.get('/admin/overview'), []);
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  if (loading) return <Loading />;
  if (error) return <LoadError error={error} onRetry={reload} />;
  const c = data.counts;
  const run = async () => {
    setBusy(true);
    try { await api.post('/admin/automation/run'); toast('Automation finished.'); reload(); } catch (e) { toast(e.message, 'error'); } finally { setBusy(false); }
  };
  const tiles = [['Citizen accounts', c.citizens], ['Verified identities', c.verified], ['Open applications', c.open_applications], ['All applications', c.applications],
    ['Active staff', c.staff], ['Register records', c.register], ['Open visit times', c.future_slots], ['Audit entries', c.audit_entries]];
  const LABELS = { slotsCreated: 'Visit times opened', visitReminders: 'Visit reminders sent', missedVisits: 'Missed visits released', draftReminders: 'Unfinished-application reminders',
    draftsCancelled: 'Old drafts cancelled', accessExpired: 'Information access expired', pensionNotices: 'Pension eligibility notices' };
  return (
    <div>
      <PageHeader title="System overview" intro="The administrator manages configuration. Citizen records are not visible from this account."
        actions={<Button icon={Play} loading={busy} onClick={run}>Run automation now</Button>} />
      <div className="tile-row tile-row-4">{tiles.map(([l, n]) => <div key={l} className="tile"><span className="tile-num">{n}</span><span className="tile-label">{l}</span></div>)}</div>
      <section className="panel">
        <h2 className="panel-title">Automation runs</h2>
        <p className="muted small">Runs every 15 minutes while the server is awake, on start-up, and when the first request arrives after a quiet period.</p>
        <div className="table-wrap">
          <table className="table">
            <caption className="sr-only">Automation runs</caption>
            <thead><tr><th>Started</th><th>Trigger</th><th>Result</th></tr></thead>
            <tbody>
              {data.jobRuns.map((r) => (
                <tr key={r.id}>
                  <td className="nowrap">{fmtDateTime(r.started_at)}</td>
                  <td>{r.trigger}</td>
                  <td className="small">{r.error ? <span className="text-error">{r.error}</span>
                    : Object.entries(r.result || {}).filter(([, v]) => v).map(([k, v]) => `${LABELS[k] || k}: ${v}`).join(', ') || 'Nothing to do'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

// ---------------------------------------------------------------- staff accounts
export function AdminStaff() {
  const { data, error, loading, reload } = useLoad(() => Promise.all([api.get('/admin/staff'), api.get('/admin/overview'), api.get('/admin/offices')]), []);
  const [form, setForm] = useState(null);
  const [err, setErr] = useState(null);
  const [secret, setSecret] = useState(null);
  const toast = useToast();
  if (loading) return <Loading />;
  if (error) return <LoadError error={error} onRetry={reload} />;
  const [{ staff }, { departments }, { offices }] = data;
  const create = async () => {
    setErr(null);
    try {
      const r = await api.post('/admin/staff', { ...form, departmentId: Number(form.departmentId) || undefined, officeId: form.officeId ? Number(form.officeId) : null });
      setForm(null); setSecret({ title: 'Account created', ...r }); reload();
    } catch (e) { setErr(e); }
  };
  const toggle = async (s) => { const r = await api.patch(`/admin/staff/${s.id}`, { isActive: !s.is_active }); toast(r.message); reload(); };
  const reset = async (s) => { const r = await api.post(`/admin/staff/${s.id}/reset-password`); setSecret({ title: `Password reset for ${s.full_name}`, ...r }); };
  return (
    <div>
      <PageHeader title="Staff accounts" intro="Each employee belongs to one department and sees only that department's work."
        actions={<Button icon={UserPlus} onClick={() => setForm({ staffNumber: '', fullName: '', email: '', role: 'officer', departmentId: '', officeId: '' })}>Add staff member</Button>} />
      <div className="table-wrap">
        <table className="table">
          <caption className="sr-only">Staff</caption>
          <thead><tr><th>Staff no.</th><th>Name</th><th>Department</th><th>Role</th><th>Office</th><th>Last sign in</th><th>Status</th><th>Actions</th></tr></thead>
          <tbody>
            {staff.map((s) => (
              <tr key={s.id}>
                <td><code>{s.staff_number}</code></td><td>{s.full_name}<br /><span className="muted small">{s.email}</span></td>
                <td>{s.department || 'All (admin)'}</td><td>{s.role}</td><td>{s.office || '-'}</td>
                <td>{s.last_login_at ? fmtDate(s.last_login_at) : 'Never'}</td>
                <td>{s.is_active ? 'Active' : 'Disabled'}{s.must_change_password && <><br /><span className="muted small">Temporary password</span></>}</td>
                <td>{s.role !== 'admin' && <div className="button-row tight">
                  <Button size="sm" variant="secondary" onClick={() => toggle(s)}>{s.is_active ? 'Disable' : 'Enable'}</Button>
                  <Button size="sm" variant="ghost" icon={KeyRound} onClick={() => reset(s)}>Reset password</Button>
                </div>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Modal open={!!form} title="Add staff member" onClose={() => setForm(null)}
        actions={<><Button variant="ghost" onClick={() => setForm(null)}>Cancel</Button><Button onClick={create}>Create account</Button></>}>
        {form && <>
          <ErrorSummary error={err} />
          <Input id="s-num" label="Staff number" value={form.staffNumber} onChange={(e) => setForm({ ...form, staffNumber: e.target.value })} error={err?.fields?.staffNumber} />
          <Input id="s-name" label="Full name" value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} error={err?.fields?.fullName} />
          <Input id="s-email" type="email" label="Work email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} error={err?.fields?.email} />
          <Select id="s-dept" label="Department" value={form.departmentId} onChange={(e) => setForm({ ...form, departmentId: e.target.value, officeId: '' })} error={err?.fields?.departmentId}>
            <option value="">Choose a department</option>{departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </Select>
          <Select id="s-office" label="Office" optional value={form.officeId} onChange={(e) => setForm({ ...form, officeId: e.target.value })}>
            <option value="">Any office in the department</option>
            {offices.filter((o) => String(o.department_id) === String(form.departmentId)).map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
          </Select>
          <Select id="s-role" label="Role" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}
            hint="Supervisors see their department's audit log. Home Affairs supervisors also approve information requests.">
            <option value="officer">Officer</option><option value="supervisor">Supervisor</option>
          </Select>
        </>}
      </Modal>
      <Modal open={!!secret} title={secret?.title} onClose={() => setSecret(null)} actions={<Button onClick={() => setSecret(null)}>Done</Button>}>
        {secret && <><p>{secret.message}</p><p className="secret"><code>{secret.temporaryPassword}</code></p><p className="muted small">This password is shown once only.</p></>}
      </Modal>
    </div>
  );
}

// ---------------------------------------------------------------- services, requirements, fees
export function AdminServices() {
  const { data, error, loading, reload } = useLoad(() => api.get('/admin/services'), []);
  const [open, setOpen] = useState(null);
  const [reqForm, setReqForm] = useState(null);
  const [feeForm, setFeeForm] = useState(null);
  const [err, setErr] = useState(null);
  const toast = useToast();
  if (loading) return <Loading />;
  if (error) return <LoadError error={error} onRetry={reload} />;
  const patch = async (s, body) => { try { const r = await api.patch(`/admin/services/${s.id}`, body); toast(r.message); reload(); } catch (e) { toast(e.message, 'error'); } };
  const patchReq = async (r, body) => { await api.patch(`/admin/requirements/${r.id}`, body); reload(); };
  const delReq = async (r) => { try { const x = await api.del(`/admin/requirements/${r.id}`); toast(x.message); reload(); } catch (e) { toast(e.message, 'error'); } };
  const saveReq = async () => {
    setErr(null);
    try { await api.post(`/admin/services/${reqForm.serviceId}/requirements`, reqForm); toast('Requirement added.'); setReqForm(null); reload(); } catch (e) { setErr(e); }
  };
  const saveFee = async () => {
    setErr(null);
    try {
      if (feeForm.id) await api.patch(`/admin/fees/${feeForm.id}`, { label: feeForm.label, amount: Number(feeForm.amount), isVerified: feeForm.isVerified });
      else await api.post(`/admin/services/${feeForm.serviceId}/fees`, { ...feeForm, amount: Number(feeForm.amount) });
      toast('Fee saved.'); setFeeForm(null); reload();
    } catch (e) { setErr(e); }
  };
  return (
    <div>
      <PageHeader title="Services and fees" intro="Requirements and fees shown to citizens come from here. Only mark an item as confirmed once it has been checked against an official source." />
      {data.services.map((s) => (
        <section key={s.id} className="panel">
          <div className="panel-head">
            <div><h2 className="panel-title">{s.name}</h2><p className="muted small">{s.department}, {s.code}, reference prefix {s.ref_prefix}</p></div>
            <Button variant="secondary" size="sm" onClick={() => setOpen(open === s.id ? null : s.id)} aria-expanded={open === s.id}>{open === s.id ? 'Close' : 'Manage'}</Button>
          </div>
          <p className="small">{s.is_active ? 'Available' : 'Hidden'}. {s.requires_appointment ? 'Office visit required.' : 'Online request.'} {s.requirements_verified ? 'Requirements confirmed.' : 'Requirements not yet confirmed.'}{s.min_age ? ` Minimum age ${s.min_age}.` : ''}</p>
          {open === s.id && (
            <div className="admin-service">
              <div className="button-row">
                <Button size="sm" variant="secondary" onClick={() => patch(s, { isActive: !s.is_active })}>{s.is_active ? 'Hide service' : 'Make available'}</Button>
                <Button size="sm" variant="secondary" onClick={() => patch(s, { requirementsVerified: !s.requirements_verified })}>{s.requirements_verified ? 'Mark requirements unconfirmed' : 'Mark requirements confirmed'}</Button>
                <Button size="sm" variant="secondary" onClick={() => patch(s, { requiresAppointment: !s.requires_appointment })}>{s.requires_appointment ? 'Make online-only' : 'Require office visit'}</Button>
              </div>
              <Input id={`age-${s.id}`} type="number" label="Minimum age" optional defaultValue={s.min_age ?? ''} hint="Leave empty for no age rule. Press Enter to save."
                onKeyDown={(e) => e.key === 'Enter' && patch(s, { minAge: e.target.value === '' ? null : Number(e.target.value) })} />
              <h3 className="sub-title">Requirements</h3>
              <div className="table-wrap"><table className="table">
                <caption className="sr-only">Requirements</caption>
                <thead><tr><th>For</th><th>Requirement</th><th>Confirmed</th><th></th></tr></thead>
                <tbody>{s.requirements.map((r) => (
                  <tr key={r.id}><td>{r.applicant_category}</td><td>{r.label}{r.is_fee && ' (fee)'}<br /><span className="muted small">{r.detail}</span></td>
                    <td><label className="check"><input type="checkbox" checked={r.is_verified} onChange={() => patchReq(r, { isVerified: !r.is_verified })} /> <span>{r.is_verified ? 'Yes' : 'No'}</span></label></td>
                    <td><button type="button" className="icon-btn" aria-label={`Remove ${r.label}`} onClick={() => delReq(r)}><Trash2 size={18} /></button></td></tr>
                ))}</tbody>
              </table></div>
              <Button size="sm" variant="secondary" icon={Plus} onClick={() => setReqForm({ serviceId: s.id, applicantCategory: 'any', label: '', detail: '', isFee: false, isVerified: false })}>Add requirement</Button>
              <h3 className="sub-title">Fees</h3>
              {s.fees.length === 0 ? <p className="muted small">No fees recorded. Do not add a fee until it is confirmed.</p> : (
                <ul className="row-list">{s.fees.map((f) => (
                  <li key={f.id} className="row"><span className="row-main"><span className="row-title">{f.label}: {money(f.amount)}</span><span className="row-sub">{f.is_verified ? 'Confirmed' : 'Not yet confirmed'}</span></span>
                    <Button size="sm" variant="ghost" icon={Pencil} onClick={() => setFeeForm({ ...f, isVerified: f.is_verified })}>Edit</Button></li>
                ))}</ul>
              )}
              <Button size="sm" variant="secondary" icon={Plus} onClick={() => setFeeForm({ serviceId: s.id, code: '', label: '', amount: '', isVerified: false })}>Add fee</Button>
            </div>
          )}
        </section>
      ))}
      <Modal open={!!reqForm} title="Add requirement" onClose={() => setReqForm(null)} actions={<><Button variant="ghost" onClick={() => setReqForm(null)}>Cancel</Button><Button onClick={saveReq}>Add</Button></>}>
        {reqForm && <>
          <ErrorSummary error={err} />
          <Select id="r-cat" label="Applies to" value={reqForm.applicantCategory} onChange={(e) => setReqForm({ ...reqForm, applicantCategory: e.target.value })}>
            <option value="any">Everyone</option><option value="adult">Adults (16 and over)</option><option value="minor">Minors (below 16)</option>
          </Select>
          <Input id="r-label" label="Requirement" value={reqForm.label} onChange={(e) => setReqForm({ ...reqForm, label: e.target.value })} error={err?.fields?.label} />
          <Input id="r-detail" label="Explanation for citizens" optional value={reqForm.detail} onChange={(e) => setReqForm({ ...reqForm, detail: e.target.value })} />
          <label className="check"><input type="checkbox" checked={reqForm.isFee} onChange={(e) => setReqForm({ ...reqForm, isFee: e.target.checked })} /> <span>This is a fee payment</span></label>
          <label className="check"><input type="checkbox" checked={reqForm.isVerified} onChange={(e) => setReqForm({ ...reqForm, isVerified: e.target.checked })} /> <span>Confirmed from an official source</span></label>
        </>}
      </Modal>
      <Modal open={!!feeForm} title={feeForm?.id ? 'Edit fee' : 'Add fee'} onClose={() => setFeeForm(null)} actions={<><Button variant="ghost" onClick={() => setFeeForm(null)}>Cancel</Button><Button onClick={saveFee}>Save fee</Button></>}>
        {feeForm && <>
          <ErrorSummary error={err} />
          {!feeForm.id && <Input id="f-code" label="Short code" hint="For example REG32" value={feeForm.code} onChange={(e) => setFeeForm({ ...feeForm, code: e.target.value })} />}
          <Input id="f-label" label="Label" value={feeForm.label} onChange={(e) => setFeeForm({ ...feeForm, label: e.target.value })} />
          <Input id="f-amt" type="number" step="0.01" label="Amount (Maloti)" value={feeForm.amount} onChange={(e) => setFeeForm({ ...feeForm, amount: e.target.value })} />
          <label className="check"><input type="checkbox" checked={feeForm.isVerified} onChange={(e) => setFeeForm({ ...feeForm, isVerified: e.target.checked })} /> <span>Confirmed against current official fees</span></label>
        </>}
      </Modal>
    </div>
  );
}

// ---------------------------------------------------------------- offices
export function AdminOffices() {
  const { data, error, loading, reload } = useLoad(() => Promise.all([api.get('/admin/offices'), api.get('/admin/overview')]), []);
  const [edit, setEdit] = useState(null);
  const [err, setErr] = useState(null);
  const [dept, setDept] = useState('');
  const toast = useToast();
  if (loading) return <Loading />;
  if (error) return <LoadError error={error} onRetry={reload} />;
  const [{ offices }, { departments }] = data;
  const list = offices.filter((o) => !dept || String(o.department_id) === dept);
  const save = async () => {
    setErr(null);
    const body = {
      name: edit.name, district: edit.district, location: edit.location, phone: edit.phone || null, hours: edit.hours,
      slotCapacity: Number(edit.slot_capacity), slotMinutes: Number(edit.slot_minutes), detailsVerified: edit.details_verified, isActive: edit.is_active,
      openTime: String(edit.open_time).slice(0, 5), closeTime: String(edit.close_time).slice(0, 5),
    };
    try {
      if (edit.id) await api.patch(`/admin/offices/${edit.id}`, body);
      else await api.post('/admin/offices', { ...body, departmentId: Number(edit.department_id) });
      toast('Office saved.'); setEdit(null); reload();
    } catch (e) { setErr(e); }
  };
  return (
    <div>
      <PageHeader title="Offices" intro="Leave the phone empty if no official number is available. Citizens see 'Contact number not available'."
        actions={<Button icon={Plus} onClick={() => setEdit({ department_id: '', name: '', district: '', location: '', phone: '', hours: 'Monday to Friday, 08:00 to 16:30', slot_capacity: 4, slot_minutes: 30, open_time: '08:00', close_time: '16:00', details_verified: false, is_active: true })}>Add office</Button>} />
      <div className="filters"><Select id="o-dept" label="Department" value={dept} onChange={(e) => setDept(e.target.value)}>
        <option value="">All departments</option>{departments.map((d) => <option key={d.id} value={d.id}>{d.short_name}</option>)}
      </Select></div>
      <div className="table-wrap">
        <table className="table">
          <caption className="sr-only">Offices</caption>
          <thead><tr><th>Office</th><th>Department</th><th>District</th><th>Phone</th><th>Capacity</th><th>Details</th><th></th></tr></thead>
          <tbody>{list.map((o) => (
            <tr key={o.id}><td>{o.name}{!o.is_active && <span className="muted small"> (closed)</span>}</td><td>{o.department}</td><td>{o.district}</td>
              <td>{o.phone || <span className="muted">Not available</span>}</td><td>{o.slot_capacity} per {o.slot_minutes} min</td>
              <td>{o.details_verified ? <CheckCircle2 size={18} aria-label="Confirmed" /> : <span className="muted small">To confirm</span>}</td>
              <td><Button size="sm" variant="ghost" icon={Pencil} onClick={() => setEdit(o)}>Edit</Button></td></tr>
          ))}</tbody>
        </table>
      </div>
      <Modal open={!!edit} title={edit?.id ? `Edit ${edit.name}` : 'Add office'} onClose={() => setEdit(null)} actions={<><Button variant="ghost" onClick={() => setEdit(null)}>Cancel</Button><Button onClick={save}>Save office</Button></>}>
        {edit && <>
          <ErrorSummary error={err} />
          {!edit.id && <Select id="e-dept" label="Department" value={edit.department_id} onChange={(e) => setEdit({ ...edit, department_id: e.target.value })}>
            <option value="">Choose</option>{departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</Select>}
          <Input id="e-name" label="Office name" value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} />
          <Select id="e-district" label="District" value={edit.district} onChange={(e) => setEdit({ ...edit, district: e.target.value })}>
            <option value="">Choose</option>{DISTRICTS.map((d) => <option key={d}>{d}</option>)}</Select>
          <Input id="e-loc" label="Location" value={edit.location} onChange={(e) => setEdit({ ...edit, location: e.target.value })} />
          <Input id="e-phone" label="Phone" optional value={edit.phone || ''} onChange={(e) => setEdit({ ...edit, phone: e.target.value })} hint="Only an official number." />
          <Input id="e-hours" label="Opening hours text" value={edit.hours} onChange={(e) => setEdit({ ...edit, hours: e.target.value })} />
          <div className="grid-2">
            <Input id="e-open" type="time" label="First visit" value={String(edit.open_time).slice(0, 5)} onChange={(e) => setEdit({ ...edit, open_time: e.target.value })} />
            <Input id="e-close" type="time" label="Visits end" value={String(edit.close_time).slice(0, 5)} onChange={(e) => setEdit({ ...edit, close_time: e.target.value })} />
            <Input id="e-min" type="number" label="Minutes per visit time" value={edit.slot_minutes} onChange={(e) => setEdit({ ...edit, slot_minutes: e.target.value })} />
            <Input id="e-cap" type="number" label="People per visit time" value={edit.slot_capacity} onChange={(e) => setEdit({ ...edit, slot_capacity: e.target.value })} />
          </div>
          <label className="check"><input type="checkbox" checked={edit.details_verified} onChange={(e) => setEdit({ ...edit, details_verified: e.target.checked })} /> <span>Details confirmed with the department</span></label>
          <label className="check"><input type="checkbox" checked={edit.is_active} onChange={(e) => setEdit({ ...edit, is_active: e.target.checked })} /> <span>Office is open for bookings</span></label>
        </>}
      </Modal>
    </div>
  );
}

// ---------------------------------------------------------------- information sharing
export function AdminSharing() {
  const { data, error, loading, reload } = useLoad(() => Promise.all([api.get('/admin/sharing'), api.get('/admin/overview')]), []);
  const [pol, setPol] = useState(null);
  const [err, setErr] = useState(null);
  const toast = useToast();
  if (loading) return <Loading />;
  if (error) return <LoadError error={error} onRetry={reload} />;
  const [{ permissions, policies, fieldLabels }, { departments }] = data;
  const fields = Object.keys(fieldLabels);
  const has = (d, f) => permissions.some((p) => p.department_id === d && p.field === f);
  const toggle = async (d, f) => {
    const current = permissions.filter((p) => p.department_id === d).map((p) => p.field);
    const next = has(d, f) ? current.filter((x) => x !== f) : [...current, f];
    await api.put(`/admin/sharing/permissions/${d}`, { fields: next }); reload();
  };
  const savePol = async () => {
    setErr(null);
    try { await api.post('/admin/sharing/policies', { ...pol, requestingDepartmentId: Number(pol.requestingDepartmentId), maxDays: Number(pol.maxDays) }); toast('Policy saved.'); setPol(null); reload(); }
    catch (e) { setErr(e); }
  };
  const delPol = async (p) => { await api.del(`/admin/sharing/policies/${p.id}`); toast('Policy removed.'); reload(); };
  return (
    <div>
      <PageHeader title="Information sharing" intro="Least privilege: each department sees only the fields ticked below. Anything else must be requested and is decided by the policies underneath." />
      <section className="panel">
        <h2 className="panel-title">Default access by department</h2>
        <div className="table-wrap">
          <table className="table matrix">
            <caption className="sr-only">Default field access</caption>
            <thead><tr><th>Field</th>{departments.map((d) => <th key={d.id}>{d.short_name}</th>)}</tr></thead>
            <tbody>{fields.map((f) => (
              <tr key={f}><th scope="row">{fieldLabels[f]}</th>
                {departments.map((d) => (
                  <td key={d.id}><input type="checkbox" checked={has(d.id, f)} onChange={() => toggle(d.id, f)} aria-label={`${d.short_name} can see ${fieldLabels[f]}`} /></td>
                ))}</tr>
            ))}</tbody>
          </table>
        </div>
      </section>
      <section className="panel">
        <div className="panel-head"><h2 className="panel-title">Request policies</h2>
          <Button size="sm" icon={Plus} onClick={() => setPol({ requestingDepartmentId: '', field: '', purpose: '', requiresConsent: true, autoApprove: false, maxDays: 14 })}>Add policy</Button></div>
        <p className="muted small">Requests for fields with no policy are refused automatically.</p>
        <div className="table-wrap"><table className="table">
          <caption className="sr-only">Policies</caption>
          <thead><tr><th>Department</th><th>Field</th><th>Purpose</th><th>Consent</th><th>Decision</th><th>Days</th><th></th></tr></thead>
          <tbody>{policies.map((p) => (
            <tr key={p.id}><td>{p.department}</td><td>{fieldLabels[p.field]}</td><td className="small">{p.purpose}</td>
              <td>{p.requires_consent ? 'Required' : 'Not required'}</td><td>{p.auto_approve ? 'Automatic' : 'Supervisor'}</td><td>{p.max_days}</td>
              <td><button type="button" className="icon-btn" aria-label="Remove policy" onClick={() => delPol(p)}><Trash2 size={18} /></button></td></tr>
          ))}</tbody>
        </table></div>
      </section>
      <Modal open={!!pol} title="Add or update a policy" onClose={() => setPol(null)} actions={<><Button variant="ghost" onClick={() => setPol(null)}>Cancel</Button><Button onClick={savePol}>Save policy</Button></>}>
        {pol && <>
          <ErrorSummary error={err} />
          <Select id="p-dept" label="Requesting department" value={pol.requestingDepartmentId} onChange={(e) => setPol({ ...pol, requestingDepartmentId: e.target.value })}>
            <option value="">Choose</option>{departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</Select>
          <Select id="p-field" label="Field" value={pol.field} onChange={(e) => setPol({ ...pol, field: e.target.value })}>
            <option value="">Choose</option>{fields.map((f) => <option key={f} value={f}>{fieldLabels[f]}</option>)}</Select>
          <Input id="p-purpose" label="Allowed purpose" value={pol.purpose} onChange={(e) => setPol({ ...pol, purpose: e.target.value })} error={err?.fields?.purpose} />
          <label className="check"><input type="checkbox" checked={pol.requiresConsent} onChange={(e) => setPol({ ...pol, requiresConsent: e.target.checked })} /> <span>Citizen must consent</span></label>
          <label className="check"><input type="checkbox" checked={pol.autoApprove} onChange={(e) => setPol({ ...pol, autoApprove: e.target.checked })} /> <span>Approve automatically (after consent, if required)</span></label>
          <Input id="p-days" type="number" label="Access lasts (days)" value={pol.maxDays} onChange={(e) => setPol({ ...pol, maxDays: e.target.value })} />
        </>}
      </Modal>
    </div>
  );
}

// ---------------------------------------------------------------- settings, holidays, register
export function AdminSettings() {
  const { data, error, loading, reload } = useLoad(() => Promise.all([api.get('/admin/settings'), api.get('/admin/holidays'), api.get('/admin/register')]), []);
  const [vals, setVals] = useState({});
  const [hol, setHol] = useState({ date: '', name: '' });
  const [csv, setCsv] = useState('');
  const [importResult, setImportResult] = useState(null);
  const [err, setErr] = useState(null);
  const toast = useToast();
  if (loading) return <Loading />;
  if (error) return <LoadError error={error} onRetry={reload} />;
  const [{ settings }, { holidays }, reg] = data;
  const saveSettings = async () => {
    try { const r = await api.patch('/admin/settings', Object.fromEntries(Object.entries(vals).map(([k, v]) => [k, Number(v)]))); toast(r.message); setVals({}); reload(); }
    catch (e) { toast(e.message, 'error'); }
  };
  const addHol = async (e) => {
    e.preventDefault(); setErr(null);
    try { const r = await api.post('/admin/holidays', hol); toast(r.message); setHol({ date: '', name: '' }); reload(); } catch (x) { setErr(x); }
  };
  const delHol = async (d) => { const r = await api.del(`/admin/holidays/${d}`); toast(r.message); reload(); };
  const doImport = async () => {
    try { const r = await api.post('/admin/register/import', { csv }); setImportResult(r); setCsv(''); reload(); } catch (x) { toast(x.message, 'error'); }
  };
  return (
    <div>
      <PageHeader title="Settings and register" />
      <section className="panel">
        <h2 className="panel-title">Automation rules</h2>
        <div className="grid-2">
          {settings.map((s) => (
            <Input key={s.key} id={`set-${s.key}`} type="number" label={s.description} value={vals[s.key] ?? s.value} onChange={(e) => setVals({ ...vals, [s.key]: e.target.value })} />
          ))}
        </div>
        <Button onClick={saveSettings} disabled={!Object.keys(vals).length}>Save settings</Button>
      </section>
      <section className="panel">
        <h2 className="panel-title">Public holidays</h2>
        <p className="muted small">No visit times are opened on these days. Check the official gazette each year, especially for dates that move such as Easter and Ascension.</p>
        <ErrorSummary error={err} />
        <form className="filters" onSubmit={addHol}>
          <Input id="h-date" type="date" label="Date" value={hol.date} onChange={(e) => setHol({ ...hol, date: e.target.value })} error={err?.fields?.date} />
          <Input id="h-name" label="Name" value={hol.name} onChange={(e) => setHol({ ...hol, name: e.target.value })} error={err?.fields?.name} />
          <Button type="submit" icon={Plus}>Add holiday</Button>
        </form>
        <ul className="row-list">{holidays.filter((h) => h.date >= new Date().toISOString().slice(0, 10)).map((h) => (
          <li key={h.date} className="row"><span className="row-main"><span className="row-title">{fmtDate(h.date)}</span><span className="row-sub">{h.name}</span></span>
            <button type="button" className="icon-btn" aria-label={`Remove ${h.name}`} onClick={() => delHol(h.date)}><Trash2 size={18} /></button></li>
        ))}</ul>
      </section>
      <section className="panel">
        <h2 className="panel-title">Population register</h2>
        <p>{reg.total} records{reg.demo ? `, of which ${reg.demo} are demonstration data` : ''}. Last import {reg.last_import ? fmtDateTime(reg.last_import) : 'never'}.</p>
        <p className="muted small">New accounts are verified automatically when the ID number, surname and date of birth match a record here.</p>
        <Textarea id="csv" label="Import records (CSV)" hint="Columns: national_id, first_name, surname, date_of_birth (YYYY-MM-DD), sex (F or M), district, life_status (optional: alive or deceased). Existing ID numbers are updated."
          value={csv} onChange={(e) => setCsv(e.target.value)} rows={6} />
        <Button icon={Upload} onClick={doImport} disabled={csv.trim().length < 10}>Import</Button>
        {importResult && <Alert tone={importResult.errors.length ? 'warning' : 'success'} title={importResult.message}>{importResult.errors.length > 0 && <ul>{importResult.errors.map((e) => <li key={e}>{e}</li>)}</ul>}</Alert>}
      </section>
    </div>
  );
}
