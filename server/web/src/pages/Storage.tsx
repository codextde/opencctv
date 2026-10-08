import { useEffect, useRef, useState, type ReactNode } from 'react';
import { api, apiUrl, errorMessage } from '../api';
import { navigate } from '../router';
import { useAsync, useLive } from '../store';
import type { GdriveStart, StorageInfo, StorageTarget, StorageTypeInfo } from '../types';
import { formatBytes, relativeTime } from '../format';
import { FieldsForm, initialValues, missingRequired } from '../components/FieldsForm';
import { confirm, toast } from '../components/feedback';
import {
  IconChevronLeft, IconCloud, IconEdit, IconExternal, IconFolder, IconKey, IconPlus, IconServer, IconTrash,
} from '../components/icons';
import {
  Alert, Button, Card, CopyField, cx, EmptyState, FormField, HelpText, IconButton, Input, Modal, PageHeader, Skeleton,
  Spinner, StatusDot, Toggle, UsageBar, useNow,
} from '../components/ui';
import { BrandMark } from './AddCamera';

const TYPE_MARK: Record<string, [string, number]> = {
  gdrive: ['GD', 145], s3: ['S3', 28], sftp: ['SFTP', 200], smb: ['SMB', 230], webdav: ['DAV', 260], ftp: ['FTP', 190],
  dropbox: ['DB', 215], onedrive: ['OD', 205], local: ['LO', 170],
};

function TypeMark({ type, name, size = 36 }: { type: string; name: string; size?: number }) {
  const m = TYPE_MARK[type];
  return <BrandMark id={`st-${type}`} name={name} label={m?.[0]} hue={m?.[1]} size={size} />;
}

