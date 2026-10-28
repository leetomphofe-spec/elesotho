import { useEffect, useRef, useState } from 'react';
import { Link, NavLink, Outlet, Navigate, useLocation, useNavigate } from 'react-router-dom';
import {
  Home, LayoutGrid, FileText, Bell, UserRound, LogOut, Type, Contrast, Landmark, BookUser, Car, Wallet, HandHeart, Shield,
  ClipboardList, KeyRound, ScrollText, Settings, Users, Building2, Share2, Fingerprint, Gauge, ShieldCheck,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext.jsx';
import { usePrefs } from '../context/PrefsContext.jsx';
import { api } from '../api.js';
import { Button, Loading, Modal } from './ui.jsx';

export const DEPT_ICONS = { HOME_AFFAIRS: Landmark, PASSPORT: BookUser, TRAFFIC: Car, FINANCE: Wallet, PENSION: HandHeart, POLICE: Shield };

export function Emblem({ size = 40 }) {
  // Simple original mark: a conical hat outline over a green smile line
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden focusable="false">
      <rect width="64" height="64" rx="14" fill="currentColor" className="emblem-bg" />
      <path d="M32 12 L50 44 H14 Z" fill="none" stroke="#fff" strokeWidth="4" strokeLinejoin="round" />
      <path d="M22 44 Q32 52 42 44" fill="none" stroke="#2BB673" strokeWidth="4" strokeLinecap="round" />
    </svg>
  );
}

function Brand({ to = '/', subtitle = 'Kingdom of Lesotho' }) {
  return (
    <Link to={to} className="brand">
      <Emblem />
      <span className="brand-text">
        <span className="brand-name">Government Services</span>
        <span className="brand-sub">{subtitle}</span>
      </span>
    </Link>
  );
}

export function DisplayOptions() {
  const { prefs, update } = usePrefs();
  const sizes = [['normal', 'A'], ['large', 'A+'], ['larger', 'A++']];
  return (
    <div className="display-options" role="group" aria-label="Display options">
      <span className="display-label"><Type size={16} aria-hidden /> Text size</span>
      {sizes.map(([v, l]) => (
        <button key={v} type="button" className={`chip${prefs.textSize === v ? ' chip-on' : ''}`} aria-pressed={prefs.textSize === v}
          onClick={() => update({ textSize: v })} aria-label={`Text size ${v}`}>{l}</button>
      ))}
      <button type="button" className={`chip${prefs.contrast === 'high' ? ' chip-on' : ''}`} aria-pressed={prefs.contrast === 'high'}
        onClick={() => update({ contrast: prefs.contrast === 'high' ? 'standard' : 'high' })}>
        <Contrast size={16} aria-hidden /> High contrast
      </button>
    </div>
  );
}

/** Warns before the idle timeout and lets the person stay signed in. */
function SessionWatch({ kind }) {
  const { expiresAt, setExpiresAt, logout, setEndedReason } = useAuth();
  const [left, setLeft] = useState(null);
  const navigate = useNavigate();
  useEffect(() => {
    if (!expiresAt) return undefined;
    const t = setInterval(() => setLeft(Math.round((new Date(expiresAt) - Date.now()) / 1000)), 1000);
    return () => clearInterval(t);
  }, [expiresAt]);
  useEffect(() => {
    if (left !== null && left <= 0) {
      logout().then(() => {
        setEndedReason('You were signed out after a period of inactivity to protect your information.');
        navigate(kind === 'staff' ? '/staff/login' : '/login');
      });
    }
  }, [left, kind, logout, navigate, setEndedReason]);
  const stay = async () => {
    const r = await api.get(kind === 'staff' ? '/auth/staff/me' : '/auth/me');
    setExpiresAt(r.sessionExpiresAt);
  };
  return (
    <Modal open={left !== null && left > 0 && left <= 60} title="Are you still there?" onClose={stay}
      actions={<><Button variant="secondary" onClick={() => logout().then(() => navigate('/'))}>Log out</Button><Button onClick={stay}>Stay signed in</Button></>}>
      <p>For your security you will be signed out in <strong>{left} seconds</strong>.</p>
    </Modal>
  );
}

function SkipLink() {
  return <a href="#main" className="skip-link">Skip to main content</a>;
}

function useFocusOnNavigate() {
  const { pathname } = useLocation();
  const ref = useRef(null);
  useEffect(() => { ref.current?.focus({ preventScroll: true }); window.scrollTo(0, 0); }, [pathname]);
  return ref;
}

export function PublicLayout() {
  const mainRef = useFocusOnNavigate();
  return (
    <div className="shell">
      <SkipLink />
      <header className="topbar">
        <div className="topbar-inner">
          <Brand />
          <nav className="topnav" aria-label="Main">
            <NavLink to="/login" className="topnav-link">Log in</NavLink>
            <NavLink to="/register" className="topnav-link topnav-cta">Create account</NavLink>
          </nav>
        </div>
        <div className="band" aria-hidden />
      </header>
      <main id="main" ref={mainRef} tabIndex={-1} className="main">
        <Outlet />
      </main>
      <Footer />
    </div>
  );
}

