import { useEffect, useState } from 'react';
import { getMyNotifications, markAsRead, markAllAsRead } from '../api/notifications';
import { formatDate } from '../utils/formatters';
import Spinner from '../components/ui/Spinner';
import EmptyState from '../components/ui/EmptyState';
import Button from '../components/ui/Button';
import Card from '../components/ui/Card';

export default function NotificationsPage() {
  const [notifications, setNotifications] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = () => {
    setLoading(true);
    getMyNotifications()
      .then(({ data }) => setNotifications(data))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  const handleMarkRead = async (id) => {
    setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, is_read: true } : n)));
    try {
      await markAsRead(id);
    } catch {
      load(); // resync on failure
    }
  };

  const handleMarkAllRead = async () => {
    setNotifications((prev) => prev.map((n) => ({ ...n, is_read: true })));
    try {
      await markAllAsRead();
    } catch {
      load();
    }
  };

  const unreadCount = notifications.filter((n) => !n.is_read).length;

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-xl font-semibold text-ink">Notifications</h1>
          <p className="mt-1 text-sm text-slate-500">Updates on your quotes and orders.</p>
        </div>
        {unreadCount > 0 && (
          <Button variant="secondary" onClick={handleMarkAllRead}>
            Mark all as read
          </Button>
        )}
      </div>

      {loading ? (
        <Spinner />
      ) : notifications.length === 0 ? (
        <div className="mt-6">
          <EmptyState title="No notifications" description="You're all caught up." />
        </div>
      ) : (
        <Card className="divide-y divide-slate-100 overflow-hidden">
          {notifications.map((n) => (
            <div
              key={n.id}
              className={`flex items-start justify-between gap-4 px-4 py-4 transition-colors duration-150 ${!n.is_read ? 'bg-teal-50/40' : ''}`}
            >
              <div className="flex gap-3">
                <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${!n.is_read ? 'bg-teal-500' : 'bg-transparent'}`} />
                <div>
                  <p className="text-sm font-medium text-ink">{n.title}</p>
                  <p className="mt-0.5 text-sm text-slate-500">{n.message}</p>
                  <p className="mt-1 text-xs text-slate-400">{formatDate(n.created_at)}</p>
                </div>
              </div>
              {!n.is_read && (
                <button
                  onClick={() => handleMarkRead(n.id)}
                  className="shrink-0 text-xs font-medium text-teal-600 transition-colors duration-150 hover:underline"
                >
                  Mark as read
                </button>
              )}
            </div>
          ))}
        </Card>
      )}
    </div>
  );
}
