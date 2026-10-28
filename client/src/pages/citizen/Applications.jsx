import { useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { FileText, CalendarClock, MapPin, ArrowRight, MessageSquare, XCircle, CalendarSync } from 'lucide-react';
import { api, fmtDate, fmtDateTime, fmtLongDay, money } from '../../api.js';
import {
  Alert, Button, DefinitionList, Empty, LinkButton, LoadError, Loading, Modal, PageHeader, ProgressBar, StatusBadge, Textarea, useLoad, useToast,
} from '../../components/ui.jsx';

const FILTERS = [['open', 'In progress'], ['action', 'Needs my action'], ['closed', 'Finished'], ['all', 'All']];
const isOpen = (s) => !['completed', 'rejected', 'cancelled'].includes(s);
const needsAction = (s) => ['draft', 'preparing_documents', 'additional_info_required'].includes(s);

export function MyApplications() {
  const [params] = useSearchParams();
  const dept = params.get('department');
  const [filter, setFilter] = useState('all');
  const { data, error, loading, reload } = useLoad(() => api.get('/applications'), []);
  if (loading) return <Loading />;
  if (error) return <LoadError error={error} onRetry={reload} />;
  let list = data.applications;
  if (dept) list = list.filter((a) => a.department_code === dept);
  list = list.filter((a) => filter === 'all' || (filter === 'open' ? isOpen(a.status) : filter === 'action' ? needsAction(a.status) : !isOpen(a.status)));

  return (
    <div>
      <PageHeader title={dept === 'PASSPORT' ? 'My passport applications' : 'My applications'}
        back={dept === 'PASSPORT' ? '/passport' : undefined} backLabel="Passport Services"
        intro="Open an application to see its progress, your visit details and any messages from the department." />
      <div className="tabs" role="tablist" aria-label="Filter applications">
        {FILTERS.map(([k, l]) => (
          <button key={k} role="tab" aria-selected={filter === k} className={`tab-btn${filter === k ? ' on' : ''}`} onClick={() => setFilter(k)}>{l}</button>
        ))}
      </div>
      {list.length === 0 ? (
        <Empty icon={FileText} title={filter === 'all' ? 'No applications yet' : 'Nothing here'} action={<LinkButton to="/services">Browse services</LinkButton>}>
          {filter === 'all' ? 'When you start a service it appears here, with its status.' : 'Try another filter.'}
        </Empty>
      ) : (
        <div className="table-wrap">
          <table className="table table-apps">
            <caption className="sr-only">Your applications</caption>
            <thead>
              <tr><th>Reference</th><th>Service</th><th>Started</th><th>Office</th><th>Status</th><th>Last update</th><th><span className="sr-only">Open</span></th></tr>
            </thead>
            <tbody>
              {list.map((a) => (
                <tr key={a.id}>
                  <td data-label="Reference"><code>{a.reference}</code></td>
                  <td data-label="Service">{a.service_name}{a.applicant_category === 'minor' && a.applicant?.firstName ? <span className="muted small"> for {a.applicant.firstName}</span> : null}</td>
                  <td data-label="Started">{fmtDate(a.created_at)}</td>
                  <td data-label="Office">{a.office_name || <span className="muted">Not chosen</span>}</td>
                  <td data-label="Status"><StatusBadge status={a.status} label={a.status_label} /></td>
                  <td data-label="Last update">{fmtDate(a.last_status_at)}</td>
                  <td><Link to={`/applications/${a.id}`} className="btn btn-secondary btn-sm">View application</Link></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

const STAGES = ['draft', 'preparing_documents', 'ready_for_visit', 'submitted', 'under_review', 'completed'];

export function ApplicationDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const { data, error, loading, reload } = useLoad(() => api.get(`/applications/${id}`), [id]);
  const [cancel, setCancel] = useState(false);
  const [reply, setReply] = useState('');
  const [replyErr, setReplyErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const [move, setMove] = useState(false);

  if (loading) return <Loading />;
  if (error) return <LoadError error={error} onRetry={reload} />;
  const { application: a, requirements, progress, office, slot, events, infoRequests, documentChecks, actions } = data;
  const openInfo = infoRequests.find((i) => !i.responded_at);
  const stageIdx = STAGES.indexOf(a.status === 'additional_info_required' ? 'under_review' : a.status);
  const fee = data.fees.find((f) => f.id === a.feeId);
  const resume = `/apply/${a.service.code}?app=${a.id}`;

  const doCancel = async () => {
    setBusy(true);
    try { const r = await api.post(`/applications/${a.id}/cancel`); toast(r.message); setCancel(false); reload(); }
    catch (err) { toast(err.message, 'error'); } finally { setBusy(false); }
  };
  const sendReply = async () => {
    if (reply.trim().length < 2) { setReplyErr('Write your answer.'); return; }
    setBusy(true); setReplyErr(null);
    try { const r = await api.post(`/applications/${a.id}/respond`, { infoRequestId: openInfo.id, response: reply }); toast(r.message); setReply(''); reload(); }
    catch (err) { setReplyErr(err.fields?.response || err.message); } finally { setBusy(false); }
  };

  return (
    <div className="narrow-wide">
      <PageHeader title={a.service.name} back="/applications" backLabel="My applications"
        intro={<>Reference <code>{a.reference}</code>, {a.department.name}{a.category === 'minor' && a.applicant?.firstName ? `, for ${a.applicant.firstName} ${a.applicant.surname}` : ''}</>} />

      <section className="panel status-panel">
        <div className="panel-head">
          <div>
            <p className="muted small">Current status</p>
            <p className="status-big"><StatusBadge status={a.status} label={a.statusLabel} /></p>
          </div>
          <p className="muted small">Last update {fmtDateTime(a.lastStatusAt)}</p>
        </div>
        {a.statusReason && <p className="status-reason">{a.statusReason}</p>}
        {!['rejected', 'cancelled'].includes(a.status) && (
          <ol className="track" aria-label="Progress">
            {STAGES.map((s, i) => (
              <li key={s} className={i < stageIdx ? 'done' : i === stageIdx ? 'current' : ''} aria-current={i === stageIdx ? 'step' : undefined}>
                <span className="track-dot" aria-hidden />
                <span className="track-label">{{ draft: 'Started', preparing_documents: 'Documents', ready_for_visit: 'Visit booked', submitted: 'Documents checked', under_review: 'Review', completed: 'Completed' }[s]}</span>
              </li>
            ))}
          </ol>
        )}
        {a.status === 'completed' && <Alert tone="info">Completed means the department has finished processing. Collect your document at the office and bring your ID card. Passports and certificates are only issued in person.</Alert>}
      </section>

      {actions.needsNewVisit && openInfo && (
        <Alert tone="warning" title="Bring the missing documents" action={<LinkButton to={resume} size="sm">Book a new visit</LinkButton>}>{openInfo.message}</Alert>
      )}
      {actions.canRespond && openInfo && (
        <section className="panel panel-warn">
          <h2 className="panel-title"><MessageSquare size={20} aria-hidden /> The department asks</h2>
          <p className="quote">{openInfo.message}</p>
          <Textarea id="reply" label="Your answer" value={reply} onChange={(e) => setReply(e.target.value)} error={replyErr} />
          <Button loading={busy} onClick={sendReply}>Send answer</Button>
        </section>
      )}
      {openInfo?.kind === 'identity' && (
        <Alert tone="warning" title="Identity check needed">{openInfo.message} Your application continues automatically once you are verified.</Alert>
      )}
      {['draft', 'preparing_documents'].includes(a.status) && (
        <Alert tone="info" title="This application is not finished" action={<LinkButton to={resume} size="sm" icon={ArrowRight}>Continue application</LinkButton>}>
          {progress.done} of {progress.total} documents confirmed{a.service.requiresAppointment ? ', and no visit booked yet.' : '.'}
        </Alert>
      )}

      <div className="detail-grid">
        <section className="panel">
          <h2 className="panel-title"><CalendarClock size={20} aria-hidden /> Office visit</h2>
          {slot ? (
            <>
              <DefinitionList items={[['Date', fmtLongDay(slot.day)], ['Time', slot.time], ['Office', office?.name], ['Address', office?.location], ['Phone', office?.phone || 'Contact number not available'], ['Hours', office?.hours]]} />
              {actions.canReschedule && <Button variant="secondary" size="sm" icon={CalendarSync} onClick={() => setMove(true)}>Move visit</Button>}
            </>
          ) : office ? (
            <p><MapPin size={16} aria-hidden /> {office.name}. No time booked.</p>
          ) : <p className="muted">{a.service.requiresAppointment ? 'Not booked yet.' : 'No visit is needed for this service unless the department asks.'}</p>}
        </section>
        <section className="panel">
          <h2 className="panel-title">Documents</h2>
          <ProgressBar done={progress.done} total={progress.total} />
          <ul className="ticks small">
            {requirements.map((r) => {
              const check = documentChecks.find((c) => c.requirement_id === r.id);
              return (
                <li key={r.id} className={a.checklist?.[r.id] ? '' : 'tick-no'}>
                  {r.label}{r.is_fee && fee ? `: ${money(fee.amount)}` : ''}
                  {check && <span className={`check-result check-${check.result}`}> Office check: {check.result}</span>}
                </li>
              );
            })}
          </ul>
        </section>
      </div>

      <section className="panel">
        <h2 className="panel-title">History</h2>
        <ol className="timeline">
          {[...events].reverse().map((e, i) => (
            <li key={i} className="timeline-item">
              <span className="timeline-dot" aria-hidden />
              <div>
                <p className="timeline-title">{e.from_status === e.to_status ? 'Updated' : e.to_label}</p>
                {e.note && <p className="timeline-note">{e.note}</p>}
                <p className="timeline-meta">{fmtDateTime(e.created_at)}, {e.actor_type === 'system' ? 'automatic' : e.actor_type === 'staff' ? 'by an officer' : 'by you'}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      {infoRequests.some((i) => i.responded_at) && (
        <section className="panel">
          <h2 className="panel-title">Messages</h2>
          {infoRequests.filter((i) => i.responded_at).map((i) => (
            <div key={i.id} className="message"><p className="quote">{i.message}</p><p><strong>Your answer:</strong> {i.response}</p></div>
          ))}
        </section>
      )}

      <div className="button-row">
        {actions.canCancel && <Button variant="danger" icon={XCircle} onClick={() => setCancel(true)}>Cancel application</Button>}
        <Button variant="ghost" onClick={() => navigate('/applications')}>Back to my applications</Button>
      </div>

      <Modal open={cancel} title="Cancel this application?" onClose={() => setCancel(false)}
        actions={<><Button variant="ghost" onClick={() => setCancel(false)}>Keep application</Button><Button variant="danger" loading={busy} onClick={doCancel}>Yes, cancel it</Button></>}>
        <p>{a.status === 'ready_for_visit' ? 'Your visit will be released so someone else can use it.' : 'You can start a new application later.'} This cannot be undone.</p>
      </Modal>
      {move && office && <MoveVisit app={a} office={office} onClose={() => setMove(false)} onDone={() => { setMove(false); reload(); }} />}
    </div>
  );
}

function MoveVisit({ app, office, onClose, onDone }) {
  const { data, loading } = useLoad(() => api.get(`/catalogue/offices/${office.id}/slots`), [office.id]);
  const [sel, setSel] = useState('');
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const all = (data?.days || []).flatMap((d) => d.slots.filter((s) => s.available > 0).map((s) => ({ ...s, day: d.day })));
  const save = async () => {
    if (!sel) { setErr('Choose a new time.'); return; }
    setBusy(true);
    try { const r = await api.post(`/applications/${app.id}/reschedule`, { slotId: Number(sel) }); toast(r.message); onDone(); }
    catch (e) { setErr(e.message); } finally { setBusy(false); }
  };
  return (
    <Modal open title="Move your visit" onClose={onClose}
      actions={<><Button variant="ghost" onClick={onClose}>Keep current time</Button><Button loading={busy} onClick={save}>Move visit</Button></>}>
      {loading ? <Loading /> : (
        <>
          {err && <Alert tone="error">{err}</Alert>}
          <label className="field-label" htmlFor="newslot">New time at {office.name}</label>
          <select id="newslot" className="input" value={sel} onChange={(e) => setSel(e.target.value)}>
            <option value="">Choose a time</option>
            {all.slice(0, 150).map((s) => <option key={s.id} value={s.id}>{fmtLongDay(s.day)}, {s.time} ({s.available} left)</option>)}
          </select>
          <p className="muted small">Your current place is released when you move.</p>
        </>
      )}
    </Modal>
  );
}
