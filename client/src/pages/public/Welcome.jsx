import { Navigate } from 'react-router-dom';
import { ClipboardCheck, CalendarClock, Building, Activity, MapPin } from 'lucide-react';
import { useAuth } from '../../context/AuthContext.jsx';
import { api } from '../../api.js';
import { LinkButton, useLoad } from '../../components/ui.jsx';
import { DEPT_ICONS } from '../../components/Layouts.jsx';

const STEPS = [
  [ClipboardCheck, 'See exactly what to bring', 'Each service shows only the documents and fee that apply to you, as a checklist.'],
  [CalendarClock, 'Book one office visit', 'Pick an office in your district and a time that suits you. No queuing to ask questions.'],
  [Building, 'Bring your originals', 'An officer checks your documents once. Your details are already on file.'],
  [Activity, 'Follow your application', 'See every status change and get a message when something is needed from you.'],
];

export default function Welcome() {
  const { citizen, staff } = useAuth();
  const { data } = useLoad(() => api.get('/catalogue/departments'), []);
  if (citizen) return <Navigate to="/home" replace />;
  if (staff) return <Navigate to={staff.role === 'admin' ? '/staff/admin' : '/staff'} replace />;

  return (
    <div className="welcome">
      <section className="hero">
        <div className="hero-copy">
          <h1 className="hero-title">Prepare once.<br />Visit once.</h1>
          <p className="hero-lead">
            Home Affairs, Passports, Traffic, Finance, Pensions and Police services in one account.
            Know what to bring before you travel, book your visit, and follow your application from home.
          </p>
          <div className="hero-actions">
            <LinkButton to="/register" size="lg">Create account</LinkButton>
            <LinkButton to="/login" variant="secondary" size="lg">Log in</LinkButton>
          </div>
          <p className="hero-small">You can log in with your National ID number, phone number or email. Email is not required.</p>
        </div>
        <ol className="hero-steps" aria-label="How it works">
          {STEPS.map(([Icon, title, text], i) => (
            <li key={title} className="hero-step">
              <span className="hero-step-num" aria-hidden>{i + 1}</span>
              <div>
                <p className="hero-step-title"><Icon size={18} aria-hidden /> {title}</p>
                <p className="hero-step-text">{text}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      <section className="section" aria-labelledby="depts">
        <h2 id="depts" className="section-title">Departments you can reach here</h2>
        <ul className="dept-list">
          {(data?.departments || []).map((d) => {
            const Icon = DEPT_ICONS[d.code];
            return (
              <li key={d.code} className="dept-row">
                <span className="dept-icon"><Icon size={24} aria-hidden /></span>
                <span>
                  <span className="dept-name">{d.name}</span>
                  <span className="dept-desc">{d.description}</span>
                </span>
              </li>
            );
          })}
        </ul>
      </section>

      <section className="section split" aria-labelledby="online">
        <div>
          <h2 id="online" className="section-title">What you can do online</h2>
          <ul className="ticks">
            <li>Check requirements and fees for each service</li>
            <li>Prepare your document checklist</li>
            <li>Choose an office and book a visit time</li>
            <li>Track your application and answer questions from officers</li>
            <li>Decide which departments may see your personal information</li>
          </ul>
        </div>
        <div>
          <h2 className="section-title">What still needs an office visit</h2>
          <ul className="ticks ticks-office">
            <li>Showing your original documents to an officer</li>
            <li>Photo, fingerprint and signature capture</li>
            <li>Paying fees, where the office requires it</li>
            <li>Collecting your passport, ID card or certificate</li>
          </ul>
          <p className="muted small"><MapPin size={14} aria-hidden /> Offices in all ten districts are listed when you book.</p>
        </div>
      </section>
    </div>
  );
}
