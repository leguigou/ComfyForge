import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { API_BASE } from '../../services/api';

type LogLevel = 'debug' | 'info' | 'warning' | 'error';
type LogSource = 'comfyui' | 'llm';

interface AuditLog {
  id: number;
  timestamp: number;
  level: LogLevel;
  source: LogSource;
  direction: 'inbound' | 'outbound';
  event: string;
  message: string;
  status?: string;
  durationMs?: number;
  userId?: string;
  sessionId?: string;
  messageId?: string;
  details?: unknown;
}

interface Props {
  t: Record<string, string>;
}

const LEVELS: LogLevel[] = ['debug', 'info', 'warning', 'error'];
const SOURCES: LogSource[] = ['comfyui', 'llm'];
const REFRESH_INTERVALS = [1, 2, 5, 10, 30];

const LogLevelIcon = ({ level }: { level: LogLevel }) => {
  if (level === 'warning') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M12 3 2.8 20h18.4L12 3Z" />
        <path d="M12 9v5M12 17.5v.1" />
      </svg>
    );
  }
  if (level === 'error') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="12" cy="12" r="9" />
        <path d="m9 9 6 6m0-6-6 6" />
      </svg>
    );
  }
  if (level === 'debug') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M8 9h8v7a4 4 0 0 1-8 0V9Zm2-3h4M5 12h3m8 0h3M5 16h3m8 0h3" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5M12 8v.1" />
    </svg>
  );
};

const formatDuration = (durationMs?: number) => {
  if (durationMs === undefined || durationMs === null) return '—';
  if (durationMs < 1000) return `${durationMs} ms`;
  if (durationMs < 60_000) return `${(durationMs / 1000).toFixed(durationMs < 10_000 ? 2 : 1)} s`;
  return `${Math.floor(durationMs / 60_000)}m ${Math.round((durationMs % 60_000) / 1000)}s`;
};

const formatLog = (log: AuditLog) => {
  const header = [
    new Date(log.timestamp).toISOString(),
    log.level.toUpperCase(),
    log.source,
    log.direction,
    log.event,
    log.status ? `status=${log.status}` : '',
    log.durationMs !== undefined ? `duration=${log.durationMs}ms` : ''
  ].filter(Boolean).join(' | ');
  const context = [
    log.userId ? `user=${log.userId}` : '',
    log.sessionId ? `session=${log.sessionId}` : '',
    log.messageId ? `message=${log.messageId}` : ''
  ].filter(Boolean).join(' | ');
  return `${header}\n${log.message}${context ? `\n${context}` : ''}${log.details ? `\n${JSON.stringify(log.details, null, 2)}` : ''}`;
};

