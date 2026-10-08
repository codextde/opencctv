import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { api, errorMessage } from '../api';
import { navigate, setQuery, useRoute } from '../router';
import { useApp } from '../store';
import type { Brand, Camera, CameraTestResult, DiscoverCandidate, UnifiImportResult } from '../types';
import { initials, resolution } from '../format';
import { FieldsForm, initialValues, missingRequired } from '../components/FieldsForm';
import { toast } from '../components/feedback';
import {
  IconCheck, IconChevronLeft, IconChevronRight, IconLive, IconPlus, IconRadar, IconRefresh, IconSnapshot,
} from '../components/icons';
import {
  Alert, Badge, Button, CopyField, cx, EmptyState, FormField, HelpText, Input, PageHeader, Select, Skeleton, Spinner,
} from '../components/ui';

const KIND_LABELS: Record<string, string> = {
  rtsp: 'RTSP',
  onvif: 'ONVIF',
  tapo: 'Tapo (native)',
  unifi: 'UniFi Protect',
  http: 'HTTP / MJPEG',
  'rtmp-push': 'RTMP push',
  'rtsp-push': 'RTSP push',
  demo: 'Demo stream',
};
export const kindLabel = (k: string) => KIND_LABELS[k] ?? k.toUpperCase();

const MARK_HUES: Record<string, number> = {
  tapo: 160, eufy: 205, unifi: 215, ubiquiti: 215, reolink: 200, hikvision: 0, dahua: 355, amcrest: 190, axis: 45,
  foscam: 185, ezviz: 25, imou: 30, annke: 220, wyze: 260, onvif: 170, generic: 220, demo: 280,
};

const MARK_TEXT: Record<string, string> = { tapo: 'TP', unifi: 'UI', ubiquiti: 'UI', generic: 'RTSP', onvif: 'ON', eufy: 'eu', ezviz: 'EZ' };

export function BrandMark({ id, name, size = 40, label, hue: hueProp }: { id: string; name: string; size?: number; label?: string; hue?: number }) {
  const hue = hueProp ?? MARK_HUES[id] ?? [...id].reduce((a, c) => a + c.charCodeAt(0), 0) % 360;
  const text = label ?? MARK_TEXT[id] ?? initials(name);
  return (
    <span
      className="brand-mark"
      style={{
        width: size,
        height: size,
        fontSize: Math.round(size * (text.length > 2 ? 0.26 : 0.36)),
        ['--mark-hue' as string]: String(hue),
      }}
      aria-hidden="true"
    >
      {text}
    </span>
  );
}

type Tab = 'brands' | 'discover' | 'unifi';

interface Prefill {
  values: Record<string, string>;
  name?: string;
}

export function AddCamera({ brands, brandsError }: { brands: Brand[] | null; brandsError: string | null }) {
  const route = useRoute();
  const tab = (route.query.get('step') as Tab) || 'brands';
  const brandId = route.query.get('brand');
  const brand = brands?.find((b) => b.id === brandId);
  const [prefill, setPrefill] = useState<Prefill | null>(null);
  const [created, setCreated] = useState<Camera | null>(null);
  const routeKey = route.query.toString();
  useEffect(() => setCreated(null), [routeKey]);

  if (created) return <AddDone camera={created} onAnother={() => (setCreated(null), navigate('/cameras/add'))} />;

  if (brand)
    return (
      <ConfigureCamera
        key={brand.id}
        brand={brand}
        prefill={prefill}
        onBack={() => {
          setPrefill(null);
          navigate('/cameras/add', { step: tab === 'brands' ? undefined : tab });
        }}
        onCreated={setCreated}
      />
    );

  const pick = (b: Brand, p?: Prefill) => {
    setPrefill(p ?? null);
    navigate('/cameras/add', { brand: b.id, step: tab === 'brands' ? undefined : tab });
  };

  return (
    <div className="page">
      <a className="back-link" href="#/cameras">
        <IconChevronLeft size={15} /> Cameras
      </a>
      <PageHeader title="Add a camera" description="Pick your camera brand, scan the network, or import from UniFi Protect." />
      <div className="tabs tabs-lg" role="tablist">
        {(
          [
            ['brands', 'Choose brand'],
            ['discover', 'Scan network'],
            ['unifi', 'UniFi Protect import'],
          ] as [Tab, string][]
        ).map(([k, l]) => (
          <button
            key={k}
            type="button"
            role="tab"
            aria-selected={tab === k}
            className={cx('tab', tab === k && 'is-active')}
            onClick={() => setQuery({ step: k === 'brands' ? undefined : k })}
          >
            {l}
          </button>
        ))}
      </div>
      {brandsError && <Alert>{brandsError}</Alert>}
      {tab === 'brands' && <BrandGrid brands={brands} onPick={(b) => pick(b)} />}
      {tab === 'discover' && <Discover brands={brands} onPick={pick} />}
      {tab === 'unifi' && <UnifiImport />}
    </div>
  );
}

