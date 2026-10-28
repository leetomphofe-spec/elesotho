import { Link } from 'react-router-dom';
import { CalendarClock, ChevronRight, ShieldAlert, BookUser, RefreshCw, HandHeart, Car, Shield, BellRing, UserRound } from 'lucide-react';
import { api, fmtDateTime, fmtDate } from '../../api.js';
import { Alert, Empty, LinkButton, LoadError, Loading, StatusBadge, useLoad } from '../../components/ui.jsx';
import { DEPT_ICONS } from '../../components/Layouts.jsx';

const QUICK = [
  ['/passport/new', 'New passport', BookUser],
  ['/passport/replace', 'Replace passport', RefreshCw],
  ['/services/PENSION', 'Pension services', HandHeart],
  ['/service/DRIVING_LICENCE_RENEWAL', 'Renew driving licence', Car],
  ['/service/POLICE_CLEARANCE', 'Police clearance', Shield],
];

export default function Dashboard() {
  const { data, error, loading, reload } = useLoad(() => Promise.all([api.get('/citizen/dashboard'), api.get('/catalogue/departments')]), []);
  if (loading) return <Loading />;
  if (error) return <LoadError error={error} onRetry={reload} />;
  const [d, cat] = data;
  const c = d.citizen;

  return (
    <div className="dashboard">
      <section className="greeting">
        <h1 className="page-title">Dumela, {c.firstName}</h1>
        <p className="page-intro">
          {d.summary.actionNeeded > 0
            ? `${d.summary.actionNeeded} application${d.summary.actionNeeded === 1 ? ' needs' : 's need'} something from you.`
            : 'Nothing needs your attention right now.'}
        </p>
      </section>

      {c.verificationStatus !== 'verified' && (
        <Alert tone="warning" title="Your identity is not verified yet" action={<LinkButton to="/profile" variant="secondary" size="sm">See what to do</LinkButton>}>
          {c.verificationNote}
        </Alert>
      )}
      {d.pendingConsents > 0 && (
        <Alert tone="warning" title={`${d.pendingConsents} department request${d.pendingConsents === 1 ? '' : 's'} waiting for your consent`}
          action={<LinkButton to="/privacy" variant="secondary" size="sm">Review requests</LinkButton>}>
          A department has asked to see some of your personal information. Nothing is shared until you decide.
        </Alert>
      )}

      <div className="dash-grid">
        <div className="dash-main">
          <section className="panel" aria-labelledby="quick">
            <h2 id="quick" className="panel-title">Start a service</h2>
            <ul className="quick-list">
              {QUICK.map(([to, label, Icon]) => (
                <li key={to}><Link to={to} className="quick"><Icon size={22} aria-hidden /><span>{label}</span><ChevronRight size={18} aria-hidden className="quick-arrow" /></Link></li>
              ))}
            </ul>
          </section>

          <section className="panel" aria-labelledby="visits">
            <h2 id="visits" className="panel-title"><CalendarClock size={20} aria-hidden /> Upcoming office visits</h2>
            {d.upcomingVisits.length === 0 ? (
              <p className="muted">No visits booked. When you book one, the date, office and what to bring appear here.</p>
            ) : (
              <ul className="visit-list">
                {d.upcomingVisits.map((v) => (
                  <li key={v.id}>
                    <Link to={`/applications/${v.id}`} className="visit">
                      <span className="visit-when">{fmtDateTime(v.starts_at)}</span>
                      <span className="visit-what">{v.service_name}</span>
                      <span className="visit-where">{v.office_name}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="panel" aria-labelledby="recent">
            <div className="panel-head">
              <h2 id="recent" className="panel-title">Recent applications</h2>
              <Link to="/applications">See all</Link>
            </div>
            {d.recentApplications.length === 0 ? (
              <Empty title="No applications yet" action={<LinkButton to="/services">Browse services</LinkButton>}>
                Choose a service to see what you need and book a visit.
              </Empty>
            ) : (
              <ul className="row-list">
                {d.recentApplications.map((a) => (
                  <li key={a.id}>
                    <Link to={`/applications/${a.id}`} className="row-link">
                      <span className="row-main">
                        <span className="row-title">{a.service_name}</span>
                        <span className="row-sub">{a.reference}, {a.department_name}, updated {fmtDate(a.last_status_at)}</span>
                      </span>
                      <StatusBadge status={a.status} label={a.status_label} />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        <aside className="dash-side">
          <section className="panel" aria-labelledby="me">
            <h2 id="me" className="panel-title"><UserRound size={20} aria-hidden /> Your profile</h2>
            <p className="profile-name">{c.firstName} {c.surname}</p>
            <p className="muted">ID {c.nationalIdMasked || 'not on record'}</p>
            <StatusBadge status={c.verificationStatus} />
            <p><Link to="/profile">View or update profile</Link></p>
            <p><Link to="/privacy">Who can see my information</Link></p>
          </section>

          <section className="panel" aria-labelledby="notes">
            <div className="panel-head">
              <h2 id="notes" className="panel-title"><BellRing size={20} aria-hidden /> Notifications</h2>
              <Link to="/notifications">All</Link>
            </div>
            {d.notifications.length === 0 ? <p className="muted">No notifications yet.</p> : (
              <ul className="note-list">
                {d.notifications.map((n) => (
                  <li key={n.id} className={n.is_read ? '' : 'unread'}>
                    <Link to={n.link || '/notifications'}>
                      <span className="note-title">{!n.is_read && <span className="sr-only">Unread: </span>}{n.title}</span>
                      <span className="note-time">{fmtDateTime(n.created_at)}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="panel" aria-labelledby="alld">
            <h2 id="alld" className="panel-title">All departments</h2>
            <ul className="mini-dept">
              {cat.departments.map((dep) => {
                const Icon = DEPT_ICONS[dep.code];
                return (
                  <li key={dep.code}>
                    <Link to={dep.code === 'PASSPORT' ? '/passport' : `/services/${dep.code}`}><Icon size={18} aria-hidden /> {dep.name}</Link>
                  </li>
                );
              })}
            </ul>
          </section>
          {c.verificationStatus === 'verified' && (
            <p className="muted small"><ShieldAlert size={14} aria-hidden /> Your identity was verified {c.verifiedAt ? `on ${fmtDate(c.verifiedAt)}` : ''}. Departments use this record so you do not have to repeat your details.</p>
          )}
        </aside>
      </div>
    </div>
  );
}