export const AdminLogsPanel = ({ t }: Props) => {
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [levels, setLevels] = useState<LogLevel[]>(LEVELS);
  const [sources, setSources] = useState<LogSource[]>(SOURCES);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [autoRefresh, setAutoRefresh] = useState(() => localStorage.getItem('adminLogsAutoRefresh') !== 'false');
  const [autoScroll, setAutoScroll] = useState(() => localStorage.getItem('adminLogsAutoScroll') !== 'false');
  const [refreshSeconds, setRefreshSeconds] = useState(() => Number(localStorage.getItem('adminLogsRefreshSeconds')) || 2);
  const [isLoading, setIsLoading] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const requestInProgressRef = useRef(false);

  useEffect(() => {
    const timeout = window.setTimeout(() => setDebouncedSearch(search.trim()), 250);
    return () => window.clearTimeout(timeout);
  }, [search]);

  useEffect(() => {
    localStorage.setItem('adminLogsAutoRefresh', String(autoRefresh));
    localStorage.setItem('adminLogsAutoScroll', String(autoScroll));
    localStorage.setItem('adminLogsRefreshSeconds', String(refreshSeconds));
  }, [autoRefresh, autoScroll, refreshSeconds]);

  const loadLogs = useCallback(async (showSpinner = false) => {
    if (requestInProgressRef.current) return;
    requestInProgressRef.current = true;
    if (showSpinner) setIsLoading(true);
    try {
      const query = new URLSearchParams({
        limit: '600',
        levels: levels.join(','),
        sources: sources.join(',')
      });
      if (debouncedSearch) query.set('search', debouncedSearch);
      const response = await fetch(`${API_BASE}/api/admin/logs?${query.toString()}`, { credentials: 'include' });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || t.logsLoadFailed);
      setLogs(Array.isArray(data.logs) ? data.logs : []);
      setCounts(Object.fromEntries((data.counts || []).map((item: { level: string; count: number }) => [item.level, item.count])));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t.logsLoadFailed);
    } finally {
      requestInProgressRef.current = false;
      if (showSpinner) setIsLoading(false);
    }
  }, [debouncedSearch, levels, sources, t.logsLoadFailed]);

  useEffect(() => {
    void loadLogs(true);
  }, [loadLogs]);

  useEffect(() => {
    if (!autoRefresh) return;
    const interval = window.setInterval(() => void loadLogs(false), refreshSeconds * 1000);
    return () => window.clearInterval(interval);
  }, [autoRefresh, loadLogs, refreshSeconds]);

  useEffect(() => {
    if (!autoScroll || !listRef.current) return;
    listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [logs, autoScroll]);

  const copyText = useMemo(() => logs.map(formatLog).join('\n\n'), [logs]);

  const copyLogs = async () => {
    try {
      await navigator.clipboard.writeText(copyText);
      toast.success(t.logsCopied);
    } catch {
      toast.error(t.logsCopyFailed);
    }
  };

  const toggleValue = <T extends string>(value: T, selected: T[], setSelected: (values: T[]) => void) => {
    if (selected.length === 1 && selected.includes(value)) return;
    setSelected(selected.includes(value) ? selected.filter(item => item !== value) : [...selected, value]);
  };

  return (
    <section className="admin-logs-panel">
      <div className="admin-logs-heading">
        <div>
          <h3>{t.logsTitle}</h3>
          <p>{t.logsSubtitle}</p>
        </div>
        <div className="admin-logs-actions">
          <button type="button" onClick={() => void loadLogs(true)} disabled={isLoading}>
            {isLoading ? '…' : t.refresh}
          </button>
          <button type="button" onClick={() => void copyLogs()} disabled={!logs.length}>
            {t.copyLogs}
          </button>
        </div>
      </div>

      <div className="admin-log-controls">
        <label className="admin-log-search">
          <span>{t.search}</span>
          <input value={search} onChange={event => setSearch(event.target.value)} placeholder={t.searchLogs} />
        </label>

        <div className="admin-log-toggle-row">
          <label>
            <input type="checkbox" checked={autoRefresh} onChange={event => setAutoRefresh(event.target.checked)} />
            <span>{t.liveRefresh}</span>
          </label>
          <select value={refreshSeconds} onChange={event => setRefreshSeconds(Number(event.target.value))} disabled={!autoRefresh}>
            {REFRESH_INTERVALS.map(seconds => <option key={seconds} value={seconds}>{seconds} s</option>)}
          </select>
          <label>
            <input type="checkbox" checked={autoScroll} onChange={event => setAutoScroll(event.target.checked)} />
            <span>{t.autoScrollLogs}</span>
          </label>
        </div>
      </div>

      <div className="admin-log-filter-group">
        <span>{t.logLevels}</span>
        <div className="admin-log-chips">
          {LEVELS.map(level => (
            <button
              type="button"
              key={level}
              className={`admin-log-chip level-${level} ${levels.includes(level) ? 'selected' : ''}`}
              aria-pressed={levels.includes(level)}
              onClick={() => toggleValue(level, levels, setLevels)}
            >
              {t[`logLevel_${level}`]} <small>{counts[level] || 0}</small>
            </button>
          ))}
        </div>
      </div>

      <div className="admin-log-filter-group">
        <span>{t.logSources}</span>
        <div className="admin-log-chips">
          {SOURCES.map(source => (
            <button
              type="button"
              key={source}
              className={`admin-log-chip ${sources.includes(source) ? 'selected' : ''}`}
              aria-pressed={sources.includes(source)}
              onClick={() => toggleValue(source, sources, setSources)}
            >
              {source}
            </button>
          ))}
        </div>
      </div>

      <div className="admin-log-list" ref={listRef} role="log" aria-live={autoRefresh ? 'polite' : 'off'}>
        {!logs.length && <div className="admin-log-empty">{isLoading ? t.loading : t.noLogs}</div>}
        {logs.map(log => (
          <details className={`admin-log-entry level-${log.level}`} key={log.id}>
            <summary className="admin-log-entry-main">
              <time dateTime={new Date(log.timestamp).toISOString()}>
                {new Date(log.timestamp).toLocaleString()}
              </time>
              <span
                className={`admin-log-level level-${log.level}`}
                title={t[`logLevel_${log.level}`]}
                aria-label={t[`logLevel_${log.level}`]}
              >
                <LogLevelIcon level={log.level} />
              </span>
              <span className="admin-log-source">{log.source}</span>
              <span
                className={`admin-log-direction direction-${log.direction}`}
                title={t[`logDirection_${log.direction}`]}
                aria-label={t[`logDirection_${log.direction}`]}
              >
                {log.direction === 'outbound' ? '→' : '←'}
              </span>
              <strong className="admin-log-message">{log.message}</strong>
              {log.status && <span className="admin-log-status">{log.status}</span>}
              {log.durationMs !== undefined && <span className="admin-log-duration">{formatDuration(log.durationMs)}</span>}
            </summary>
            <div className="admin-log-expanded">
              <div className="admin-log-event">{log.event}</div>
              {(log.sessionId || log.messageId) && (
                <div className="admin-log-context">
                  {log.sessionId && <span>session: {log.sessionId}</span>}
                  {log.messageId && <span>message: {log.messageId}</span>}
                </div>
              )}
              {log.details !== null && log.details !== undefined && <pre>{JSON.stringify(log.details, null, 2)}</pre>}
              <button type="button" onClick={() => navigator.clipboard.writeText(formatLog(log)).then(() => toast.success(t.logCopied))}>
                {t.copyLog}
              </button>
            </div>
          </details>
        ))}
      </div>
    </section>
  );
};