function BrandGrid({ brands, onPick }: { brands: Brand[] | null; onPick: (b: Brand) => void }) {
  const [q, setQ] = useState('');
  const list = useMemo(() => {
    const all = (brands ?? []).filter((b) => b.id !== 'demo' || brands!.length < 3);
    const order = (b: Brand) => (b.id === 'generic' ? 2 : b.id === 'onvif' ? 1 : 0);
    return all
      .filter((b) => b.name.toLowerCase().includes(q.toLowerCase()))
      .sort((a, b) => order(a) - order(b));
  }, [brands, q]);
  if (!brands)
    return (
      <div className="brand-grid">
        {Array.from({ length: 12 }, (_, i) => (
          <Skeleton key={i} h={92} r={10} />
        ))}
      </div>
    );
  return (
    <>
      <Input className="brand-search" placeholder="Search brands…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search brands" />
      <div className="brand-grid">
        {list.map((b) => (
          <button key={b.id} type="button" className="brand-tile" onClick={() => onPick(b)}>
            <BrandMark id={b.id} name={b.name} />
            <span className="brand-name">{b.name}</span>
            <span className="brand-kinds">{b.kinds.map(kindLabel).join(' · ')}</span>
          </button>
        ))}
      </div>
      {list.length === 0 && (
        <EmptyState compact title="No matching brand">
          Most cameras support RTSP or ONVIF — try <strong>Generic RTSP</strong> or <strong>ONVIF</strong>.
        </EmptyState>
      )}
    </>
  );
}

/* ---------------- Discover ---------------- */

