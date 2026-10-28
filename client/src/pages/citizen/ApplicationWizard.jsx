import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft, ArrowRight, Save, Zap, CheckCircle2, CalendarCheck2, Plus, Trash2, Banknote, FileText, UserRound, Baby } from 'lucide-react';
import { api, fmtLongDay, money, fmtDate } from '../../api.js';
import { useAuth } from '../../context/AuthContext.jsx';
import {
  Alert, Button, DefinitionList, ErrorSummary, Input, LinkButton, LoadError, Loading, Modal, PageHeader, ProgressBar, Select, Stepper, useLoad, useToast,
} from '../../components/ui.jsx';
import { OfficeFinder, UnverifiedNote, FeeTable } from './Services.jsx';

const PASSPORT_TYPES = ['Regular passport, 32 pages', 'Regular passport, 64 pages', 'Other or not sure'];

export default function ApplicationWizard({ serviceCode: fixedCode }) {
  const params = useParams();
  const code = fixedCode || params.code;
  const [search] = useSearchParams();
  const resumeId = search.get('app');
  const { citizen } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();

  const { data, error, loading, reload } = useLoad(async () => {
    const svc = await api.get(`/catalogue/services/${code}`);
    const app = resumeId ? await api.get(`/applications/${resumeId}`) : null;
    const history = code === 'PASSPORT_REPLACE' ? await api.get('/citizen/previous-passports') : { records: [] };
    return { svc, app, history: history.records };
  }, [code, resumeId]);

  const [step, setStep] = useState(0);
  const [category, setCategory] = useState(search.get('for') === 'minor' ? 'minor' : 'adult');
  const [minor, setMinor] = useState({ firstName: '', surname: '', dateOfBirth: '', birthCertificateNo: '', relationship: '' });
  const [appId, setAppId] = useState(resumeId);
  const [reference, setReference] = useState(null);
  const [checklist, setChecklist] = useState({});
  const [feeId, setFeeId] = useState(null);
  const [office, setOffice] = useState(null);
  const [slot, setSlot] = useState(null);
  const [history, setHistory] = useState([]);
  const [errors, setErrors] = useState({});
  const [summary, setSummary] = useState(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(null);
  const [done, setDone] = useState(null);
  const [cancelOpen, setCancelOpen] = useState(false);
  const initialised = useRef(false);

  // Load an existing draft into the wizard
  useEffect(() => {
    if (!data || initialised.current) return;
    initialised.current = true;
    setHistory(data.history);
    if (data.app) {
      const a = data.app;
      if (a.actions.isFinal || a.application.status === 'ready_for_visit' || !a.actions.canEdit) {
        navigate(`/applications/${a.application.id}`, { replace: true });
        return;
      }
      setCategory(a.application.category);
      if (a.application.applicant?.firstName) setMinor((m) => ({ ...m, ...a.application.applicant }));
      setReference(a.application.reference);
      setChecklist(a.application.checklist || {});
      setFeeId(a.application.feeId);
      if (a.office) setOffice(a.office);
      if (a.proposedSlot) setSlot({ id: a.proposedSlot.id, day: a.proposedSlot.day, time: a.proposedSlot.time });
    } else if (search.get('office')) {
      api.get(`/catalogue/offices?department=${data.svc.service.department.code}`).then((r) => {
        const o = r.offices.find((x) => String(x.id) === search.get('office'));
        if (o) setOffice(o);
      });
    }
  }, [data, navigate, search]);

  const svc = data?.svc.service;
  const reqs = data ? data.svc.requirements[category] : [];
  const fees = data?.svc.fees || [];
  const needsFee = reqs.some((r) => r.is_fee) && fees.length > 0;
  const isReplace = code === 'PASSPORT_REPLACE';
  const steps = useMemo(() => {
    if (!svc) return [];
    const s = ['Applicant', 'Documents'];
    if (svc.requiresAppointment) s.push('Office', 'Visit time');
    s.push('Review');
    return s;
  }, [svc]);

  // When resuming, jump to the first unfinished step
  useEffect(() => {
    if (!data?.app || !svc) return;
    const done_ = reqs.length > 0 && reqs.every((r) => checklist[r.id]);
    if (!done_ || (needsFee && !feeId)) setStep(1);
    else if (svc.requiresAppointment && !office) setStep(2);
    else if (svc.requiresAppointment && !slot) setStep(3);
    else setStep(steps.length - 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data?.app, svc]);

  if (loading) return <Loading />;
  if (error) return <LoadError error={error} onRetry={reload} />;

  const doneCount = reqs.filter((r) => checklist[r.id]).length;
  const complete = reqs.length > 0 && doneCount === reqs.length;
  const fee = fees.find((f) => f.id === feeId);
  const back = svc.department.code === 'PASSPORT' ? '/passport' : `/service/${code}`;
  const stepName = steps[step];
  const blockedNoId = svc.requiresNationalId && !citizen.hasNationalId;

  const save = async (patch, { quiet = true } = {}) => {
    if (!appId) return;
    try {
      const r = await api.patch(`/applications/${appId}`, patch);
      setSaved(new Date());
      if (!quiet) toast('Draft saved. You can continue later from My applications.');
      return r;
    } catch (err) { toast(err.message, 'error'); return null; }
  };

  const toggleReq = (id) => {
    const next = { ...checklist, [id]: !checklist[id] };
    setChecklist(next);
    save({ checklist: next });
  };

  const next = async () => {
    setSummary(null); setErrors({});
    if (stepName === 'Applicant') {
      if (blockedNoId) return;
      if (category === 'minor') {
        const e = {};
        if (!minor.firstName.trim()) e['minor.firstName'] = "Enter the child's first name.";
        if (!minor.surname.trim()) e['minor.surname'] = "Enter the child's surname.";
        if (!minor.dateOfBirth) e['minor.dateOfBirth'] = "Enter the child's date of birth.";
        if (minor.birthCertificateNo.trim().length < 3) e['minor.birthCertificateNo'] = 'Enter the birth certificate number.';
        if (!minor.relationship) e['minor.relationship'] = 'Choose parent or legal guardian.';
        if (Object.keys(e).length && !appId) { setErrors(e); setSummary({ message: 'Please correct the highlighted fields.', fields: e }); return; }
      }
      if (!reqs.length) return;
      if (!appId) {
        setBusy(true);
        try {
          const r = await api.post('/applications', { serviceCode: code, category, ...(category === 'minor' ? { minor } : {}) });
          setAppId(r.application.id); setReference(r.application.reference);
          await api.patch(`/applications/${r.application.id}`, {
            requirementsReviewed: true, ...(office ? { officeId: office.id } : {}),
          });
          setSaved(new Date());
        } catch (err) { setErrors(err.fields || {}); setSummary(err); setBusy(false); return; }
        setBusy(false);
      }
    }
    if (stepName === 'Documents') {
      if (!complete) { setSummary({ message: `Confirm every document before you continue. ${doneCount} of ${reqs.length} confirmed.` }); return; }
      if (needsFee && !feeId) { setErrors({ fee: 'Choose a passport type so we can show the fee.' }); setSummary({ message: 'Choose a passport type so we can show the fee.' }); return; }
    }
    if (stepName === 'Office' && !office) { setSummary({ message: 'Select an office before you continue.' }); return; }
    if (stepName === 'Visit time' && !slot) { setSummary({ message: 'Choose a date and time for your visit.' }); return; }
    setStep((s) => Math.min(s + 1, steps.length - 1));
  };

  const confirm = async () => {
    setBusy(true); setSummary(null);
    try {
      const r = await api.post(`/applications/${appId}/confirm`, slot ? { slotId: slot.id } : {});
      setDone({ reference: r.reference, status: r.statusLabel });
    } catch (err) {
      setSummary(err);
      if (err.status === 409) { setSlot(null); setStep(steps.indexOf('Visit time')); }
    } finally { setBusy(false); }
  };

  const cancelApp = async () => {
    if (appId) await api.post(`/applications/${appId}/cancel`, { reason: 'Stopped before confirming' }).catch(() => {});
    toast(appId ? 'Application cancelled. Nothing was booked.' : 'Nothing was saved.');
    navigate(back);
  };

  if (done) {
    return (
      <div className="narrow">
        <div className="success-panel">
          <CheckCircle2 size={48} aria-hidden className="success-icon" />
          <h1 className="page-title">{svc.requiresAppointment ? 'Your visit is booked' : 'Application submitted'}</h1>
          <p className="success-ref">Reference <strong>{done.reference}</strong></p>
          <p>Status: {done.status}</p>
        </div>
        {svc.requiresAppointment && (
          <section className="panel">
            <h2 className="panel-title"><CalendarCheck2 size={20} aria-hidden /> Your visit</h2>
            <DefinitionList items={[['Office', office?.name], ['Where', office?.location], ['When', slot && `${fmtLongDay(slot.day)} at ${slot.time}`]]} />
            <h3 className="sub-title">Bring these originals</h3>
            <ul className="ticks">{reqs.map((r) => <li key={r.id}>{r.label}{r.is_fee && fee ? `: ${money(fee.amount)} (${fee.label})` : ''}</li>)}</ul>
            <p className="muted small">We will remind you the day before. If you cannot make it, move or cancel the visit from your application page so someone else can use the time.</p>
          </section>
        )}
        <Alert tone="info">This booking reserves an office visit. It is not approval of your application. Officers check your documents at the visit.</Alert>
        <div className="button-row">
          <LinkButton to={`/applications/${appId}`}>View application</LinkButton>
          <LinkButton to="/home" variant="secondary">Back to home</LinkButton>
        </div>
      </div>
    );
  }

  return (
    <div className="narrow-wide wizard">
      <PageHeader title={svc.name} back={back} backLabel={svc.department.name}
        intro={reference ? `Reference ${reference}. Your progress is saved automatically.` : svc.summary} />
      <Stepper steps={steps} current={step} onStep={setStep} />
      <ErrorSummary error={summary} />

      {stepName === 'Applicant' && (
        <section className="panel">
          <h2 className="panel-title">Who is this application for?</h2>
          {blockedNoId ? (
            <Alert tone="warning" title="You need a National ID first" action={<LinkButton to="/service/NATIONAL_ID" variant="secondary" size="sm">Apply for a National ID</LinkButton>}>
              This service needs a National ID. Apply for one under Home Affairs, then come back.
            </Alert>
          ) : (
            <>
              {svc.appliesTo === 'both' && !appId && (
                <div className="radio-stack">
                  <label className={`radio-card wide${category === 'adult' ? ' on' : ''}`}>
                    <input type="radio" name="cat" checked={category === 'adult'} onChange={() => setCategory('adult')} />
                    <UserRound size={22} aria-hidden /><span className="row-main"><span className="row-title">For myself</span><span className="row-sub">Adult applicant aged 16 or above</span></span>
                  </label>
                  <label className={`radio-card wide${category === 'minor' ? ' on' : ''}`}>
                    <input type="radio" name="cat" checked={category === 'minor'} onChange={() => setCategory('minor')} />
                    <Baby size={22} aria-hidden /><span className="row-main"><span className="row-title">For my child</span><span className="row-sub">Minor applicant below 16. You must be the parent or legal guardian.</span></span>
                  </label>
                </div>
              )}
              {category === 'adult' ? (
                <div className="prefill">
                  <p className="prefill-title">We will use the details already on your verified record</p>
                  <DefinitionList items={[
                    ['Name', `${citizen.firstName} ${citizen.surname}`], ['Date of birth', fmtDate(citizen.dateOfBirth)],
                    ['ID number', citizen.nationalIdMasked || 'None'], ['Age', `${citizen.age} (adult applicant)`],
                  ]} />
                  <p className="muted small">You do not need to type these again. If something is wrong, visit a Home Affairs office.</p>
                  {citizen.verificationStatus !== 'verified' && svc.requiresNationalId && (
                    <Alert tone="warning">Your identity is not verified yet. You can prepare this application, but you can only confirm the visit once Home Affairs has verified you.</Alert>
                  )}
                </div>
              ) : appId ? (
                <p className="note">Child details were saved with this application.</p>
              ) : (
                <div className="form">
                  <div className="grid-2">
                    <Input id="m-first" label="Child's first name" value={minor.firstName} onChange={(e) => setMinor({ ...minor, firstName: e.target.value })} error={errors['minor.firstName']} />
                    <Input id="m-sur" label="Child's surname" value={minor.surname} onChange={(e) => setMinor({ ...minor, surname: e.target.value })} error={errors['minor.surname']} />
                  </div>
                  <Input id="m-dob" type="date" label="Child's date of birth" hint="The child must be below 16." value={minor.dateOfBirth}
                    onChange={(e) => setMinor({ ...minor, dateOfBirth: e.target.value })} error={errors['minor.dateOfBirth']} max={new Date().toISOString().slice(0, 10)} />
                  <Input id="m-bc" label="Birth certificate number" value={minor.birthCertificateNo} onChange={(e) => setMinor({ ...minor, birthCertificateNo: e.target.value })} error={errors['minor.birthCertificateNo']} />
                  <Select id="m-rel" label="Your relationship to the child" value={minor.relationship} onChange={(e) => setMinor({ ...minor, relationship: e.target.value })} error={errors['minor.relationship']}>
                    <option value="">Choose one</option>
                    <option value="parent">Parent</option>
                    <option value="guardian">Legal guardian</option>
                  </Select>
                </div>
              )}
              {!reqs.length && (
                <Alert tone="warning" title="This case cannot be done online yet">
                  The requirements for {category === 'minor' ? 'a child' : 'this applicant'} have not been confirmed from an official source,
                  so we cannot tell you what to bring. Contact a passport office before you travel.
                </Alert>
              )}
            </>
          )}
        </section>
      )}

      {stepName === 'Documents' && (
        <>
          <section className="panel">
            <h2 className="panel-title">Document checklist</h2>
            <p>Tick each item once you have it ready. You will show the originals at the office.</p>
            {!svc.requirementsVerified && <UnverifiedNote />}
            <ProgressBar done={doneCount} total={reqs.length} />
            <ul className="checklist">
              {reqs.map((r) => (
                <li key={r.id}>
                  <label className={`check-card${checklist[r.id] ? ' on' : ''}`}>
                    <input type="checkbox" checked={!!checklist[r.id]} onChange={() => toggleReq(r.id)} />
                    <span className="row-main">
                      <span className="row-title">{r.is_fee ? <Banknote size={18} aria-hidden /> : <FileText size={18} aria-hidden />} {r.label}</span>
                      {r.detail && <span className="row-sub">{r.detail}</span>}
                    </span>
                  </label>
                </li>
              ))}
            </ul>
            {complete && (
              <Alert tone="success" title="You are ready">You have confirmed everything on the list. {svc.requiresAppointment ? 'Continue to choose an office.' : 'Continue to review and submit.'}</Alert>
            )}
          </section>
          {needsFee && (
            <section className="panel">
              <h2 className="panel-title">Passport type and fee</h2>
              <Select id="fee" label="Which passport do you want?" value={feeId || ''} error={errors.fee}
                onChange={(e) => { const v = e.target.value ? Number(e.target.value) : null; setFeeId(v); save({ feeId: v }); }}>
                <option value="">Choose a passport type</option>
                {fees.map((f) => <option key={f.id} value={f.id}>{f.label}: {money(f.amount)}</option>)}
              </Select>
              {fee && <p className="fee-result" aria-live="polite">Fee to pay: <strong>{money(fee.amount)}</strong></p>}
              <FeeTable fees={fees} />
            </section>
          )}
          {isReplace && <PassportHistory records={history} setRecords={setHistory} />}
        </>
      )}

      {stepName === 'Office' && (
        <section className="panel">
          <h2 className="panel-title">Choose an office</h2>
          <OfficeFinder department={svc.department.code} selectedId={office?.id}
            onSelect={(o) => { setOffice(o); setSlot(null); save({ officeId: o.id, proposedSlotId: null }); }} />
        </section>
      )}

      {stepName === 'Visit time' && office && (
        <SlotPicker office={office} selected={slot} onSelect={(s) => { setSlot(s); save({ proposedSlotId: s.id }); }} />
      )}

      {stepName === 'Review' && (
        <section className="panel">
          <h2 className="panel-title">Check your {svc.requiresAppointment ? 'visit' : 'application'}</h2>
          <dl className="deflist">
            <ReviewRow k="Service" v={svc.name} />
            <ReviewRow k="Applicant" v={category === 'minor' ? `Child below 16${minor.firstName ? `: ${minor.firstName} ${minor.surname}` : ''}` : `${citizen.firstName} ${citizen.surname} (adult)`} onEdit={() => setStep(0)} />
            <ReviewRow k="Documents" v={`${doneCount} of ${reqs.length} documents confirmed`} onEdit={() => setStep(1)} />
            {fee && <ReviewRow k="Passport type and fee" v={`${fee.label}: ${money(fee.amount)}`} onEdit={() => setStep(1)} />}
            {isReplace && <ReviewRow k="Previous passports" v={history.length ? history.map((h) => `${h.issue_year} ${h.passport_type}`).join('; ') : 'None recorded'} onEdit={() => setStep(1)} />}
            {svc.requiresAppointment && <ReviewRow k="Office" v={office ? `${office.name}, ${office.location}` : 'Not chosen'} onEdit={() => setStep(2)} />}
            {svc.requiresAppointment && <ReviewRow k="Date and time" v={slot ? `${fmtLongDay(slot.day)} at ${slot.time}` : 'Not chosen'} onEdit={() => setStep(3)} />}
          </dl>
          <ul className="ticks small">{reqs.map((r) => <li key={r.id}>{r.label}</li>)}</ul>
          <Alert tone="info">{svc.inPersonNote} Your place is only held once you confirm.</Alert>
        </section>
      )}

      <div className="wizard-actions">
        <div className="wizard-left">
          {step > 0 && <Button variant="ghost" icon={ArrowLeft} onClick={() => { setSummary(null); setStep(step - 1); }}>Back</Button>}
          <Button variant="ghost" onClick={() => setCancelOpen(true)}>Cancel</Button>
        </div>
        <div className="wizard-right">
          {saved && <span className="saved" aria-live="polite">Saved</span>}
          {appId && stepName !== 'Review' && <Button variant="secondary" icon={Save} onClick={() => save({ checklist, feeId }, { quiet: false })}>Save draft</Button>}
          {stepName === 'Review'
            ? <Button size="lg" icon={CheckCircle2} loading={busy} onClick={confirm}>{svc.requiresAppointment ? 'Confirm visit' : 'Submit application'}</Button>
            : <Button icon={ArrowRight} loading={busy} onClick={next} disabled={stepName === 'Applicant' && (blockedNoId || !reqs.length)}>Continue</Button>}
        </div>
      </div>

      <Modal open={cancelOpen} title="Cancel this application?" onClose={() => setCancelOpen(false)}
        actions={<><Button variant="ghost" onClick={() => setCancelOpen(false)}>Keep going</Button><Button variant="danger" onClick={cancelApp}>Cancel application</Button></>}>
        <p>{appId ? 'Your draft will be cancelled. Nothing has been booked yet.' : 'Nothing has been saved yet.'} To stop for now and finish later, choose "Keep going" and then "Save draft" instead.</p>
      </Modal>
    </div>
  );
}

function ReviewRow({ k, v, onEdit }) {
  return (
    <div className="deflist-row">
      <dt>{k}</dt>
      <dd className="review-dd"><span>{v}</span>{onEdit && <button type="button" className="link-btn" onClick={onEdit}>Edit<span className="sr-only"> {k}</span></button>}</dd>
    </div>
  );
}

function SlotPicker({ office, selected, onSelect }) {
  const { data, error, loading, reload } = useLoad(() => api.get(`/catalogue/offices/${office.id}/slots`), [office.id]);
  const [day, setDay] = useState(selected?.day || null);
  useEffect(() => { if (data && !day && data.days.length) setDay(data.days[0].day); }, [data, day]);
  if (loading) return <Loading label="Finding free times" />;
  if (error) return <LoadError error={error} onRetry={reload} />;
  if (!data.days.length) return <Alert tone="warning" title="No visit times open">This office has no open times yet. Choose another office or try again tomorrow.</Alert>;
  const current = data.days.find((d) => d.day === day) || data.days[0];
  return (
    <section className="panel">
      <div className="panel-head">
        <h2 className="panel-title">Choose a visit time at {office.name}</h2>
        {data.nextAvailable && (
          <Button variant="secondary" size="sm" icon={Zap} onClick={() => { setDay(data.nextAvailable.day); onSelect(data.nextAvailable); }}>
            Earliest: {fmtLongDay(data.nextAvailable.day)}, {data.nextAvailable.time}
          </Button>
        )}
      </div>
      <p className="muted small">Weekends and public holidays are closed. Times are shown in Lesotho time.</p>
      <div className="day-strip" role="radiogroup" aria-label="Day">
        {data.days.map((d) => {
          const free = d.slots.reduce((n, s) => n + (s.available > 0 ? 1 : 0), 0);
          const dt = new Date(`${d.day}T12:00:00`);
          return (
            <button key={d.day} type="button" role="radio" aria-checked={d.day === current.day} disabled={!free}
              className={`day${d.day === current.day ? ' on' : ''}`} onClick={() => setDay(d.day)}>
              <span className="day-dow">{dt.toLocaleDateString('en-GB', { weekday: 'short' })}</span>
              <span className="day-num">{dt.getDate()}</span>
              <span className="day-mon">{dt.toLocaleDateString('en-GB', { month: 'short' })}</span>
              <span className="day-free">{free ? `${free} times` : 'Full'}</span>
            </button>
          );
        })}
      </div>
      <h3 className="sub-title">{fmtLongDay(current.day)}</h3>
      <div className="time-grid" role="radiogroup" aria-label="Time">
        {current.slots.map((s) => (
          <button key={s.id} type="button" role="radio" aria-checked={selected?.id === s.id} disabled={s.available <= 0}
            className={`time${selected?.id === s.id ? ' on' : ''}`} onClick={() => onSelect({ id: s.id, day: current.day, time: s.time })}>
            <span>{s.time}</span>
            <span className="time-free">{s.available > 0 ? `${s.available} left` : 'Full'}</span>
          </button>
        ))}
      </div>
      {selected && <Alert tone="success">Chosen: {fmtLongDay(selected.day)} at {selected.time}. Continue to review.</Alert>}
    </section>
  );
}

function PassportHistory({ records, setRecords }) {
  const [form, setForm] = useState({ issueYear: '', passportType: '', reference: '' });
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const sorted = [...records].sort((a, b) => b.issue_year - a.issue_year || b.id - a.id);
  const add = async (e) => {
    e.preventDefault();
    const er = {};
    const y = Number(form.issueYear);
    if (!y || y < 1966 || y > new Date().getFullYear()) er.issueYear = `Enter a year between 1966 and ${new Date().getFullYear()}.`;
    if (!form.passportType) er.passportType = 'Choose the passport type.';
    setErrors(er);
    if (Object.keys(er).length) return;
    setBusy(true);
    try {
      const r = await api.post('/citizen/previous-passports', { ...form, issueYear: y });
      setRecords([...records, r.record]); setForm({ issueYear: '', passportType: '', reference: '' }); toast('Previous passport added.');
    } catch (err) { setErrors(err.fields || {}); toast(err.message, 'error'); } finally { setBusy(false); }
  };
  const remove = async (id) => {
    await api.del(`/citizen/previous-passports/${id}`);
    setRecords(records.filter((r) => r.id !== id)); toast('Record removed.');
  };
  return (
    <section className="panel">
      <h2 className="panel-title">Your previous passports</h2>
      <p>Record the passports you have had. This helps the officer find your file. Most recent first.</p>
      {sorted.length === 0 ? <p className="muted">No previous passports recorded yet.</p> : (
        <ol className="history-list">
          {sorted.map((r) => (
            <li key={r.id} className="history-item">
              <span className="history-year">{r.issue_year}</span>
              <span className="row-main"><span className="row-title">{r.passport_type}</span>{r.reference && <span className="row-sub">{r.reference}</span>}</span>
              <button type="button" className="icon-btn" onClick={() => remove(r.id)} aria-label={`Remove ${r.issue_year} passport`}><Trash2 size={18} /></button>
            </li>
          ))}
        </ol>
      )}
      <form onSubmit={add} noValidate className="form history-form">
        <h3 className="sub-title">Add another previous passport</h3>
        <div className="grid-3">
          <Input id="h-year" type="number" inputMode="numeric" label="Year issued" value={form.issueYear} onChange={(e) => setForm({ ...form, issueYear: e.target.value })} error={errors.issueYear} />
          <Select id="h-type" label="Passport type" value={form.passportType} onChange={(e) => setForm({ ...form, passportType: e.target.value })} error={errors.passportType}>
            <option value="">Choose a type</option>
            {PASSPORT_TYPES.map((t) => <option key={t}>{t}</option>)}
          </Select>
          <Input id="h-ref" label="Passport or reference number" optional value={form.reference} onChange={(e) => setForm({ ...form, reference: e.target.value })} />
        </div>
        <Button type="submit" variant="secondary" icon={Plus} loading={busy}>Add record</Button>
      </form>
      <p className="muted small">Not sure of the details? Leave them out. <Link to="/passport/offices">The passport office</Link> can look them up.</p>
    </section>
  );
}
