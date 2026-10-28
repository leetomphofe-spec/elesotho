import { useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Lock, Search, ShieldAlert, CalendarClock, Share2, Fingerprint, ClipboardCheck, Send, Download, KeyRound } from 'lucide-react';
import { api, fmtDate, fmtDateTime, money } from '../../api.js';
import { useAuth } from '../../context/AuthContext.jsx';
import {
  Alert, Button, DefinitionList, Empty, ErrorSummary, Input, LoadError, Loading, Modal, PageHeader, Select, StatusBadge, STATUS_TEXT, Textarea, useLoad, useToast,
} from '../../components/ui.jsx';

// ---------------------------------------------------------------- dashboard
export function StaffDashboard() {
  const { staff } = useAuth();
  const { data, error, loading, reload } = useLoad(() => api.get('/staff/dashboard'), []);
  if (loading) return <Loading />;
  if (error) return <LoadError error={error} onRetry={reload} />;
  const c = data.counts;
  const tiles = [
    ['ready_for_visit', 'Visits booked'], ['under_review', 'Under review'], ['additional_info_required', 'Waiting for citizen'], ['completed', 'Completed'],
  ];
  return (
    <div>
      <PageHeader title={staff.departmentName} intro={`You can see ${staff.departmentName} applications only. Other departments' records are protected.`} />
      <div className="tile-row">
        {tiles.map(([k, l]) => (
          <Link key={k} to={`/staff/applications?status=${k}`} className="tile"><span className="tile-num">{c[k] || 0}</span><span className="tile-label">{l}</span></Link>
        ))}
      </div>
      {data.pendingApprovals > 0 && (
        <Alert tone="warning" title={`${data.pendingApprovals} information request${data.pendingApprovals === 1 ? '' : 's'} need your decision`}
          action={<Link to="/staff/access?scope=approvals" className="btn btn-secondary btn-sm">Review requests</Link>}>
          Other departments have asked for citizen information that needs a Home Affairs supervisor.
        </Alert>
      )}
      {data.identityPending > 0 && (
        <Alert tone="info" title={`${data.identityPending} citizen${data.identityPending === 1 ? '' : 's'} waiting for identity verification`}
          action={<Link to="/staff/identity" className="btn btn-secondary btn-sm">Open queue</Link>}>
          These people could not be matched automatically with the population register.
        </Alert>
      )}
      <div className="detail-grid">
        <section className="panel">
          <h2 className="panel-title"><CalendarClock size={20} aria-hidden /> Visits today and tomorrow</h2>
          {data.visits.length === 0 ? <p className="muted">No visits booked{staff.officeId ? ' at your office' : ''}.</p> : (
            <ul className="row-list">
              {data.visits.map((v) => (
                <li key={v.id}><Link to={`/staff/applications/${v.id}`} className="row-link">
                  <span className="row-main"><span className="row-title">{fmtDateTime(v.starts_at)}: {v.applicant_name}</span><span className="row-sub">{v.reference}, {v.service_name}, {v.office_name}</span></span>
                  <span className="btn btn-secondary btn-sm">Check in</span>
                </Link></li>
              ))}
            </ul>
          )}
        </section>
        <section className="panel">
          <h2 className="panel-title">Recently active</h2>
          {data.recent.length === 0 ? <p className="muted">No active applications.</p> : (
            <ul className="row-list">
              {data.recent.map((a) => (
                <li key={a.id}><Link to={`/staff/applications/${a.id}`} className="row-link">
                  <span className="row-main"><span className="row-title">{a.reference}</span><span className="row-sub">{a.service_name}, {fmtDate(a.last_status_at)}</span></span>
                  <StatusBadge status={a.status} label={a.status_label} />
                </Link></li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- application queue
export function StaffApplications() {
  const [params, setParams] = useSearchParams();
  const status = params.get('status') || '';
  const [q, setQ] = useState(params.get('q') || '');
  const [date, setDate] = useState(params.get('date') || '');
  const [ref, setRef] = useState('');
  const [lookupErr, setLookupErr] = useState(null);
  const navigate = useNavigate();
  const { data, error, loading, reload } = useLoad(
    () => api.get(`/staff/applications?status=${status}&q=${encodeURIComponent(params.get('q') || '')}&date=${params.get('date') || ''}`), [params.toString()]
  );
  const apply = (e) => { e.preventDefault(); setParams({ ...(status && { status }), ...(q && { q }), ...(date && { date }) }); };
  const lookup = async (e) => {
    e.preventDefault(); setLookupErr(null);
    try { const r = await api.get(`/staff/lookup?reference=${encodeURIComponent(ref)}`); navigate(`/staff/applications/${r.id}`); }
    catch (err) { setLookupErr(err); }
  };
  return (
    <div>
      <PageHeader title="Applications" intro="Applications handled by your department." />
      <form onSubmit={lookup} className="panel lookup">
        <label htmlFor="ref" className="field-label">Open by reference number</label>
        <div className="search-row">
          <input id="ref" className="input" placeholder="PSN-2026-001024" value={ref} onChange={(e) => setRef(e.target.value)} />
          <Button type="submit" variant="secondary">Open</Button>
        </div>
        {lookupErr && <Alert tone={lookupErr.code === 'ACCESS_DENIED' ? 'error' : 'warning'} title={lookupErr.code === 'ACCESS_DENIED' ? 'Access denied' : 'Not found'}>{lookupErr.message}</Alert>}
      </form>
      <form onSubmit={apply} className="filters">
        <Select id="f-status" label="Status" value={status} onChange={(e) => setParams({ ...(e.target.value && { status: e.target.value }), ...(q && { q }), ...(date && { date }) })}>
          <option value="">All statuses</option>
          {['preparing_documents', 'ready_for_visit', 'submitted', 'under_review', 'additional_info_required', 'completed', 'rejected', 'cancelled'].map((s) => <option key={s} value={s}>{STATUS_TEXT[s]}</option>)}
        </Select>
        <Input id="f-q" label="Reference or applicant name" value={q} onChange={(e) => setQ(e.target.value)} />
        <Input id="f-date" type="date" label="Visit date" value={date} onChange={(e) => setDate(e.target.value)} />
        <Button type="submit" icon={Search}>Search</Button>
      </form>
      {loading ? <Loading /> : error ? <LoadError error={error} onRetry={reload} /> : data.applications.length === 0 ? (
        <Empty title="No applications match">Change the filters or clear the search.</Empty>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <caption className="sr-only">Applications</caption>
            <thead><tr><th>Reference</th><th>Applicant</th><th>Service</th><th>Visit</th><th>Status</th><th>Updated</th></tr></thead>
            <tbody>
              {data.applications.map((a) => (
                <tr key={a.id}>
                  <td><Link to={`/staff/applications/${a.id}`}><code>{a.reference}</code></Link></td>
                  <td>{a.applicant_name}{a.applicant_category === 'minor' && <span className="muted small"> (for a minor)</span>}</td>
                  <td>{a.service_name}</td>
                  <td>{a.visit_at ? fmtDateTime(a.visit_at) : <span className="muted">None</span>}</td>
                  <td><StatusBadge status={a.status} label={a.status_label} /></td>
                  <td>{fmtDate(a.last_status_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- application review
export function StaffReview() {
  const { id } = useParams();
  const toast = useToast();
  const { data, error, loading, reload } = useLoad(() => api.get(`/staff/applications/${id}`), [id]);
  const [checks, setChecks] = useState({});
  const [checkNote, setCheckNote] = useState('');
  const [action, setAction] = useState(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const [requestOpen, setRequestOpen] = useState(false);

  if (loading) return <Loading />;
  if (error) {
    if (error.code === 'ACCESS_DENIED') {
      return (
        <div className="narrow">
          <div className="denied">
            <ShieldAlert size={48} aria-hidden />
            <h1 className="page-title">Access denied</h1>
            <p>{error.message}</p>
            <p className="muted small">This attempt has been recorded in the audit log.</p>
            <Link to="/staff/applications" className="btn btn-secondary">Back to my department's applications</Link>
          </div>
        </div>
      );
    }
    return <LoadError error={error} onRetry={reload} />;
  }
  const { application: a, citizen, requirements, events, infoRequests, documentChecks, accessRequests, allowedActions } = data;

  const doCheckIn = async () => {
    setBusy(true); setErr(null);
    try { const r = await api.post(`/staff/applications/${a.id}/check-in`, { results: checks, note: checkNote || undefined }); toast(r.message); reload(); }
    catch (e) { setErr(e); } finally { setBusy(false); }
  };
  const doStatus = async () => {
    setBusy(true); setErr(null);
    try { const r = await api.post(`/staff/applications/${a.id}/status`, { to: action, note: note || undefined }); toast(r.message); setAction(null); setNote(''); reload(); }
    catch (e) { setErr(e); } finally { setBusy(false); }
  };
  const allChecked = requirements.every((r) => checks[r.id]);
  const lockedFields = Object.entries(citizen).filter(([, v]) => !v.visible).map(([k]) => k);

  return (
    <div>
      <PageHeader title={`${a.reference}`} back="/staff/applications" backLabel="Applications"
        intro={`${a.service.name}. ${a.category === 'minor' ? 'Minor applicant.' : 'Adult applicant.'} Started ${fmtDate(a.createdAt)}.`}
        actions={<StatusBadge status={a.status} label={a.statusLabel} />} />
      {a.statusReason && <Alert tone="info">{a.statusReason}</Alert>}
      <ErrorSummary error={err} />

      <div className="detail-grid">
        <section className="panel">
          <h2 className="panel-title">Citizen record</h2>
          <p className="muted small">You see only what {a.department.name} is permitted to see. Opening this page was recorded.</p>
          <dl className="deflist">
            {Object.entries(citizen).map(([k, v]) => (
              <div key={k} className="deflist-row">
                <dt>{v.label}</dt>
                <dd>{v.visible ? (
                  <>{k === 'verification_status' ? <StatusBadge status={v.value} /> : k === 'date_of_birth' ? fmtDate(v.value) : (v.value ?? <span className="muted">Not provided</span>)}
                    {v.source === 'granted' && <span className="tag tag-grant">Shared until {fmtDate(v.expires_at)}</span>}</>
                ) : <span className="locked"><Lock size={14} aria-hidden /> Not available to your department</span>}</dd>
              </div>
            ))}
          </dl>
          {lockedFields.length > 0 && !['completed', 'rejected', 'cancelled'].includes(a.status) && (
            <Button variant="secondary" size="sm" icon={Share2} onClick={() => setRequestOpen(true)}>Request more information</Button>
          )}
        </section>

        <section className="panel">
          <h2 className="panel-title">Application</h2>
          <DefinitionList items={[
            a.category === 'minor' && ['Child', `${a.applicant.firstName} ${a.applicant.surname}, born ${fmtDate(a.applicant.dateOfBirth)} (age ${a.applicantAge})`],
            a.category === 'minor' && ['Birth certificate no.', a.applicant.birthCertificateNo],
            a.category === 'minor' && ['Applying adult', `${a.applicant.applyingAdult} (${a.applicant.relationship})`],
            ['Office', data.office?.name],
            ['Visit', data.visitAt ? fmtDateTime(data.visitAt) : null],
            ['Fee selected', a.feeAmount ? money(a.feeAmount) : null],
            ['Citizen checklist', `${a.citizenChecklist.done} of ${a.citizenChecklist.total} confirmed by the citizen`],
            a.formData?.previousPassports && ['Previous passports', String(a.formData.previousPassports)],
          ]} />
        </section>
      </div>

      {a.status === 'ready_for_visit' && (
        <section className="panel panel-accent">
          <h2 className="panel-title"><ClipboardCheck size={20} aria-hidden /> Office visit: check original documents</h2>
          <p>Record a result for every document. If everything is accepted, the system runs its checks and moves the application on automatically.</p>
          <div className="table-wrap">
            <table className="table">
              <caption className="sr-only">Document checks</caption>
              <thead><tr><th>Document</th><th>Accepted</th><th>Missing</th><th>Not valid</th></tr></thead>
              <tbody>
                {requirements.map((r) => (
                  <tr key={r.id}>
                    <th scope="row">{r.label}</th>
                    {['verified', 'missing', 'invalid'].map((res) => (
                      <td key={res}><label className="radio-cell"><input type="radio" name={`req-${r.id}`} checked={checks[r.id] === res} onChange={() => setChecks({ ...checks, [r.id]: res })} />
                        <span className="sr-only">{r.label}: {res}</span></label></td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Textarea id="checknote" label="Note for the citizen" optional value={checkNote} onChange={(e) => setCheckNote(e.target.value)} hint="Shown to the citizen if a document is not accepted." />
          <div className="button-row">
            <Button onClick={() => setChecks(Object.fromEntries(requirements.map((r) => [r.id, 'verified'])))} variant="secondary">Mark all accepted</Button>
            <Button onClick={doCheckIn} loading={busy} disabled={!allChecked} icon={Send}>Save document check</Button>
          </div>
        </section>
      )}

      {allowedActions.some((x) => ['completed', 'rejected', 'additional_info_required'].includes(x)) && a.status === 'under_review' && (
        <section className="panel">
          <h2 className="panel-title">Decision</h2>
          <div className="button-row">
            <Button onClick={() => { setAction('completed'); setNote(''); }}>Mark completed</Button>
            <Button variant="secondary" onClick={() => { setAction('additional_info_required'); setNote(''); }}>Ask the citizen for information</Button>
            <Button variant="danger" onClick={() => { setAction('rejected'); setNote(''); }}>Reject</Button>
          </div>
        </section>
      )}

      <div className="detail-grid">
        <section className="panel">
          <h2 className="panel-title">Action record</h2>
          <ol className="timeline">
            {[...events].reverse().map((e, i) => (
              <li key={i} className="timeline-item"><span className="timeline-dot" aria-hidden />
                <div><p className="timeline-title">{e.to_label}</p>{e.note && <p className="timeline-note">{e.note}</p>}
                  <p className="timeline-meta">{fmtDateTime(e.created_at)}, {e.actor_label || e.actor_type}</p></div>
              </li>
            ))}
          </ol>
        </section>
        <section className="panel">
          <h2 className="panel-title">Document checks and messages</h2>
          {documentChecks.length === 0 && infoRequests.length === 0 ? <p className="muted">None yet.</p> : null}
          {documentChecks.length > 0 && (
            <ul className="row-list">{documentChecks.map((c, i) => (
              <li key={i} className="row"><span className="row-main"><span className="row-title">{requirements.find((r) => r.id === c.requirement_id)?.label}</span>
                <span className="row-sub">{fmtDateTime(c.created_at)} by {c.staff_name}</span></span><span className={`check-result check-${c.result}`}>{c.result}</span></li>
            ))}</ul>
          )}
          {infoRequests.map((r) => (
            <div key={r.id} className="message"><p className="quote">{r.message}</p>
              <p className="small">{r.responded_at ? <><strong>Citizen answered:</strong> {r.response}</> : <span className="muted">Waiting for the citizen</span>}</p></div>
          ))}
          {accessRequests.length > 0 && <>
            <h3 className="sub-title">Information requests</h3>
            <ul className="row-list">{accessRequests.map((r) => (
              <li key={r.id}><Link to={`/staff/access/${r.id}`} className="row-link"><span className="row-main"><span className="row-title">{r.reference}</span>
                <span className="row-sub">{r.fields.map((f) => data.fieldLabels[f]).join(', ')}</span></span><StatusBadge status={r.status} /></Link></li>
            ))}</ul>
          </>}
        </section>
      </div>

      <Modal open={!!action} onClose={() => setAction(null)}
        title={action === 'completed' ? 'Mark as completed?' : action === 'rejected' ? 'Reject this application?' : 'Ask the citizen for information'}
        actions={<><Button variant="ghost" onClick={() => setAction(null)}>Cancel</Button>
          <Button variant={action === 'rejected' ? 'danger' : 'primary'} loading={busy} onClick={doStatus}>
            {action === 'completed' ? 'Mark completed' : action === 'rejected' ? 'Reject application' : 'Send question'}
          </Button></>}>
        {action === 'completed' && <p>The citizen is told their document can be collected at the office. Add a note if they need to know anything else.</p>}
        {action === 'rejected' && <Alert tone="warning">Rejection is final. The citizen will see your reason and can start a new application.</Alert>}
        <Textarea id="decision-note" label={action === 'completed' ? 'Note for the citizen' : 'Reason (shown to the citizen)'} optional={action === 'completed'}
          value={note} onChange={(e) => setNote(e.target.value)} error={err?.fields?.note} />
      </Modal>
      {requestOpen && <RequestInfo app={a} locked={lockedFields} labels={data.fieldLabels} onClose={() => setRequestOpen(false)} onDone={() => { setRequestOpen(false); reload(); }} />}
    </div>
  );
}

function RequestInfo({ app, locked, labels, onClose, onDone }) {
  const { data } = useLoad(() => api.get('/access-requests/policies'), []);
  const [fields, setFields] = useState([]);
  const [purpose, setPurpose] = useState('');
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const policies = Object.fromEntries((data?.policies || []).map((p) => [p.field, p]));
  const submit = async () => {
    setBusy(true); setErr(null);
    try {
      const r = await api.post('/access-requests', { applicationId: app.id, fields, purpose });
      toast(r.message, r.request.status === 'denied' ? 'warning' : 'success'); onDone();
    } catch (e) { setErr(e); } finally { setBusy(false); }
  };
  return (
    <Modal open title="Request citizen information" onClose={onClose}
      actions={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button loading={busy} onClick={submit}>Send request</Button></>}>
      <ErrorSummary error={err} />
      <p>Choose only what you need for {app.reference}. The system decides automatically where a policy allows it, asks the citizen for consent where required, and sends the rest to a Home Affairs supervisor.</p>
      <fieldset className="fieldset">
        <legend>Information needed</legend>
        {locked.map((f) => {
          const p = policies[f];
          return (
            <label key={f} className="check">
              <input type="checkbox" checked={fields.includes(f)} onChange={(e) => setFields(e.target.checked ? [...fields, f] : fields.filter((x) => x !== f))} />
              <span>{labels[f]}<span className="muted small"> {p ? `${p.requires_consent ? 'Citizen consent needed. ' : ''}${p.auto_approve ? 'Approved automatically under policy.' : 'Supervisor approval needed.'}` : 'No policy: will be refused.'}</span></span>
            </label>
          );
        })}
      </fieldset>
      <Textarea id="purpose" label="Why do you need it?" hint="The citizen sees this reason." value={purpose} onChange={(e) => setPurpose(e.target.value)} error={err?.fields?.purpose} />
    </Modal>
  );
}

// ---------------------------------------------------------------- information requests
export function AccessRequests() {
  const [params, setParams] = useSearchParams();
  const scope = params.get('scope') || 'department';
  const { data, error, loading, reload } = useLoad(() => api.get(`/access-requests?scope=${scope}`), [scope]);
  return (
    <div>
      <PageHeader title="Information requests" intro="Requests to see citizen information beyond what your department sees by default." />
      {data?.canApprove && (
        <div className="tabs" role="tablist">
          <button role="tab" aria-selected={scope === 'department'} className={`tab-btn${scope === 'department' ? ' on' : ''}`} onClick={() => setParams({})}>My department's requests</button>
          <button role="tab" aria-selected={scope === 'approvals'} className={`tab-btn${scope === 'approvals' ? ' on' : ''}`} onClick={() => setParams({ scope: 'approvals' })}>Approvals</button>
        </div>
      )}
      {loading ? <Loading /> : error ? <LoadError error={error} onRetry={reload} /> : data.requests.length === 0 ? (
        <Empty icon={Share2} title="No requests">Requests are made from an application page, using "Request more information".</Empty>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <caption className="sr-only">Information requests</caption>
            <thead><tr><th>Reference</th><th>From</th><th>Information</th><th>Purpose</th><th>Consent</th><th>Status</th><th>Date</th></tr></thead>
            <tbody>
              {data.requests.map((r) => (
                <tr key={r.id}>
                  <td><Link to={`/staff/access/${r.id}`}><code>{r.reference}</code></Link></td>
                  <td>{r.requesting_department}<br /><span className="muted small">{r.requested_by_name}</span></td>
                  <td>{r.fields.map((f) => data.fieldLabels[f]).join(', ')}</td>
                  <td className="small">{r.purpose}</td>
                  <td>{STATUS_TEXT[r.consent_status] || { not_required: 'Not required', pending: 'Waiting', given: 'Given', refused: 'Refused' }[r.consent_status]}</td>
                  <td><StatusBadge status={r.status} /></td>
                  <td>{fmtDate(r.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export function AccessDetail() {
  const { id } = useParams();
  const toast = useToast();
  const { data, error, loading, reload } = useLoad(() => api.get(`/access-requests/${id}`), [id]);
  const [decision, setDecision] = useState(null);
  const [note, setNote] = useState('');
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  if (loading) return <Loading />;
  if (error) return <LoadError error={error} onRetry={reload} />;
  const r = data.request;
  const decide = async () => {
    setBusy(true); setErr(null);
    try { const x = await api.post(`/access-requests/${r.id}/decision`, { decision, note }); toast(x.message); setDecision(null); reload(); }
    catch (e) { setErr(e); } finally { setBusy(false); }
  };
  return (
    <div className="narrow-wide">
      <PageHeader title={`Information request ${r.reference}`} back="/staff/access" backLabel="Information requests" actions={<StatusBadge status={r.status} />} />
      <section className="panel">
        <DefinitionList items={[
          ['Requesting department', r.requesting_department],
          ['Requested by', `${r.requested_by_name} (${r.requested_by_number})`],
          ['Citizen', r.citizen_name],
          ['Application', r.application_reference ? `${r.application_reference}, ${r.service_name}` : null],
          ['Information requested', r.fields.map((f) => data.fieldLabels[f]).join(', ')],
          ['Purpose', r.purpose],
          ['Citizen consent', { not_required: 'Not required by policy', pending: 'Waiting for the citizen', given: `Given ${fmtDateTime(r.consent_at)}`, refused: 'Refused' }[r.consent_status]],
          ['Decision', r.decided_at ? `${r.decided_by_system ? 'Automatic' : r.decided_by_name}, ${fmtDateTime(r.decided_at)}` : 'Not decided yet'],
          ['Decision note', r.decision_note],
          ['Access ends', r.expires_at ? fmtDateTime(r.expires_at) : null],
        ]} />
        {data.canDecide && (
          <div className="button-row">
            <Button onClick={() => setDecision('approved')}>Approve</Button>
            <Button variant="danger" onClick={() => setDecision('denied')}>Deny</Button>
          </div>
        )}
      </section>
      <section className="panel">
        <h2 className="panel-title">Audit trail</h2>
        <ol className="timeline">
          {data.trail.map((t, i) => (
            <li key={i} className="timeline-item"><span className="timeline-dot" aria-hidden />
              <div><p className="timeline-title">{t.action.replaceAll('_', ' ').toLowerCase()}</p>
                <p className="timeline-meta">{fmtDateTime(t.at)}, {t.actor_label || t.actor_type}, {t.outcome}</p></div></li>
          ))}
        </ol>
      </section>
      <Modal open={!!decision} onClose={() => setDecision(null)} title={decision === 'approved' ? 'Approve this request?' : 'Deny this request?'}
        actions={<><Button variant="ghost" onClick={() => setDecision(null)}>Cancel</Button><Button variant={decision === 'denied' ? 'danger' : 'primary'} loading={busy} onClick={decide}>{decision === 'approved' ? 'Approve' : 'Deny'}</Button></>}>
        <ErrorSummary error={err} />
        <Textarea id="dnote" label="Reason for your decision" value={note} onChange={(e) => setNote(e.target.value)} error={err?.fields?.note} />
      </Modal>
    </div>
  );
}

// ---------------------------------------------------------------- identity checks (Home Affairs)
export function IdentityQueue() {
  const [status, setStatus] = useState('pending_office');
  const { data, error, loading, reload } = useLoad(() => api.get(`/staff/identity?status=${status}`), [status]);
  return (
    <div>
      <PageHeader title="Identity checks" intro="People the system could not match automatically with the population register. Verify only after seeing the original ID card." />
      <div className="tabs" role="tablist">
        {[['pending_office', 'Waiting'], ['unverified', 'No ID yet'], ['rejected', 'Not verified']].map(([k, l]) => (
          <button key={k} role="tab" aria-selected={status === k} className={`tab-btn${status === k ? ' on' : ''}`} onClick={() => setStatus(k)}>{l}</button>
        ))}
      </div>
      {loading ? <Loading /> : error ? <LoadError error={error} onRetry={reload} /> : data.citizens.length === 0 ? (
        <Empty icon={Fingerprint} title="Nobody is waiting" />
      ) : (
        <ul className="row-list panel">
          {data.citizens.map((c) => (
            <li key={c.id}><Link to={`/staff/identity/${c.id}`} className="row-link">
              <span className="row-main"><span className="row-title">{c.first_name} {c.surname}</span>
                <span className="row-sub">ID {c.national_id || 'none'}, born {fmtDate(c.date_of_birth)}, {c.district}. {c.verification_note}</span></span>
              <span className="btn btn-secondary btn-sm">Open</span>
            </Link></li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function IdentityDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const { data, error, loading, reload } = useLoad(() => api.get(`/staff/identity/${id}`), [id]);
  const [decision, setDecision] = useState(null);
  const [note, setNote] = useState('');
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  if (loading) return <Loading />;
  if (error) return <LoadError error={error} onRetry={reload} />;
  const { citizen: c, register: r } = data;
  const mismatch = (a, b) => r && String(a || '').toLowerCase() !== String(b || '').toLowerCase();
  const submit = async () => {
    setBusy(true); setErr(null);
    try { const x = await api.post(`/staff/identity/${c.id}`, { decision, note }); toast(x.message); navigate('/staff/identity'); }
    catch (e) { setErr(e); } finally { setBusy(false); }
  };
  return (
    <div className="narrow-wide">
      <PageHeader title={`${c.firstName} ${c.surname}`} back="/staff/identity" backLabel="Identity checks" actions={<StatusBadge status={c.status} />} />
      <Alert tone="info">{c.note}</Alert>
      <div className="table-wrap panel">
        <table className="table">
          <caption className="sr-only">Comparison with population register</caption>
          <thead><tr><th>Detail</th><th>Entered by the citizen</th><th>Population register</th></tr></thead>
          <tbody>
            {[['National ID', c.nationalId, c.nationalId && r ? c.nationalId : null], ['First name', c.firstName, r?.firstName], ['Surname', c.surname, r?.surname],
              ['Date of birth', c.dateOfBirth, r?.dateOfBirth], ['Sex', c.sex, r?.sex], ['District', c.district, r?.district]].map(([k, a, b]) => (
              <tr key={k} className={mismatch(a, b) ? 'row-mismatch' : ''}>
                <th scope="row">{k}</th><td>{a || '-'}</td><td>{r ? (b || '-') : 'No register record'}{mismatch(a, b) && <span className="tag tag-warn">Different</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {r?.lifeStatus === 'deceased' && <Alert tone="error">The register records this person as deceased. Do not verify. Refer to civil registration.</Alert>}
      {r?.isDemo && <p className="muted small">This register entry is demonstration data.</p>}
      <div className="button-row">
        <Button disabled={!r || r.lifeStatus === 'deceased'} onClick={() => setDecision('verify')}>Verify identity</Button>
        <Button variant="danger" onClick={() => setDecision('reject')}>Cannot verify</Button>
      </div>
      <Modal open={!!decision} onClose={() => setDecision(null)} title={decision === 'verify' ? 'Verify this identity?' : 'Mark as not verified?'}
        actions={<><Button variant="ghost" onClick={() => setDecision(null)}>Cancel</Button><Button loading={busy} variant={decision === 'reject' ? 'danger' : 'primary'} onClick={submit}>Confirm</Button></>}>
        <ErrorSummary error={err} />
        {decision === 'verify' && <p>Only verify after you have seen the original ID card. The account details will be corrected to match the register, and waiting applications continue automatically.</p>}
        <Textarea id="idnote" label={decision === 'verify' ? 'What did you check?' : 'Reason (shown to the citizen)'} value={note} onChange={(e) => setNote(e.target.value)} error={err?.fields?.note} />
      </Modal>
    </div>
  );
}

// ---------------------------------------------------------------- audit log
export function AuditLog() {
  const { staff } = useAuth();
  const [f, setF] = useState({ action: '', outcome: '', q: '', from: '', to: '', department: '', page: 1 });
  const [applied, setApplied] = useState(f);
  const qs = new URLSearchParams(Object.entries(applied).filter(([, v]) => v !== '' && v !== null)).toString();
  const { data, error, loading, reload } = useLoad(() => api.get(`/audit?${qs}`), [qs]);
  const depts = useLoad(() => (staff.role === 'admin' ? api.get('/admin/overview') : Promise.resolve(null)), []);
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;
  return (
    <div>
      <PageHeader title="Audit log" intro={staff.role === 'admin' ? 'Every access, change, request and decision across the system. Entries cannot be edited or deleted.' : `Every access, change, request and decision in ${staff.departmentName}. Entries cannot be edited or deleted.`}
        actions={<a className="btn btn-secondary" href={`/api/audit?${qs}&format=csv`}><Download size={18} aria-hidden /> <span>Download this page (CSV)</span></a>} />
      <form className="filters" onSubmit={(e) => { e.preventDefault(); setApplied({ ...f, page: 1 }); }}>
        <Select id="a-action" label="Action" value={f.action} onChange={(e) => setF({ ...f, action: e.target.value })}>
          <option value="">All actions</option>
          {(data?.actions || []).map((a) => <option key={a} value={a}>{a}</option>)}
        </Select>
        <Select id="a-outcome" label="Outcome" value={f.outcome} onChange={(e) => setF({ ...f, outcome: e.target.value })}>
          <option value="">All</option><option value="success">Success</option><option value="denied">Denied</option><option value="failed">Failed</option>
        </Select>
        {staff.role === 'admin' && (
          <Select id="a-dept" label="Department" value={f.department} onChange={(e) => setF({ ...f, department: e.target.value })}>
            <option value="">All</option>
            {(depts.data?.departments || []).map((d) => <option key={d.id} value={d.id}>{d.short_name}</option>)}
          </Select>
        )}
        <Input id="a-q" label="Search" value={f.q} onChange={(e) => setF({ ...f, q: e.target.value })} hint="Name, reference or detail" />
        <Input id="a-from" type="date" label="From" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} />
        <Input id="a-to" type="date" label="To" value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} />
        <Button type="submit" icon={Search}>Filter</Button>
      </form>
      {loading ? <Loading /> : error ? <LoadError error={error} onRetry={reload} /> : data.entries.length === 0 ? <Empty title="No entries match" /> : (
        <>
          <div className="table-wrap">
            <table className="table table-audit">
              <caption className="sr-only">Audit entries</caption>
              <thead><tr><th>Time</th><th>Who</th><th>Department</th><th>Action</th><th>Record</th><th>Outcome</th><th>Details</th></tr></thead>
              <tbody>
                {data.entries.map((e) => (
                  <tr key={e.id} className={e.outcome !== 'success' ? 'row-mismatch' : ''}>
                    <td className="nowrap">{fmtDateTime(e.at)}</td>
                    <td>{e.actor_label || e.actor_type}</td>
                    <td>{e.department || '-'}</td>
                    <td><code>{e.action}</code></td>
                    <td className="small">{e.entity_type ? `${e.entity_type} ${String(e.entity_id || '').slice(0, 13)}` : '-'}</td>
                    <td>{e.outcome}</td>
                    <td className="small details-cell">{(() => { const t = Object.entries(e.details || {}).map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : v}`).join('; '); return t.length > 180 ? `${t.slice(0, 180)}…` : t; })()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="pager">
            <Button variant="secondary" size="sm" disabled={applied.page <= 1} onClick={() => setApplied({ ...applied, page: applied.page - 1 })}>Previous</Button>
            <span>Page {applied.page} of {pages} ({data.total} entries)</span>
            <Button variant="secondary" size="sm" disabled={applied.page >= pages} onClick={() => setApplied({ ...applied, page: applied.page + 1 })}>Next</Button>
          </div>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- change password
export function StaffPassword() {
  const { staff, refresh } = useAuth();
  const [f, setF] = useState({ currentPassword: '', newPassword: '', confirm: '' });
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const navigate = useNavigate();
  const submit = async (e) => {
    e.preventDefault();
    if (f.newPassword !== f.confirm) { setErr({ message: 'The new passwords do not match.', fields: { confirm: 'The new passwords do not match.' } }); return; }
    setBusy(true); setErr(null);
    try {
      const r = await api.post('/auth/staff/change-password', { currentPassword: f.currentPassword, newPassword: f.newPassword });
      toast(r.message); await refresh(); navigate(staff.role === 'admin' ? '/staff/admin' : '/staff');
    } catch (x) { setErr(x); } finally { setBusy(false); }
  };
  return (
    <div className="narrow">
      <PageHeader title="Change password" intro={staff.mustChangePassword ? 'You are using a temporary password. Choose your own before you continue.' : undefined} />
      <ErrorSummary error={err} />
      <form onSubmit={submit} className="form" noValidate>
        <Input id="cp" type="password" label="Current password" value={f.currentPassword} onChange={(e) => setF({ ...f, currentPassword: e.target.value })} error={err?.fields?.currentPassword} autoComplete="current-password" />
        <Input id="np" type="password" label="New password" hint="At least 8 characters with a letter and a number." value={f.newPassword} onChange={(e) => setF({ ...f, newPassword: e.target.value })} error={err?.fields?.newPassword} autoComplete="new-password" />
        <Input id="np2" type="password" label="Type the new password again" value={f.confirm} onChange={(e) => setF({ ...f, confirm: e.target.value })} error={err?.fields?.confirm} autoComplete="new-password" />
        <Button type="submit" icon={KeyRound} loading={busy}>Save password</Button>
      </form>
    </div>
  );
}