function Discover({ brands, onPick }: { brands: Brand[] | null; onPick: (b: Brand, p?: Prefill) => void }) {
  const [state, setState] = useState<'scanning' | 'done' | 'error'>('scanning');
  const [items, setItems] = useState<DiscoverCandidate[]>([]);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const scan = async () => {
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    setState('scanning');
    setError(null);
    try {
      const res = await api.discover(ac.signal);
      setItems(res.candidates);
      setState('done');
    } catch (e) {
      if ((e as Error).name === 'AbortError') return;
      setError(errorMessage(e));
      setState('error');
    }
  };

  useEffect(() => {
    void scan();
    return () => abortRef.current?.abort();
  }, []);

  const choose = (c: DiscoverCandidate) => {
    if (!brands) return;
    const b =
      brands.find((x) => x.id === c.brand) ?? brands.find((x) => x.id === (c.onvif ? 'onvif' : 'generic')) ?? brands.find((x) => x.id === 'generic');
    if (!b) return;
    const keys = new Set(b.fields.map((f) => f.key));
    const values: Record<string, string> = {};
    const hostKey = ['host', 'ip', 'address', 'hostname'].find((k) => keys.has(k));
    if (hostKey) values[hostKey] = c.host;
    if (keys.has('port') && c.port && c.port !== b.defaultPort) values.port = String(c.port);
    if (!hostKey && keys.has('url')) values.url = `rtsp://${c.host}:${c.port || 554}/`;
    onPick(b, { values, name: c.name });
  };

  return (
    <div className="card">
      <div className="discover-head">
        <div className={cx('radar', state === 'scanning' && 'is-scanning')}>
          <IconRadar size={22} />
        </div>
        <div className="grow">
          <div className="discover-title">
            {state === 'scanning' ? 'Scanning your network…' : state === 'error' ? 'Scan failed' : `${items.length} device${items.length === 1 ? '' : 's'} found`}
          </div>
          <div className="muted small">
            {state === 'scanning'
              ? 'Looking for ONVIF and RTSP cameras on the local network. This takes up to 8 seconds.'
              : 'Cameras on other subnets or VLANs may not show up — add them by brand instead.'}
          </div>
        </div>
        <Button variant="secondary" size="sm" icon={<IconRefresh size={14} />} onClick={() => void scan()} disabled={state === 'scanning'}>
          Scan again
        </Button>
      </div>
      {error && (
        <div className="card-body">
          <Alert>{error}</Alert>
        </div>
      )}
      {state === 'scanning' && (
        <div className="discover-list">
          {Array.from({ length: 3 }, (_, i) => (
            <div className="discover-row" key={i}>
              <Skeleton w={36} h={36} r={8} />
              <div className="grow">
                <Skeleton w="28%" h={12} />
                <Skeleton w="18%" h={10} className="mt-8" />
              </div>
            </div>
          ))}
        </div>
      )}
      {state === 'done' && items.length === 0 && (
        <EmptyState compact title="No cameras found">
          Make sure the camera is powered on and connected to the same network, then scan again.
        </EmptyState>
      )}
      {state === 'done' && items.length > 0 && (
        <div className="discover-list">
          {items.map((c) => {
            const b = brands?.find((x) => x.id === c.brand);
            return (
              <div className="discover-row" key={`${c.host}:${c.port}`}>
                <BrandMark id={c.brand ?? 'generic'} name={b?.name ?? c.brand ?? 'Camera'} size={36} />
                <div className="grow">
                  <div className="discover-name">{c.name ?? c.model ?? b?.name ?? 'Unknown camera'}</div>
                  <div className="muted small mono">
                    {c.host}:{c.port}
                    {c.model && c.name ? ` · ${c.model}` : ''}
                  </div>
                </div>
                <div className="row gap-6">
                  {c.onvif && <Badge>ONVIF</Badge>}
                  {c.rtsp && <Badge>RTSP</Badge>}
                </div>
                {c.alreadyAdded ? (
                  <Badge tone="accent">
                    <IconCheck size={12} /> Added
                  </Badge>
                ) : (
                  <Button size="sm" variant="primary" onClick={() => choose(c)}>
                    Set up
                  </Button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ---------------- UniFi ---------------- */

function UnifiImport() {
  const { refreshCameras } = useApp();
  const [host, setHost] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<UnifiImportResult | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await api.unifiImport({ host: host.trim(), username: username.trim(), password });
      setResult(r);
      void refreshCameras();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="split">
      <form className="card card-body stack-16" onSubmit={submit}>
        <FormField label="Console address" htmlFor="uf-host" hint="IP or hostname of your UniFi OS console (UDM, Cloud Key, UNVR).">
          <Input id="uf-host" className="mono-input" value={host} onChange={(e) => setHost(e.target.value)} placeholder="192.168.1.1" required />
        </FormField>
        <div className="form-grid">
          <FormField label="Username" htmlFor="uf-user">
            <Input id="uf-user" value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="off" required />
          </FormField>
          <FormField label="Password" htmlFor="uf-pass">
            <Input id="uf-pass" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" required />
          </FormField>
        </div>
        {error && <Alert>{error}</Alert>}
        <div className="row">
          <Button type="submit" variant="primary" loading={busy}>
            Import cameras
          </Button>
        </div>
        {result && (
          <div className="import-result">
            <div className="section-label">Imported from UniFi Protect</div>
            {result.cameras.length === 0 && <p className="muted small">No cameras were found on this console.</p>}
            {result.cameras.map((c) => (
              <div className="import-row" key={c.id}>
                <span className={cx('import-check', c.added && 'is-added')}>{c.added && <IconCheck size={13} />}</span>
                <span className="grow">{c.name}</span>
                <span className="muted small">{c.model}</span>
                <Badge tone={c.added ? 'accent' : 'neutral'}>{c.added ? 'Added' : 'Skipped'}</Badge>
              </div>
            ))}
            <Button variant="secondary" onClick={() => navigate('/cameras')}>
              Done
            </Button>
          </div>
        )}
      </form>
      <aside className="card card-body help-card">
        <div className="section-label">Before you start</div>
        <HelpText text={'Create a local user on the console (Admin > Users) with view access to Protect — cloud accounts with 2FA cannot be used.\nEnable RTSPS for each camera in Protect under Settings > Advanced.\nEnter the console address and the local user here. All cameras are imported at once.'} />
      </aside>
    </div>
  );
}

/* ---------------- Configure + test ---------------- */

function ConfigureCamera({
  brand,
  prefill,
  onBack,
  onCreated,
}: {
  brand: Brand;
  prefill: Prefill | null;
  onBack: () => void;
  onCreated: (c: Camera) => void;
}) {
  const { refreshCameras, cameras } = useApp();
  const [kind, setKind] = useState(brand.kinds[0] ?? '');
  const [name, setName] = useState(prefill?.name ?? '');
  const [values, setValues] = useState(() => initialValues(brand.fields, prefill?.values));
  const [test, setTest] = useState<CameraTestResult | null>(null);
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isPush = kind.includes('push');
  const fields = isPush ? brand.fields.filter((f) => !/url/i.test(f.key)) : brand.fields;

  const body = () => ({
    name: name.trim() || `${brand.name} camera ${(cameras?.length ?? 0) + 1}`,
    brand: brand.id,
    kind: brand.kinds.length > 1 ? kind : undefined,
    fields: Object.fromEntries(Object.entries(values).filter(([k, v]) => v.trim() !== '' && fields.some((f) => f.key === k))),
  });

  const validate = () => {
    const miss = missingRequired(fields, values);
    if (miss) {
      setError(`${miss.label} is required.`);
      return false;
    }
    setError(null);
    return true;
  };

  const runTest = async () => {
    if (!validate()) return;
    setTesting(true);
    setTest(null);
    try {
      setTest(await api.testCamera(body()));
    } catch (e) {
      setTest({ ok: false, error: errorMessage(e) });
    } finally {
      setTesting(false);
    }
  };

  const save = async (e?: FormEvent) => {
    e?.preventDefault();
    if (!validate()) return;
    setSaving(true);
    try {
      const cam = await api.createCamera(body());
      void refreshCameras();
      toast.success(`${cam.name} added`);
      onCreated(cam);
    } catch (err) {
      setError(errorMessage(err));
      setSaving(false);
    }
  };

  const snapshotSrc = test?.snapshot ? (test.snapshot.startsWith('data:') ? test.snapshot : `data:image/jpeg;base64,${test.snapshot}`) : null;

  return (
    <div className="page">
      <button type="button" className="back-link" onClick={onBack}>
        <IconChevronLeft size={15} /> All brands
      </button>
      <div className="configure-head">
        <BrandMark id={brand.id} name={brand.name} size={48} />
        <div>
          <h1 className="page-title">Add {brand.name} camera</h1>
          <p className="page-desc">Enter the connection details, test the stream, then save.</p>
        </div>
      </div>

      <div className="split">
        <form className="card card-body stack-16" onSubmit={save}>
          <FormField label="Camera name" htmlFor="ac-name" hint="Shown in the live view and notifications.">
            <Input id="ac-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Front Door" autoFocus />
          </FormField>
          {brand.kinds.length > 1 && (
            <FormField label="Connection type" htmlFor="ac-kind">
              <Select id="ac-kind" value={kind} onChange={(e) => (setKind(e.target.value), setTest(null))}>
                {brand.kinds.map((k) => (
                  <option key={k} value={k}>
                    {kindLabel(k)}
                  </option>
                ))}
              </Select>
            </FormField>
          )}
          {isPush && (
            <Alert tone="info">This camera sends its stream to OpenCCTV. After saving you'll get a URL to enter in the camera's settings.</Alert>
          )}
          <div className="form-grid">
            <FieldsForm fields={fields} values={values} onChange={(k, v) => (setValues((p) => ({ ...p, [k]: v })), setTest(null))} idPrefix="ac" />
          </div>
          {error && <Alert>{error}</Alert>}
          <div className="form-actions">
            {!isPush && (
              <Button variant="secondary" loading={testing} icon={<IconSnapshot size={16} />} onClick={() => void runTest()}>
                Test connection
              </Button>
            )}
            <Button type="submit" variant="primary" loading={saving} icon={<IconPlus size={16} />}>
              Add camera
            </Button>
          </div>
        </form>

        <aside className="stack-16">
          {!isPush && (
            <div className={cx('card test-card', test && (test.ok ? 'is-ok' : 'is-error'))}>
              <div className="test-preview">
                {snapshotSrc ? (
                  <img src={snapshotSrc} alt="Camera preview" />
                ) : (
                  <div className="test-empty">
                    {testing ? (
                      <>
                        <Spinner size={20} />
                        <span>Connecting to the camera…</span>
                      </>
                    ) : test && !test.ok ? (
                      <span className="test-err-text">No picture</span>
                    ) : (
                      <>
                        <IconSnapshot size={22} />
                        <span>Run a test to see a preview</span>
                      </>
                    )}
                  </div>
                )}
              </div>
              {test && (
                <div className="test-result">
                  {test.ok ? (
                    <>
                      <span className="test-ok">
                        <IconCheck size={14} /> Stream works
                      </span>
                      <div className="row gap-6 wrap">
                        {test.codec && <Badge>{test.codec}</Badge>}
                        {test.width && test.height && (
                          <Badge>
                            <span className="tabular">
                              {test.width}×{test.height}
                            </span>
                            {resolution(test.width, test.height) ? ` · ${resolution(test.width, test.height)}` : ''}
                          </Badge>
                        )}
                        {test.audio !== undefined && <Badge>{test.audio ? 'Audio' : 'No audio'}</Badge>}
                      </div>
                    </>
                  ) : (
                    <Alert>{test.error ?? 'The camera did not respond.'}</Alert>
                  )}
                </div>
              )}
            </div>
          )}
          {brand.help && (
            <div className="card card-body help-card">
              <div className="section-label">How to connect</div>
              <HelpText text={brand.help} />
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}

function AddDone({ camera, onAnother }: { camera: Camera; onAnother: () => void }) {
  return (
    <div className="page page-narrow">
      <div className="card card-body done-card">
        <div className="done-icon">
          <IconCheck size={26} />
        </div>
        <h1 className="page-title">{camera.name} is ready</h1>
        {camera.push ? (
          <>
            <p className="page-desc">Enter this URL in the camera's push / RTMP settings. The camera will appear online once it starts sending.</p>
            <CopyField value={camera.push.url} />
          </>
        ) : (
          <p className="page-desc">The camera was added and will start streaming and recording in a few seconds.</p>
        )}
        <div className="row gap-8 center">
          <Button variant="secondary" icon={<IconPlus size={16} />} onClick={onAnother}>
            Add another
          </Button>
          <Button variant="primary" icon={<IconLive size={16} />} onClick={() => navigate(`/live/${camera.id}`)}>
            Open live view <IconChevronRight size={14} />
          </Button>
        </div>
      </div>
    </div>
  );
}
