import { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import type { Language } from '../../types';
import { API_BASE, formatDuration } from '../../services/api';
import './AdminQueuePanel.css';

type QueueItem = {
  id: number;
  messageId: string;
  username?: string;
  sessionTitle?: string;
  status: 'pending' | 'processing';
  createdAt: number;
  waitSeconds: number;
  promptPreview?: string;
  model?: string;
  workflow?: string;
};

type QueueResponse = {
  items: QueueItem[];
  perUser: Array<{ userId?: string; username: string; count: number; oldestCreatedAt: number }>;
  limits: { perUser: number; batch: number };
};

export const AdminQueuePanel = ({ lang }: { lang: Language }) => {
  const fr = lang === 'fr';
  const [data, setData] = useState<QueueResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [cancellingId, setCancellingId] = useState<number | null>(null);

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const response = await fetch(`${API_BASE}/api/admin/queue`, { credentials: 'include' });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || 'Queue request failed');
      setData(body);
    } catch (error) {
      if (!silent) toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (!autoRefresh) return;
    const timer = window.setInterval(() => void load(true), 3000);
    return () => window.clearInterval(timer);
  }, [autoRefresh, load]);

  const cancel = async (item: QueueItem) => {
    if (!window.confirm(fr
      ? `Annuler la génération en attente de ${item.username || 'cet utilisateur'} ?`
      : `Cancel the pending generation for ${item.username || 'this user'}?`)) return;
    setCancellingId(item.id);
    try {
      const response = await fetch(`${API_BASE}/api/admin/queue/${item.id}`, {
        method: 'DELETE',
        credentials: 'include'
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || 'Cancellation failed');
      toast.success(fr ? 'Génération annulée' : 'Generation cancelled');
      await load(true);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setCancellingId(null);
    }
  };

  return (
    <section className="admin-queue-panel" aria-labelledby="admin-queue-title">
      <div className="admin-queue-heading">
        <div>
          <h3 id="admin-queue-title">{fr ? 'File de génération' : 'Generation queue'}</h3>
          <p>{fr ? 'Ordonnancement équitable et charge par utilisateur.' : 'Fair scheduling and per-user load.'}</p>
        </div>
        <label className="admin-queue-auto-refresh">
          <input type="checkbox" checked={autoRefresh} onChange={event => setAutoRefresh(event.target.checked)} />
          {fr ? 'Actualisation automatique' : 'Automatic refresh'}
        </label>
        <button type="button" onClick={() => void load()} disabled={loading}>{fr ? 'Actualiser' : 'Refresh'}</button>
      </div>

      {data && (
        <div className="admin-queue-summary">
          <span><strong>{data.items.length}</strong>{fr ? ' tâches actives' : ' active tasks'}</span>
          <span><strong>{data.perUser.length}</strong>{fr ? ' utilisateurs' : ' users'}</span>
          <span>{fr ? 'Limite' : 'Limit'} <strong>{data.limits.perUser}</strong> / {fr ? 'utilisateur' : 'user'}</span>
          <span>{fr ? 'Batch max.' : 'Max batch'} <strong>{data.limits.batch}</strong></span>
        </div>
      )}

      {loading && !data ? <p role="status">{fr ? 'Chargement…' : 'Loading…'}</p> : data?.items.length ? (
        <div className="admin-queue-list" role="list">
          {data.items.map(item => (
            <article key={item.id} className={`admin-queue-item ${item.status}`} role="listitem">
              <div className="admin-queue-item-main">
                <div className="admin-queue-item-title">
                  <strong>{item.username || '—'}</strong>
                  <span>{item.status === 'processing' ? (fr ? 'En cours' : 'Processing') : (fr ? 'En attente' : 'Pending')}</span>
                  <time dateTime={new Date(item.createdAt).toISOString()}>{formatDuration(item.waitSeconds)}</time>
                </div>
                <p>{item.promptPreview || '—'}</p>
                <small>{[item.model, item.workflow, item.sessionTitle].filter(Boolean).join(' · ')}</small>
              </div>
              {item.status === 'pending' && (
                <button type="button" className="admin-queue-cancel" onClick={() => void cancel(item)} disabled={cancellingId === item.id}>
                  {cancellingId === item.id ? '…' : (fr ? 'Annuler' : 'Cancel')}
                </button>
              )}
            </article>
          ))}
        </div>
      ) : <p className="admin-queue-empty">{fr ? 'La file est vide.' : 'The queue is empty.'}</p>}
    </section>
  );
};
