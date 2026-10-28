import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { BellOff, CheckCheck, CalendarClock, MessageSquareWarning, BadgeCheck, FileWarning, ShieldQuestion, Info, ArrowRight } from 'lucide-react';
import { api, fmtDateTime } from '../../api.js';
import { Button, Empty, LoadError, Loading, PageHeader, useLoad, useToast } from '../../components/ui.jsx';

const ICONS = {
  visit_reminder: CalendarClock, visit_booked: CalendarClock, info_required: MessageSquareWarning, completed: BadgeCheck,
  checklist_incomplete: FileWarning, consent_request: ShieldQuestion, status_changed: Info, system: Info,
};

export default function Notifications() {
  const { data, error, loading, reload, setData } = useLoad(() => api.get('/citizen/notifications'), []);
  const [filter, setFilter] = useState('all');
  const [open, setOpen] = useState(null);
  const navigate = useNavigate();
  const toast = useToast();
  if (loading) return <Loading />;
  if (error) return <LoadError error={error} onRetry={reload} />;

  const list = data.notifications.filter((n) => filter === 'all' || !n.is_read);
  const unread = data.notifications.filter((n) => !n.is_read).length;

  const markRead = async (n) => {
    if (n.is_read) return;
    await api.post(`/citizen/notifications/${n.id}/read`).catch(() => {});
    setData((d) => ({ notifications: d.notifications.map((x) => (x.id === n.id ? { ...x, is_read: true } : x)) }));
  };
  const toggle = (n) => { setOpen(open === n.id ? null : n.id); markRead(n); };
  const readAll = async () => {
    const r = await api.post('/citizen/notifications/read-all');
    setData((d) => ({ notifications: d.notifications.map((x) => ({ ...x, is_read: true })) }));
    toast(`${r.updated} notification${r.updated === 1 ? '' : 's'} marked as read.`);
  };

  return (
    <div className="narrow-wide">
      <PageHeader title="Notifications" intro="Messages from this service about your applications and visits. Officers never ask for your password."
        actions={unread > 0 && <Button variant="secondary" icon={CheckCheck} onClick={readAll}>Mark all as read</Button>} />
      <div className="tabs" role="tablist" aria-label="Filter notifications">
        <button role="tab" aria-selected={filter === 'all'} className={`tab-btn${filter === 'all' ? ' on' : ''}`} onClick={() => setFilter('all')}>All ({data.notifications.length})</button>
        <button role="tab" aria-selected={filter === 'unread'} className={`tab-btn${filter === 'unread' ? ' on' : ''}`} onClick={() => setFilter('unread')}>Unread ({unread})</button>
      </div>
      {list.length === 0 ? <Empty icon={BellOff} title={filter === 'unread' ? 'You have read everything' : 'No notifications yet'} /> : (
        <ul className="notif-list">
          {list.map((n) => {
            const Icon = ICONS[n.type] || Info;
            const isOpen = open === n.id;
            return (
              <li key={n.id} className={`notif${n.is_read ? '' : ' unread'}`}>
                <button type="button" className="notif-head" aria-expanded={isOpen} onClick={() => toggle(n)}>
                  <Icon size={22} aria-hidden className="notif-icon" />
                  <span className="notif-text">
                    <span className="notif-title">{!n.is_read && <span className="unread-dot" aria-label="Unread" />}{n.title}</span>
                    <span className="notif-time">{fmtDateTime(n.created_at)}</span>
                  </span>
                </button>
                {isOpen && (
                  <div className="notif-body">
                    <p>{n.body}</p>
                    {n.link && <Button variant="secondary" size="sm" icon={ArrowRight} onClick={() => navigate(n.link)}>Open</Button>}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