function Footer() {
  return (
    <footer className="footer">
      <div className="footer-inner">
        <DisplayOptions />
        <p className="footer-note">
          Some steps still need a visit to an office so an officer can see your original documents. This service tells you exactly what to bring.
        </p>
        <p className="footer-links"><Link to="/staff/login">Government staff sign in</Link></p>
      </div>
    </footer>
  );
}

const CITIZEN_NAV = [
  ['/home', 'Home', Home],
  ['/services', 'Services', LayoutGrid],
  ['/applications', 'My applications', FileText],
  ['/notifications', 'Notifications', Bell],
  ['/profile', 'Profile', UserRound],
];

export function CitizenLayout() {
  const { citizen, loading, logout } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const mainRef = useFocusOnNavigate();
  const [unread, setUnread] = useState(0);
  useEffect(() => {
    if (!citizen) return;
    api.get('/auth/me', { passive: true }).then((r) => setUnread(r.citizen.unreadNotifications)).catch(() => {});
  }, [citizen, location.pathname]);

  if (loading) return <Loading />;
  if (!citizen) return <Navigate to="/login" replace state={{ from: location.pathname }} />;

  return (
    <div className="shell has-tabbar">
      <SkipLink />
      <header className="topbar">
        <div className="topbar-inner">
          <Brand to="/home" />
          <nav className="topnav desktop-only" aria-label="Main">
            {CITIZEN_NAV.map(([to, label, Icon]) => (
              <NavLink key={to} to={to} className="topnav-link">
                <Icon size={18} aria-hidden /> {label}
                {to === '/notifications' && unread > 0 && <span className="count" aria-label={`${unread} unread`}>{unread}</span>}
              </NavLink>
            ))}
          </nav>
          <button type="button" className="topnav-link logout" onClick={() => logout().then(() => navigate('/'))}>
            <LogOut size={18} aria-hidden /> <span>Log out</span>
          </button>
        </div>
        <div className="band" aria-hidden />
      </header>
      <main id="main" ref={mainRef} tabIndex={-1} className="main">
        <Outlet />
      </main>
      <nav className="tabbar mobile-only" aria-label="Main">
        {CITIZEN_NAV.map(([to, label, Icon]) => (
          <NavLink key={to} to={to} className="tab">
            <span className="tab-icon"><Icon size={22} aria-hidden />{to === '/notifications' && unread > 0 && <span className="dot" />}</span>
            <span className="tab-label">{label === 'My applications' ? 'Applications' : label === 'Notifications' ? 'Alerts' : label}</span>
          </NavLink>
        ))}
      </nav>
      <Footer />
      <SessionWatch kind="citizen" />
    </div>
  );
}

export function StaffLayout() {
  const { staff, loading, logout } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const mainRef = useFocusOnNavigate();
  if (loading) return <Loading />;
  if (!staff) return <Navigate to="/staff/login" replace />;
  if (staff.mustChangePassword && location.pathname !== '/staff/password') return <Navigate to="/staff/password" replace />;

  const isAdmin = staff.role === 'admin';
  const nav = isAdmin
    ? [
      ['/staff/admin', 'Overview', Gauge, true],
      ['/staff/admin/staff', 'Staff accounts', Users],
      ['/staff/admin/services', 'Services and fees', ClipboardList],
      ['/staff/admin/offices', 'Offices', Building2],
      ['/staff/admin/sharing', 'Information sharing', Share2],
      ['/staff/admin/settings', 'Settings and register', Settings],
      ['/staff/audit', 'Audit log', ScrollText],
    ]
    : [
      ['/staff', 'Dashboard', Gauge, true],
      ['/staff/applications', 'Applications', ClipboardList],
      ...(staff.isDataOwner ? [['/staff/identity', 'Identity checks', Fingerprint]] : []),
      ['/staff/access', 'Information requests', Share2],
      ...(staff.role === 'supervisor' ? [['/staff/audit', 'Audit log', ScrollText]] : []),
    ];

  return (
    <div className="shell staff-shell">
      <SkipLink />
      <header className="topbar topbar-staff">
        <div className="topbar-inner">
          <Brand to={isAdmin ? '/staff/admin' : '/staff'} subtitle="Staff workspace" />
          <div className="staff-id">
            <ShieldCheck size={18} aria-hidden />
            <span>
              <strong>{staff.fullName}</strong>
              <span className="staff-meta">{staff.departmentName}, {staff.role === 'admin' ? 'Administrator' : staff.role === 'supervisor' ? 'Supervisor' : 'Officer'}</span>
            </span>
          </div>
          <button type="button" className="topnav-link logout" onClick={() => logout().then(() => navigate('/staff/login'))}>
            <LogOut size={18} aria-hidden /> <span>Log out</span>
          </button>
        </div>
      </header>
      <div className="staff-body">
        <nav className="sidenav" aria-label="Staff">
          {nav.map(([to, label, Icon, end]) => (
            <NavLink key={to} to={to} end={end} className="sidenav-link"><Icon size={18} aria-hidden /> {label}</NavLink>
          ))}
          <NavLink to="/staff/password" className="sidenav-link"><KeyRound size={18} aria-hidden /> Change password</NavLink>
        </nav>
        <main id="main" ref={mainRef} tabIndex={-1} className="main staff-main">
          <Outlet />
        </main>
      </div>
      <SessionWatch kind="staff" />
    </div>
  );
}
