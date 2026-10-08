import { useEffect, useRef, useState } from 'react';
import { api, errorMessage } from '../api';
import { useApp, useAsync } from '../store';
import type { SystemInfo } from '../types';
import { formatBytes, formatUptime } from '../format';
import { IconRefresh } from '../components/icons';
import { Alert, Button, Card, cx, PageHeader, Skeleton, StatusDot, UsageBar, useInterval } from '../components/ui';

function Stat({ label, value, sub }: { label: string; value: string | number | null; sub?: string }) {
  return (
    <div className="card stat">
      <div className="stat-label">{label}</div>
      {value === null ? <Skeleton w={80} h={22} /> : <div className="stat-value tabular">{value}</div>}
      {sub && <div className="stat-sub tabular">{sub}</div>}
    </div>
  );
}

export function SystemPage() {
  const { isAdmin } = useApp();
  const { data, error, reload } = useAsync<SystemInfo>(() => api.system(), []);
  useInterval(() => void reload(), 10_000);

  return (
    <div className="page">
      <PageHeader title="System" description={data ? <span className="tabular">OpenCCTV v{data.version} · {data.platform}</span> : 'Server health and components.'} />
      {error && <Alert>{error}</Alert>}
      <div className="stat-grid">
        <Stat label="Uptime" value={data ? formatUptime(data.uptimeSec) : null} />
        <Stat label="CPU" value={data ? `${Math.round(data.cpuPercent)}%` : null} />
        <Stat label="Memory" value={data ? formatBytes(data.memBytes) : null} sub="OpenCCTV process" />
        <Stat label="Recordings" value={data ? data.recordingsCount.toLocaleString() : null} sub={data ? formatBytes(data.recordingsBytes) : undefined} />
      </div>

      <div className="split split-even">
        <Card title="Disk" description={data ? <span className="mono">{data.disk.path}</span> : undefined}>
          {data ? (
            <div className="stack-12">
              <div className="row between">
                <span className="stat-value tabular">{formatBytes(data.disk.usedBytes)}</span>
                <span className="muted small tabular">{formatBytes(data.disk.freeBytes)} free of {formatBytes(data.disk.totalBytes)}</span>
              </div>
              <UsageBar used={data.disk.usedBytes} total={data.disk.totalBytes} />
            </div>
          ) : (
            <Skeleton h={48} w="100%" />
          )}
        </Card>
        <Card title="Components" padded={false}>
          {data ? (
            <div className="components">
              {Object.entries(data.components).map(([name, c]) => (
                <div className="component-row" key={name}>
                  <StatusDot status={c.ok ? 'ok' : 'error'} />
                  <span className="strong">{name}</span>
                  <span className="muted mono small grow-right">{c.version ?? (c.ok ? '' : 'not found')}</span>
                </div>
              ))}
              <div className="component-row">
                <StatusDot status="ok" />
                <span className="strong">cameras</span>
                <span className="muted mono small grow-right">{data.cameras} configured</span>
              </div>
            </div>
          ) : (
            <div className="card-body">
              <Skeleton h={80} w="100%" />
            </div>
          )}
        </Card>
      </div>

      {isAdmin && <Logs />}
    </div>
  );
}

function Logs() {
  const [lines, setLines] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [follow, setFollow] = useState(true);
  const boxRef = useRef<HTMLPreElement>(null);

  const load = async () => {
    setLoading(true);
    try {
      const r = await api.logs(300);
      setLines(r.lines);
      setError(null);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);
  useInterval(() => follow && void load(), 5000);
  useEffect(() => {
    const el = boxRef.current;
    if (el && follow) el.scrollTop = el.scrollHeight;
  }, [lines, follow]);

  const level = (l: string) => (/\b(ERROR|ERR|FATAL)\b/.test(l) ? 'log-error' : /\bWARN(ING)?\b/.test(l) ? 'log-warn' : /\bDEBUG\b/.test(l) ? 'log-debug' : '');

  return (
    <Card
      title="Logs"
      description="Most recent 300 lines"
      padded={false}
      actions={
        <>
          <label className="check">
            <input type="checkbox" checked={follow} onChange={(e) => setFollow(e.target.checked)} />
            <span>Follow</span>
          </label>
          <Button size="sm" variant="secondary" loading={loading} icon={<IconRefresh size={14} />} onClick={() => void load()}>
            Refresh
          </Button>
        </>
      }
    >
      {error && (
        <div className="card-body">
          <Alert>{error}</Alert>
        </div>
      )}
      <pre className="logs" ref={boxRef} onScroll={(e) => {
        const el = e.currentTarget;
        const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
        if (!atBottom && follow) setFollow(false);
      }}>
        {lines === null ? (
          <span className="muted">Loading…</span>
        ) : lines.length === 0 ? (
          <span className="muted">No log output yet.</span>
        ) : (
          lines.map((l, i) => (
            <div key={i} className={cx('log-line', level(l))}>
              {l}
            </div>
          ))
        )}
      </pre>
    </Card>
  );
}