export function StoragePage() {
  const { data, setData, error, reload } = useAsync<StorageInfo>(() => api.storage(), []);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<StorageTarget | null>(null);

  useLive((m) => {
    if (m.type === 'storage')
      setData((d) => (d ? { ...d, targets: d.targets.map((t) => (t.id === m.target.id ? m.target : t)) } : d));
  });

  const toggle = async (t: StorageTarget, enabled: boolean) => {
    setData((d) => (d ? { ...d, targets: d.targets.map((x) => (x.id === t.id ? { ...x, enabled } : x)) } : d));
    try {
      await api.updateTarget(t.id, { enabled });
    } catch (e) {
      toast.error('Could not update destination', errorMessage(e));
      void reload();
    }
  };

  const remove = async (t: StorageTarget) => {
    const ok = await confirm({
      title: `Remove ${t.name}?`,
      message: 'OpenCCTV stops uploading to this destination. Files already uploaded stay where they are.',
      confirmLabel: 'Remove',
      danger: true,
    });
    if (!ok) return;
    try {
      await api.deleteTarget(t.id);
      setData((d) => (d ? { ...d, targets: d.targets.filter((x) => x.id !== t.id) } : d));
      toast.success(`${t.name} removed`);
    } catch (e) {
      toast.error('Could not remove destination', errorMessage(e));
    }
  };

  const local = data?.local;
  const typeName = (type: string) => data?.types.find((t) => t.type === type)?.name ?? type;

  return (
    <div className="page">
      <PageHeader
        title="Storage"
        description="Recordings are stored on this server and can be copied to cloud or network storage automatically."
        actions={
          <Button variant="primary" icon={<IconPlus size={16} />} onClick={() => setAdding(true)} disabled={!data}>
            Add destination
          </Button>
        }
      />
      {error && <Alert>{error}</Alert>}

      <Card
        title="Local disk"
        description={local ? <span className="mono">{local.path}</span> : <Skeleton w={220} h={11} />}
        actions={
          <Button size="sm" variant="ghost" onClick={() => navigate('/settings')}>
            Retention settings
          </Button>
        }
      >
        {local ? (
          <div className="disk">
            <div className="disk-figures">
              <div>
                <div className="stat-value tabular">{formatBytes(local.usedBytes)}</div>
                <div className="stat-label">Used of {formatBytes(local.totalBytes)}</div>
              </div>
              <div className="disk-meta">
                <span>
                  <b className="tabular">{formatBytes(local.freeBytes)}</b> free
                </span>
                <span>
                  Keep <b className="tabular">{local.retentionDays} days</b>
                </span>
                <span>
                  Limit <b className="tabular">{local.maxGB ? `${local.maxGB} GB` : 'none'}</b>
                </span>
              </div>
            </div>
            <UsageBar used={local.usedBytes} total={local.totalBytes} />
            {local.maxGB > 0 && (
              <div className="disk-limit muted small tabular">
                Recordings use {Math.min(100, Math.round((local.usedBytes / (local.maxGB * 1024 ** 3)) * 100))}% of the {local.maxGB} GB limit — the oldest are
                deleted first when it's reached.
              </div>
            )}
          </div>
        ) : (
          <Skeleton h={64} w="100%" />
        )}
      </Card>

      <div className="section-head">
        <h2 className="section-title">Upload destinations</h2>
      </div>

      {!data && !error && <Skeleton h={160} w="100%" r={12} />}
      {data && data.targets.length === 0 && (
        <EmptyState
          icon={<IconCloud size={26} />}
          title="No off-site copies yet"
          action={
            <Button variant="primary" icon={<IconPlus size={16} />} onClick={() => setAdding(true)}>
              Add destination
            </Button>
          }
        >
          If a burglar takes the server, the footage goes with it. Upload recordings to Google Drive, S3, a NAS or any SFTP / WebDAV server.
        </EmptyState>
      )}
      {data && data.targets.length > 0 && (
        <div className="target-list">
          {data.targets.map((t) => (
            <div key={t.id} className={cx('card target', !t.enabled && 'is-disabled')}>
              <TypeMark type={t.type} name={typeName(t.type)} />
              <div className="target-main">
                <div className="target-name">
                  {t.name}
                  {typeName(t.type) !== t.name && <span className="muted small">{typeName(t.type)}</span>}
                </div>
                <div className="target-sub">
                  <span className="row gap-6">
                    <IconFolder size={13} />
                    <span className="mono">{t.path || '/'}</span>
                  </span>
                  <span>Keeps {t.retentionDays} days</span>
                </div>
                {t.enabled && !t.status.ok && t.status.error && <div className="target-error mono">{t.status.error}</div>}
              </div>
              <div className="target-stats">
                <div className="target-status">
                  <StatusDot status={!t.enabled ? 'off' : t.status.ok ? 'ok' : 'error'} />
                  {!t.enabled ? 'Paused' : t.status.ok ? 'Healthy' : 'Failing'}
                </div>
                <div className="muted small tabular">
                  {t.status.lastUpload ? `Last upload ${relativeTime(t.status.lastUpload)}` : 'No uploads yet'}
                </div>
                <div className="muted small tabular">
                  {t.status.queued > 0 ? `${t.status.queued} queued` : 'Up to date'}
                  {t.status.usedBytes !== undefined ? ` · ${formatBytes(t.status.usedBytes)}` : ''}
                </div>
              </div>
              <div className="target-actions">
                <Toggle size="sm" checked={t.enabled} onChange={(v) => void toggle(t, v)} label={`${t.name} enabled`} />
                <IconButton label="Edit" onClick={() => setEditing(t)}>
                  <IconEdit size={16} />
                </IconButton>
                <IconButton label="Remove" className="danger-hover" onClick={() => void remove(t)}>
                  <IconTrash size={16} />
                </IconButton>
              </div>
            </div>
          ))}
        </div>
      )}

      {adding && data && (
        <AddTargetDialog
          info={data}
          onClose={() => setAdding(false)}
          onCreated={() => {
            setAdding(false);
            void reload();
          }}
        />
      )}
      {editing && data && (
        <EditTargetDialog
          target={editing}
          type={data.types.find((t) => t.type === editing.type)}
          onClose={() => setEditing(null)}
          onSaved={(t) => {
            setEditing(null);
            setData((d) => (d ? { ...d, targets: d.targets.map((x) => (x.id === t.id ? t : x)) } : d));
          }}
        />
      )}
    </div>
  );
}

/* ---------------- Add target ---------------- */

function CommonFields({
  name,
  setName,
  path,
  setPath,
  days,
  setDays,
}: {
  name: string;
  setName: (v: string) => void;
  path: string;
  setPath: (v: string) => void;
  days: number;
  setDays: (v: number) => void;
}) {
  return (
    <>
      <FormField label="Display name" htmlFor="st-name">
        <Input id="st-name" value={name} onChange={(e) => setName(e.target.value)} />
      </FormField>
      <FormField label="Folder" htmlFor="st-path" hint="Folder inside the destination.">
        <Input id="st-path" className="mono-input" value={path} onChange={(e) => setPath(e.target.value)} placeholder="OpenCCTV" />
      </FormField>
      <FormField label="Keep recordings for" htmlFor="st-days" hint="Older uploads are deleted. 0 keeps them forever.">
        <div className="input-suffix">
          <Input id="st-days" type="number" min={0} value={days} onChange={(e) => setDays(Number(e.target.value))} />
          <span>days</span>
        </div>
      </FormField>
    </>
  );
}

