import { useState } from 'react';
import { Link, useParams, Navigate } from 'react-router-dom';
import {
  ChevronRight, MapPin, Phone, Clock, Search, BookUser, RefreshCw, FileText, Activity, Building2, Users, Banknote, AlertTriangle, CalendarClock, Info,
} from 'lucide-react';
import { api, money } from '../../api.js';
import { Alert, Button, Empty, LinkButton, LoadError, Loading, PageHeader, useLoad } from '../../components/ui.jsx';
import { DEPT_ICONS } from '../../components/Layouts.jsx';

export function ServicesHome() {
  const { data, error, loading, reload } = useLoad(() => api.get('/catalogue/departments'), []);
  if (loading) return <Loading />;
  if (error) return <LoadError error={error} onRetry={reload} />;
  return (
    <div>
      <PageHeader title="Government services" intro="Choose a department to see its services, what to bring and where to go." />
      <ul className="dept-grid">
        {data.departments.map((d) => {
          const Icon = DEPT_ICONS[d.code];
          return (
            <li key={d.code}>
              <Link to={d.code === 'PASSPORT' ? '/passport' : `/services/${d.code}`} className="dept-card">
                <span className="dept-icon"><Icon size={28} aria-hidden /></span>
                <span className="dept-card-text">
                  <span className="dept-name">{d.name}</span>
                  <span className="dept-desc">{d.description}</span>
                  <span className="dept-count">{d.service_count} service{d.service_count === 1 ? '' : 's'}</span>
                </span>
                <ChevronRight size={22} aria-hidden />
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export function DepartmentPage() {
  const { code } = useParams();
  const { data, error, loading, reload } = useLoad(() => api.get(`/catalogue/departments/${code}`), [code]);
  if (code === 'PASSPORT') return <Navigate to="/passport" replace />;
  if (loading) return <Loading />;
  if (error) return <LoadError error={error} onRetry={reload} />;
  const Icon = DEPT_ICONS[data.department.code];
  return (
    <div className="narrow-wide">
      <PageHeader title={data.department.name} intro={data.department.description} back="/services" backLabel="All services" />
      {code === 'PENSION' && (
        <Alert tone="info" title="Help for older citizens">
          A family member or helper may come with you to the office and may help you use this website.
          If you cannot travel, tell the officer at your nearest Pension Office so they can advise you.
        </Alert>
      )}
      <ul className="service-list">
        {data.services.map((s) => (
          <li key={s.code}>
            <Link to={`/service/${s.code}`} className="service-row">
              <span className="dept-icon small"><Icon size={22} aria-hidden /></span>
              <span className="row-main">
                <span className="row-title">{s.name}</span>
                <span className="row-sub">{s.summary}</span>
                <span className="tags">
                  {s.requires_appointment ? <span className="tag"><CalendarClock size={14} aria-hidden /> Office visit</span> : <span className="tag"><FileText size={14} aria-hidden /> Online request</span>}
                  {s.min_age && <span className="tag">Age {s.min_age}+</span>}
                  {s.applies_to !== 'self' && <span className="tag"><Users size={14} aria-hidden /> For children too</span>}
                </span>
              </span>
              <ChevronRight size={20} aria-hidden />
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function RequirementList({ items }) {
  if (!items.length) return null;
  return (
    <ul className="req-list">
      {items.map((r) => (
        <li key={r.id} className="req">
          <span className="req-label">{r.is_fee ? <Banknote size={18} aria-hidden /> : <FileText size={18} aria-hidden />} {r.label}</span>
          {r.detail && <span className="req-detail">{r.detail}</span>}
        </li>
      ))}
    </ul>
  );
}

export function UnverifiedNote() {
  return (
    <Alert tone="warning" title="Requirements still being confirmed">
      The department has not yet confirmed this list from an official source. An officer will tell you at your visit if anything else is needed.
    </Alert>
  );
}

export function ServiceDetail() {
  const { code } = useParams();
  const { data, error, loading, reload } = useLoad(() => Promise.all([api.get(`/catalogue/services/${code}`), api.get('/applications')]), [code]);
  const [cat, setCat] = useState(null);
  if (['PASSPORT_NEW', 'PASSPORT_REPLACE'].includes(code)) return <Navigate to={code === 'PASSPORT_NEW' ? '/passport/new' : '/passport/replace'} replace />;
  if (loading) return <Loading />;
  if (error) return <LoadError error={error} onRetry={reload} />;
  const [{ service: s, requirements, fees }, mine] = data;
  const open = mine.applications.find((a) => a.service_code === s.code && !['completed', 'rejected', 'cancelled'].includes(a.status) && a.applicant_category === 'adult');
  const category = cat || (s.appliesTo === 'minor' ? 'minor' : 'adult');
  const reqs = requirements[category];
  const back = s.department.code === 'PASSPORT' ? '/passport' : `/services/${s.department.code}`;

  return (
    <div className="narrow-wide">
      <PageHeader title={s.name} intro={s.summary} back={back} backLabel={s.department.name} />
      {s.appliesTo === 'both' && (
        <div className="tabs" role="tablist" aria-label="Who is this for">
          <button role="tab" aria-selected={category === 'adult'} className={`tab-btn${category === 'adult' ? ' on' : ''}`} onClick={() => setCat('adult')}>For myself</button>
          <button role="tab" aria-selected={category === 'minor'} className={`tab-btn${category === 'minor' ? ' on' : ''}`} onClick={() => setCat('minor')}>For my child (below 16)</button>
        </div>
      )}
      <section className="panel">
        <h2 className="panel-title">What you need</h2>
        {!s.requirementsVerified && <UnverifiedNote />}
        {reqs.length ? <RequirementList items={reqs} /> : <Alert tone="warning">The requirements for this case have not been confirmed yet. Contact the office before you travel.</Alert>}
        {s.minAge && <p className="note">This service is for people aged {s.minAge} or older. The system checks your age automatically from your record.</p>}
      </section>
      {fees.length > 0 && (
        <section className="panel">
          <h2 className="panel-title">Fees</h2>
          <FeeTable fees={fees} />
        </section>
      )}
      <section className="panel">
        <h2 className="panel-title">{s.requiresAppointment ? 'Office visit' : 'How it works'}</h2>
        <p>{s.inPersonNote}</p>
      </section>
      <div className="sticky-actions">
        {open
          ? <LinkButton to={`/applications/${open.id}`} size="lg">Continue your application {open.reference}</LinkButton>
          : <LinkButton to={`/apply/${s.code}${category === 'minor' ? '?for=minor' : ''}`} size="lg">Start application</LinkButton>}
      </div>
    </div>
  );
}

export function FeeTable({ fees }) {
  return (
    <>
      <div className="table-wrap">
        <table className="table">
          <caption className="sr-only">Fees</caption>
          <thead><tr><th>Type</th><th className="num">Fee</th></tr></thead>
          <tbody>{fees.map((f) => <tr key={f.id}><td>{f.label}</td><td className="num">{money(f.amount)}</td></tr>)}</tbody>
        </table>
      </div>
      {fees.some((f) => !f.is_verified) && (
        <p className="muted small"><AlertTriangle size={14} aria-hidden /> These fees were supplied for this project and must be checked against current official requirements before you rely on them.</p>
      )}
    </>
  );
}

// ---------------------------------------------------------------- passports
export function PassportHub() {
  const { data } = useLoad(() => api.get('/applications'), []);
  const open = (data?.applications || []).filter((a) => a.department_code === 'PASSPORT' && !['completed', 'rejected', 'cancelled'].includes(a.status));
  const options = [
    ['/passport/new', BookUser, 'Apply for a new passport', 'First passport for an adult (16 or older) or a child below 16.'],
    ['/passport/replace', RefreshCw, 'Replace an existing passport', 'Your passport is full, expired, lost or damaged.'],
    ['/applications?department=PASSPORT', FileText, 'View my passport applications', 'All passport applications on your account.'],
    ['/passport/status', Activity, 'Check application status', 'Look up any application by its reference number.'],
    ['/passport/offices', Building2, 'Find a passport office', 'Search offices by district and see opening hours.'],
    ['/passport/fees', Banknote, 'Passport fees', 'Fees for 32-page and 64-page passports.'],
  ];
  return (
    <div className="narrow-wide">
      <PageHeader title="Passport Services" back="/services" backLabel="All services"
        intro="Prepare your documents here, then visit a passport office once. Photos and fingerprints are taken at the office." />
      {open.length > 0 && (
        <Alert tone="info" title={`You have ${open.length} open passport application${open.length === 1 ? '' : 's'}`}
          action={<LinkButton to={`/applications/${open[0].id}`} variant="secondary" size="sm">Open {open[0].reference}</LinkButton>} />
      )}
      <ul className="option-list">
        {options.map(([to, Icon, title, text]) => (
          <li key={to}>
            <Link to={to} className="option">
              <Icon size={26} aria-hidden className="option-icon" />
              <span className="row-main"><span className="row-title">{title}</span><span className="row-sub">{text}</span></span>
              <ChevronRight size={20} aria-hidden />
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function PassportFees() {
  const { data, error, loading, reload } = useLoad(() => api.get('/catalogue/services/PASSPORT_NEW'), []);
  const [sel, setSel] = useState('');
  if (loading) return <Loading />;
  if (error) return <LoadError error={error} onRetry={reload} />;
  const fee = data.fees.find((f) => String(f.id) === sel);
  return (
    <div className="narrow">
      <PageHeader title="Passport fees" back="/passport" backLabel="Passport Services" />
      <section className="panel">
        <label className="field-label" htmlFor="ptype">Which passport do you need?</label>
        <div className="radio-stack" id="ptype">
          {data.fees.map((f) => (
            <label key={f.id} className={`radio-card wide${sel === String(f.id) ? ' on' : ''}`}>
              <input type="radio" name="ptype" value={f.id} checked={sel === String(f.id)} onChange={(e) => setSel(e.target.value)} />
              <span className="row-main"><span className="row-title">{f.label}</span></span>
              <span className="fee-amount">{money(f.amount)}</span>
            </label>
          ))}
        </div>
        {fee && <p className="fee-result" aria-live="polite">The fee for a {fee.label.toLowerCase()} is <strong>{money(fee.amount)}</strong>.</p>}
        <p className="muted small"><AlertTriangle size={14} aria-hidden /> These fees were supplied for this project and must be verified against current official requirements before implementation.</p>
      </section>
      <div className="button-row">
        <LinkButton to="/passport/new">Apply for a new passport</LinkButton>
        <LinkButton to="/passport/replace" variant="secondary">Replace a passport</LinkButton>
      </div>
    </div>
  );
}

export function OfficeFinder({ department = 'PASSPORT', selectedId, onSelect, compact }) {
  const [q, setQ] = useState('');
  const [term, setTerm] = useState('');
  const { data, error, loading, reload } = useLoad(() => api.get(`/catalogue/offices?department=${department}&q=${encodeURIComponent(term)}`), [department, term]);
  return (
    <div className="office-finder">
      <form className="search-row" role="search" onSubmit={(e) => { e.preventDefault(); setTerm(q); }}>
        <label htmlFor="office-q" className="sr-only">Search by district or office name</label>
        <input id="office-q" className="input" placeholder="Search by district or office, for example Leribe" value={q}
          onChange={(e) => { setQ(e.target.value); if (!e.target.value) setTerm(''); }} />
        <Button type="submit" icon={Search} variant="secondary">Search</Button>
      </form>
      {loading ? <Loading label="Finding offices" /> : error ? <LoadError error={error} onRetry={reload} /> : data.offices.length === 0 ? (
        <Empty icon={MapPin} title={`No offices match "${term}"`} action={<Button variant="secondary" onClick={() => { setQ(''); setTerm(''); }}>Show all offices</Button>}>
          Try the name of your district, such as Maseru, Leribe or Mafeteng.
        </Empty>
      ) : (
        <ul className={`office-list${compact ? ' compact' : ''}`}>
          {data.offices.map((o) => {
            const on = selectedId === o.id;
            return (
              <li key={o.id} className={`office${on ? ' on' : ''}`}>
                <div className="office-info">
                  <p className="office-name">{o.name}</p>
                  <p className="office-line"><MapPin size={15} aria-hidden /> {o.location}</p>
                  <p className="office-line"><Clock size={15} aria-hidden /> {o.hours}</p>
                  <p className="office-line"><Phone size={15} aria-hidden /> {o.phone || 'Contact number not available'}</p>
                  {!o.details_verified && <p className="office-line muted small"><Info size={14} aria-hidden /> Office details still to be confirmed by the department.</p>}
                </div>
                {onSelect && (
                  <Button variant={on ? 'primary' : 'secondary'} onClick={() => onSelect(o)} aria-pressed={on}>
                    {on ? 'Selected' : 'Select office'}
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

export function PassportOffices() {
  const [sel, setSel] = useState(null);
  return (
    <div className="narrow-wide">
      <PageHeader title="Find a passport office" back="/passport" backLabel="Passport Services" />
      {sel && (
        <Alert tone="success" title={`${sel.name} selected`} action={<div className="button-row">
          <LinkButton to={`/passport/new?office=${sel.id}`} size="sm">New passport here</LinkButton>
          <LinkButton to={`/passport/replace?office=${sel.id}`} size="sm" variant="secondary">Replace passport here</LinkButton>
        </div>}>
          {sel.location}. {sel.phone ? `Phone ${sel.phone}.` : 'Contact number not available.'}
        </Alert>
      )}
      <OfficeFinder department="PASSPORT" selectedId={sel?.id} onSelect={setSel} />
    </div>
  );
}

export function StatusLookup() {
  const { data, loading } = useLoad(() => api.get('/applications'), []);
  const [ref, setRef] = useState('');
  const [err, setErr] = useState(null);
  const [found, setFound] = useState(null);
  const search = (e) => {
    e.preventDefault();
    const r = ref.trim().toUpperCase();
    if (!r) { setErr('Enter a reference number, for example PSN-2026-001024.'); setFound(null); return; }
    const a = data.applications.find((x) => x.reference === r);
    setErr(a ? null : `No application with reference ${r} is on your account. Check the number on your confirmation.`);
    setFound(a || null);
  };
  return (
    <div className="narrow">
      <PageHeader title="Check application status" back="/passport" backLabel="Passport Services"
        intro="Enter the reference number from your confirmation. You can only see applications on your own account." />
      <form onSubmit={search} className="search-row" role="search">
        <label htmlFor="ref" className="sr-only">Reference number</label>
        <input id="ref" className="input" placeholder="PSN-2026-001024" value={ref} onChange={(e) => setRef(e.target.value)} aria-invalid={err ? 'true' : undefined} />
        <Button type="submit" icon={Search} loading={loading}>Check status</Button>
      </form>
      {err && <Alert tone="error">{err}</Alert>}
      {found && (
        <section className="panel">
          <p className="row-title">{found.service_name}</p>
          <p className="muted">{found.reference}</p>
          <p className="status-big">{found.status_label}</p>
          <LinkButton to={`/applications/${found.id}`} variant="secondary">View details and history</LinkButton>
        </section>
      )}
    </div>
  );
}
