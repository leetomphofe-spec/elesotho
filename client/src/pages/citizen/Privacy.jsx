import { useState } from 'react';
import { ShieldQuestion, Eye } from 'lucide-react';
import { api, fmtDate, fmtDateTime } from '../../api.js';
import { Alert, Button, Empty, LoadError, Loading, Modal, PageHeader, StatusBadge, useLoad, useToast } from '../../components/ui.jsx';

const ACTION_TEXT = {
  VIEW_CITIZEN_RECORD: 'Opened your record',
  ACCESS_REQUEST_DECIDED: 'Information request decided',
  ACCESS_EXPIRED: 'Access ended automatically',
  IDENTITY_VERIFIED: 'Identity verified',
  IDENTITY_REJECTED: 'Identity not verified',
  APPLICATION_STATUS_CHANGED: 'Application status changed',
};

export default function Privacy() {
  const { data, error, loading, reload } = useLoad(() => api.get('/citizen/privacy'), []);
  const [confirm, setConfirm] = useState(null);
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  if (loading) return <Loading />;
  if (error) return <LoadError error={error} onRetry={reload} />;
  const labels = data.fieldLabels;
  const pending = data.requests.filter((r) => r.status === 'pending_consent');
  const active = data.requests.filter((r) => r.status === 'approved');
  const past = data.requests.filter((r) => !['pending_consent', 'approved'].includes(r.status));

  const act = async () => {
    setBusy(true);
    try {
      const r = confirm.kind === 'revoke'
        ? await api.post(`/citizen/access/${confirm.req.id}/revoke`)
        : await api.post(`/citizen/consents/${confirm.req.id}`, { decision: confirm.kind });
      toast(r.message); setConfirm(null); reload();
    } catch (err) { toast(err.message, 'error'); } finally { setBusy(false); }
  };
  const fieldList = (fields) => fields.map((f) => labels[f] || f).join(', ');

  return (
    <div className="narrow-wide">
      <PageHeader title="Who can see my information" back="/profile" backLabel="Profile"
        intro="Each department only sees the details it needs. If a department needs more, it must ask, and you are told why." />

      <section className="panel">
        <h2 className="panel-title">Requests waiting for you</h2>
        {pending.length === 0 ? <p className="muted">No requests are waiting for your answer.</p> : pending.map((r) => (
          <article key={r.id} className="consent">
            <p className="consent-who"><ShieldQuestion size={20} aria-hidden /> <strong>{r.department_name}</strong> asks to see:</p>
            <p className="consent-fields">{fieldList(r.fields)}</p>
            <p><span className="muted">Reason given:</span> {r.purpose}</p>
            {r.application_reference && <p className="muted small">Linked to your application {r.application_reference}. Asked on {fmtDate(r.created_at)}.</p>}
            <div className="button-row">
              <Button onClick={() => setConfirm({ kind: 'give', req: r })}>Allow</Button>
              <Button variant="secondary" onClick={() => setConfirm({ kind: 'refuse', req: r })}>Refuse</Button>
            </div>
          </article>
        ))}
      </section>

      <section className="panel">
        <h2 className="panel-title">Access you have allowed</h2>
        {active.length === 0 ? <p className="muted">No extra access is active.</p> : (
          <ul className="row-list">
            {active.map((r) => (
              <li key={r.id} className="row">
                <span className="row-main">
                  <span className="row-title">{r.department_name}: {fieldList(r.fields)}</span>
                  <span className="row-sub">Ends automatically on {fmtDate(r.expires_at)}. {r.purpose}</span>
                </span>
                <Button variant="secondary" size="sm" onClick={() => setConfirm({ kind: 'revoke', req: r })}>Withdraw</Button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="panel">
        <h2 className="panel-title"><Eye size={20} aria-hidden /> Activity on your record</h2>
        {data.accessLog.length === 0 ? <Empty title="No activity yet">When an officer opens your record, it is listed here.</Empty> : (
          <div className="table-wrap">
            <table className="table">
              <caption className="sr-only">Activity on your record</caption>
              <thead><tr><th>When</th><th>Department</th><th>What happened</th><th>Details</th></tr></thead>
              <tbody>
                {data.accessLog.map((l, i) => (
                  <tr key={i}>
                    <td>{fmtDateTime(l.at)}</td>
                    <td>{l.department || 'System'}</td>
                    <td>{ACTION_TEXT[l.action] || l.action}</td>
                    <td className="small">{l.fields ? `Saw: ${fieldList(l.fields)}` : ''}{l.purpose ? ` (${l.purpose})` : ''}{l.reference ? ` ${l.reference}` : ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {past.length > 0 && (
        <section className="panel">
          <h2 className="panel-title">Past requests</h2>
          <ul className="row-list">
            {past.map((r) => (
              <li key={r.id} className="row">
                <span className="row-main">
                  <span className="row-title">{r.department_name}: {fieldList(r.fields)}</span>
                  <span className="row-sub">{r.decision_note || r.purpose}</span>
                </span>
                <StatusBadge status={r.status} />
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="panel">
        <h2 className="panel-title">What each department sees by default</h2>
        <ul className="row-list">
          {data.departmentDefaults.map((d) => (
            <li key={d.name} className="row"><span className="row-main"><span className="row-title">{d.name}</span><span className="row-sub">{fieldList(d.fields)}</span></span></li>
          ))}
        </ul>
      </section>

      <Modal open={!!confirm} onClose={() => setConfirm(null)}
        title={confirm?.kind === 'give' ? 'Allow access?' : confirm?.kind === 'refuse' ? 'Refuse access?' : 'Withdraw access?'}
        actions={<>
          <Button variant="ghost" onClick={() => setConfirm(null)}>Go back</Button>
          <Button loading={busy} variant={confirm?.kind === 'give' ? 'primary' : 'danger'} onClick={act}>
            {confirm?.kind === 'give' ? 'Allow' : confirm?.kind === 'refuse' ? 'Refuse' : 'Withdraw access'}
          </Button>
        </>}>
        {confirm && (
          <>
            <p><strong>{confirm.req.department_name}</strong> {confirm.kind === 'revoke' ? 'will no longer see' : 'will see'}: {fieldList(confirm.req.fields)}.</p>
            {confirm.kind === 'give' && <Alert tone="info">Access ends automatically after a set number of days. You can withdraw it at any time on this page.</Alert>}
            {confirm.kind === 'refuse' && <p>This may slow down your application if the department needs these details. They may ask you to bring them to the office instead.</p>}
          </>
        )}
      </Modal>
    </div>
  );
}