function AddTargetDialog({ info, onClose, onCreated }: { info: StorageInfo; onClose: () => void; onCreated: () => void }) {
  const types = info.types.some((t) => t.type === 'gdrive')
    ? info.types
    : [{ type: 'gdrive', name: 'Google Drive', fields: [], help: 'Upload recordings to your Google Drive.' }, ...info.types];
  const [type, setType] = useState<StorageTypeInfo | null>(null);

  return (
    <Modal
      open
      onClose={onClose}
      size={type ? 'md' : 'lg'}
      title={type ? `Add ${type.name}` : 'Add upload destination'}
      description={type ? undefined : 'Recordings are copied there as soon as each segment is finished.'}
    >
      {!type && (
        <div className="type-grid">
          {types
            .filter((t) => t.type !== 'local')
            .map((t) => (
              <button key={t.type} type="button" className="brand-tile" onClick={() => setType(t)}>
                <TypeMark type={t.type} name={t.name} />
                <span className="brand-name">{t.name}</span>
                <span className="brand-kinds">{t.help.split(/[.\n]/)[0]}</span>
              </button>
            ))}
        </div>
      )}
      {type && (
        <>
          <button type="button" className="back-link back-link-inline" onClick={() => setType(null)}>
            <IconChevronLeft size={15} /> All destinations
          </button>
          {type.type === 'gdrive' ? (
            <GdriveConnect info={info} onDone={onCreated} />
          ) : (
            <GenericTargetForm type={type} onDone={onCreated} />
          )}
        </>
      )}
    </Modal>
  );
}

function GenericTargetForm({ type, onDone }: { type: StorageTypeInfo; onDone: () => void }) {
  const [name, setName] = useState(type.name);
  const [path, setPath] = useState('OpenCCTV');
  const [days, setDays] = useState(30);
  const [config, setConfig] = useState(() => initialValues(type.fields));
  const [testState, setTestState] = useState<{ ok: boolean; error?: string } | null>(null);
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const body = () => ({ type: type.type, name: name.trim() || type.name, config, path: path.trim(), retentionDays: days });
  const valid = () => {
    const miss = missingRequired(type.fields, config);
    setError(miss ? `${miss.label} is required.` : null);
    return !miss;
  };

  return (
    <div className="stack-16">
      {type.help && (
        <div className="help-inline">
          <HelpText text={type.help} />
        </div>
      )}
      <div className="form-grid">
        <FieldsForm fields={type.fields} values={config} onChange={(k, v) => (setConfig((p) => ({ ...p, [k]: v })), setTestState(null))} idPrefix="st" />
        <CommonFields name={name} setName={setName} path={path} setPath={setPath} days={days} setDays={setDays} />
      </div>
      {testState && (testState.ok ? <Alert tone="ok">Connection works.</Alert> : <Alert>{testState.error ?? 'Connection failed.'}</Alert>)}
      {error && <Alert>{error}</Alert>}
      <div className="form-actions">
        <Button
          variant="secondary"
          loading={testing}
          onClick={async () => {
            if (!valid()) return;
            setTesting(true);
            try {
              setTestState(await api.testTarget(body()));
            } catch (e) {
              setTestState({ ok: false, error: errorMessage(e) });
            } finally {
              setTesting(false);
            }
          }}
        >
          Test connection
        </Button>
        <Button
          variant="primary"
          loading={saving}
          onClick={async () => {
            if (!valid()) return;
            setSaving(true);
            try {
              await api.createTarget(body());
              toast.success(`${name || type.name} added`);
              onDone();
            } catch (e) {
              setError(errorMessage(e));
              setSaving(false);
            }
          }}
        >
          Save destination
        </Button>
      </div>
    </div>
  );
}

/* ---------------- Google Drive ---------------- */

type GMode = 'device' | 'browser' | 'rclone';

function GdriveConnect({ info, onDone }: { info: StorageInfo; onDone: () => void }) {
  const caps = info.gdrive ?? { deviceFlow: true, browserFlow: false };
  const [mode, setMode] = useState<GMode>(caps.deviceFlow ? 'device' : 'browser');
  const [name, setName] = useState('Google Drive');
  const [path, setPath] = useState('OpenCCTV');
  const [days, setDays] = useState(30);
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [token, setToken] = useState('');
  const [flow, setFlow] = useState<GdriveStart | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const now = useNow(1000);
  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const needsOwnClient = mode === 'browser' && !caps.browserFlow;
  const redirectUri = apiUrl('/api/storage/gdrive/callback');

  useEffect(() => () => {
    if (pollRef.current) clearTimeout(pollRef.current);
  }, []);

  const poll = (flowId: string) => {
    pollRef.current = setTimeout(async () => {
      try {
        const s = await api.gdriveStatus(flowId);
        if (s.status === 'done') {
          toast.success('Google Drive connected');
          onDone();
          return;
        }
        if (s.status === 'expired') {
          setError('The sign-in code expired. Start again.');
          setFlow(null);
          return;
        }
        if (s.status === 'error') {
          setError(s.error ?? 'Google sign-in failed.');
          setFlow(null);
          return;
        }
      } catch (e) {
        setError(errorMessage(e));
      }
      poll(flowId);
    }, 3000);
  };

  const start = async () => {
    setError(null);
    if (needsOwnClient && (!clientId.trim() || !clientSecret.trim())) return setError('Enter the client ID and client secret.');
    setBusy(true);
    try {
      const f = await api.gdriveStart({
        name: name.trim() || undefined,
        path: path.trim() || undefined,
        retentionDays: days,
        mode: mode === 'browser' ? 'browser' : 'device',
        clientId: mode === 'browser' && clientId.trim() ? clientId.trim() : undefined,
        clientSecret: mode === 'browser' && clientSecret.trim() ? clientSecret.trim() : undefined,
      });
      setFlow(f);
      if (f.authUrl) window.open(f.authUrl, '_blank', 'noopener');
      poll(f.flowId);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const saveRclone = async () => {
    setError(null);
    const t = token.trim();
    try {
      JSON.parse(t);
    } catch {
      return setError('Paste the complete JSON token, including the curly braces.');
    }
    setBusy(true);
    try {
      await api.createTarget({ type: 'gdrive', name: name.trim() || 'Google Drive', config: { token: t }, path: path.trim(), retentionDays: days });
      toast.success('Google Drive connected');
      onDone();
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  };

  if (flow) {
    const remaining = flow.expiresAt ? Math.max(0, Math.floor((new Date(flow.expiresAt).getTime() - now) / 1000)) : null;
    return (
      <div className="gflow">
        {flow.userCode ? (
          <>
            <p className="muted">Open the Google page on any device and enter this code:</p>
            <div className="gflow-code mono">{flow.userCode}</div>
            <div className="row gap-8 center">
              <CopyField value={flow.userCode} />
            </div>
            <Button variant="primary" icon={<IconExternal size={15} />} onClick={() => window.open(flow.verificationUrl, '_blank', 'noopener')}>
              Open {flow.verificationUrl?.replace(/^https?:\/\//, '')}
            </Button>
          </>
        ) : (
          <>
            <p className="muted">Finish signing in with Google in the new tab. This window updates automatically.</p>
            <Button variant="secondary" icon={<IconExternal size={15} />} onClick={() => window.open(flow.authUrl, '_blank', 'noopener')}>
              Open Google sign-in again
            </Button>
          </>
        )}
        <div className="gflow-wait">
          <Spinner size={14} /> Waiting for Google…
          {remaining !== null && (
            <span className="tabular muted">
              {' '}
              {Math.floor(remaining / 60)}:{String(remaining % 60).padStart(2, '0')} left
            </span>
          )}
        </div>
        <Button variant="ghost" size="sm" onClick={() => (pollRef.current && clearTimeout(pollRef.current), setFlow(null))}>
          Cancel
        </Button>
      </div>
    );
  }

  const options: { id: GMode; title: string; desc: string; icon: ReactNode; show: boolean }[] = [
    { id: 'device', title: 'Sign in with Google', desc: 'Enter a short code on google.com/device. Easiest.', icon: <IconCloud size={18} />, show: caps.deviceFlow },
    {
      id: 'browser',
      title: caps.browserFlow ? 'Sign in in this browser' : 'Use your own OAuth client',
      desc: caps.browserFlow ? 'Opens Google sign-in in a new tab.' : 'Bring a Google Cloud OAuth Web client.',
      icon: <IconServer size={18} />,
      show: true,
    },
    { id: 'rclone', title: 'Paste rclone token', desc: 'Authorize on any computer with rclone.', icon: <IconKey size={18} />, show: true },
  ];

  return (
    <div className="stack-16">
      <div className="choice-grid choice-grid-3">
        {options
          .filter((o) => o.show)
          .map((o) => (
            <button key={o.id} type="button" className={cx('choice', mode === o.id && 'is-active')} onClick={() => (setMode(o.id), setError(null))}>
              <span className="choice-icon">{o.icon}</span>
              <span className="choice-title">{o.title}</span>
              <span className="choice-desc">{o.desc}</span>
            </button>
          ))}
      </div>

      {mode === 'browser' && (
        <div className="stack-12">
          {needsOwnClient && (
            <div className="help-inline">
              <HelpText
                text={`In Google Cloud Console create an OAuth client of type "Web application" and enable the Google Drive API.\nAdd this authorized redirect URI:\nCopy the client ID and secret below.`}
              />
              <div className="mt-8">
                <CopyField value={redirectUri} />
              </div>
            </div>
          )}
          <div className="form-grid">
            <FormField label="Client ID" htmlFor="gd-cid" optional={!needsOwnClient}>
              <Input id="gd-cid" className="mono-input" value={clientId} onChange={(e) => setClientId(e.target.value)} placeholder="…apps.googleusercontent.com" />
            </FormField>
            <FormField label="Client secret" htmlFor="gd-cs" optional={!needsOwnClient}>
              <Input id="gd-cs" type="password" value={clientSecret} onChange={(e) => setClientSecret(e.target.value)} autoComplete="new-password" />
            </FormField>
          </div>
        </div>
      )}

      {mode === 'rclone' && (
        <div className="stack-12">
          <div className="help-inline">
            <HelpText
              text={`Install rclone on any computer with a browser (rclone.org/install).\nRun: rclone authorize "drive"\nSign in with Google when the browser opens.\nCopy the JSON token rclone prints and paste it below.`}
            />
          </div>
          <FormField label="Token JSON" htmlFor="gd-token">
            <textarea
              id="gd-token"
              className="input textarea mono"
              rows={4}
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder='{"access_token":"…","token_type":"Bearer","refresh_token":"…","expiry":"…"}'
              spellCheck={false}
            />
          </FormField>
        </div>
      )}

      <div className="form-grid">
        <CommonFields name={name} setName={setName} path={path} setPath={setPath} days={days} setDays={setDays} />
      </div>
      {error && <Alert>{error}</Alert>}
      <div className="form-actions">
        {mode === 'rclone' ? (
          <Button variant="primary" loading={busy} onClick={() => void saveRclone()}>
            Save destination
          </Button>
        ) : (
          <Button variant="primary" loading={busy} icon={<IconExternal size={15} />} onClick={() => void start()}>
            Connect Google Drive
          </Button>
        )}
      </div>
    </div>
  );
}

/* ---------------- Edit target ---------------- */

function EditTargetDialog({
  target,
  type,
  onClose,
  onSaved,
}: {
  target: StorageTarget;
  type?: StorageTypeInfo;
  onClose: () => void;
  onSaved: (t: StorageTarget) => void;
}) {
  const [name, setName] = useState(target.name);
  const [path, setPath] = useState(target.path);
  const [days, setDays] = useState(target.retentionDays);
  const [enabled, setEnabled] = useState(target.enabled);
  const [config, setConfig] = useState<Record<string, string>>(() => {
    const out: Record<string, string> = {};
    for (const f of type?.fields ?? []) out[f.key] = f.type === 'password' || target.config[f.key] === '***' ? '' : target.config[f.key] ?? '';
    return out;
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    setBusy(true);
    setError(null);
    const cfg = Object.fromEntries(Object.entries(config).filter(([k, v]) => v !== '' || (type?.fields.find((f) => f.key === k)?.type !== 'password' && target.config[k] !== '***')));
    try {
      const t = await api.updateTarget(target.id, {
        name: name.trim(),
        path: path.trim(),
        retentionDays: days,
        enabled,
        ...(type && type.fields.length ? { config: cfg } : {}),
      });
      toast.success('Destination saved');
      onSaved(t);
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={`Edit ${target.name}`}
      footer={
        <>
          <div className="row gap-8 mr-auto">
            <Toggle checked={enabled} onChange={setEnabled} label="Enabled" />
            <span className="small muted">{enabled ? 'Uploading' : 'Paused'}</span>
          </div>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" loading={busy} onClick={() => void save()}>
            Save
          </Button>
        </>
      }
    >
      <div className="stack-16">
        {type && type.fields.length > 0 && (
          <div className="form-grid">
            <FieldsForm
              fields={type.fields.map((f) => ({ ...f, required: false }))}
              values={config}
              onChange={(k, v) => setConfig((p) => ({ ...p, [k]: v }))}
              idPrefix="et"
              secretPlaceholder="Unchanged"
            />
          </div>
        )}
        <div className="form-grid">
          <CommonFields name={name} setName={setName} path={path} setPath={setPath} days={days} setDays={setDays} />
        </div>
        {error && <Alert>{error}</Alert>}
      </div>
    </Modal>
  );
}

