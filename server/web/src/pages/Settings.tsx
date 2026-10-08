import { useEffect, useState, type ReactNode } from 'react';
import { api, errorMessage } from '../api';
import { useApp, useAsync } from '../store';
import type { DeepPartial, Settings } from '../types';
import { toast } from '../components/feedback';
import { Alert, Button, FormField, Input, PageHeader, RangeInput, Skeleton, SwitchRow } from '../components/ui';

type Editable = Omit<Settings, 'gateway'>;

function Section({ title, description, children }: { title: string; description: string; children: ReactNode }) {
  return (
    <section className="settings-section">
      <div className="settings-aside">
        <h2 className="settings-title">{title}</h2>
        <p className="settings-desc">{description}</p>
      </div>
      <div className="card card-body settings-body">{children}</div>
    </section>
  );
}

function NumberInput({
  id,
  value,
  onChange,
  suffix,
  min = 0,
  max,
}: {
  id: string;
  value: number;
  onChange: (v: number) => void;
  suffix: string;
  min?: number;
  max?: number;
}) {
  return (
    <div className="input-suffix">
      <Input id={id} type="number" min={min} max={max} value={Number.isFinite(value) ? value : ''} onChange={(e) => onChange(e.target.value === '' ? NaN : Number(e.target.value))} />
      <span>{suffix}</span>
    </div>
  );
}

function diff(a: Editable, b: Editable): DeepPartial<Settings> {
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(b) as (keyof Editable)[]) {
    const av = a[k];
    const bv = b[k];
    if (typeof bv === 'object' && bv !== null) {
      const sub: Record<string, unknown> = {};
      for (const sk of Object.keys(bv)) {
        const x = (av as Record<string, unknown>)[sk];
        const y = (bv as Record<string, unknown>)[sk];
        if (x !== y) sub[sk] = y;
      }
      if (Object.keys(sub).length) out[k] = sub;
    } else if (av !== bv) out[k] = bv;
  }
  return out as DeepPartial<Settings>;
}

export function SettingsPage() {
  const { setServerName } = useApp();
  const { data, setData, error } = useAsync<Settings>(() => api.settings(), []);
  const [draft, setDraft] = useState<Editable | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (data) {
      const { gateway: _g, ...rest } = data;
      setDraft(structuredClone(rest));
    }
  }, [data]);

  if (error) return <div className="page"><PageHeader title="Settings" /><Alert>{error}</Alert></div>;
  if (!data || !draft)
    return (
      <div className="page">
        <PageHeader title="Settings" description="Server-wide defaults for recording, retention and notifications." />
        <div className="stack-16">
          <Skeleton h={120} w="100%" r={12} />
          <Skeleton h={180} w="100%" r={12} />
        </div>
      </div>
    );

  const { gateway: _g, ...original } = data;
  const changes = diff(original, draft);
  const dirty = Object.keys(changes).length > 0;
  const invalid = [
    draft.recording.segmentSeconds,
    draft.recording.preMotionSec,
    draft.recording.postMotionSec,
    draft.retention.localDays,
    draft.retention.maxLocalGB,
    draft.notifications.cooldownSec,
  ].some((n) => !Number.isFinite(n) || n < 0);

  const set = <K extends keyof Editable>(k: K, v: Partial<Editable[K]>) =>
    setDraft((d) => (d ? { ...d, [k]: typeof v === 'object' ? { ...(d[k] as object), ...v } : v } : d));

  const save = async () => {
    setBusy(true);
    try {
      const s = await api.updateSettings(changes);
      setData(s);
      setServerName(s.serverName);
      document.title = `${s.serverName} · OpenCCTV`;
      toast.success('Settings saved');
    } catch (e) {
      toast.error('Could not save settings', errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page">
      <PageHeader title="Settings" description="Server-wide defaults for recording, retention and notifications." />

      <Section title="General" description="How this server is shown in the app and browser.">
        <FormField label="Server name" htmlFor="s-name">
          <Input id="s-name" value={draft.serverName} onChange={(e) => setDraft({ ...draft, serverName: e.target.value })} placeholder="Home" />
        </FormField>
      </Section>

      <Section title="Recording" description="Recordings are split into segments. Motion clips include a few seconds before and after the movement.">
        <div className="form-grid form-grid-3">
          <FormField label="Segment length" htmlFor="s-seg">
            <NumberInput id="s-seg" value={draft.recording.segmentSeconds} onChange={(v) => set('recording', { segmentSeconds: v })} suffix="sec" min={10} />
          </FormField>
          <FormField label="Before motion" htmlFor="s-pre">
            <NumberInput id="s-pre" value={draft.recording.preMotionSec} onChange={(v) => set('recording', { preMotionSec: v })} suffix="sec" />
          </FormField>
          <FormField label="After motion" htmlFor="s-post">
            <NumberInput id="s-post" value={draft.recording.postMotionSec} onChange={(v) => set('recording', { postMotionSec: v })} suffix="sec" />
          </FormField>
        </div>
      </Section>

      <Section title="Retention" description="Old recordings are deleted automatically, whichever limit is reached first.">
        <div className="form-grid">
          <FormField label="Keep local recordings for" htmlFor="s-days">
            <NumberInput id="s-days" value={draft.retention.localDays} onChange={(v) => set('retention', { localDays: v })} suffix="days" />
          </FormField>
          <FormField label="Maximum disk usage" htmlFor="s-gb" hint="0 means no limit.">
            <NumberInput id="s-gb" value={draft.retention.maxLocalGB} onChange={(v) => set('retention', { maxLocalGB: v })} suffix="GB" />
          </FormField>
        </div>
        <SwitchRow
          title="Delete local copy after upload"
          description="Free up disk space once a segment is safely stored in every upload destination."
          checked={draft.retention.deleteLocalAfterUpload}
          onChange={(v) => set('retention', { deleteLocalAfterUpload: v })}
        />
      </Section>

      <Section title="Motion" description="Default for newly added cameras. Each camera can override it.">
        <FormField label="Default sensitivity" hint="Higher values react to smaller movements.">
          <RangeInput value={draft.motion.defaultSensitivity} min={1} max={10} onChange={(v) => set('motion', { defaultSensitivity: v })} label="Default sensitivity" />
        </FormField>
      </Section>

      <Section title="Notifications" description="Push notifications to paired phones when motion is detected.">
        <SwitchRow title="Send notifications" checked={draft.notifications.enabled} onChange={(v) => set('notifications', { enabled: v })} />
        <FormField label="Cooldown per camera" htmlFor="s-cool" hint="Minimum time between two notifications from the same camera.">
          <NumberInput id="s-cool" value={draft.notifications.cooldownSec} onChange={(v) => set('notifications', { cooldownSec: v })} suffix="sec" />
        </FormField>
      </Section>

      <div className={`savebar ${dirty ? 'is-visible' : ''}`} aria-hidden={!dirty}>
        <span>{invalid ? 'Some values are invalid' : 'You have unsaved changes'}</span>
        <div className="row gap-8">
          <Button variant="ghost" size="sm" onClick={() => setDraft(structuredClone(original))} tabIndex={dirty ? 0 : -1}>
            Discard
          </Button>
          <Button variant="primary" size="sm" loading={busy} disabled={invalid} onClick={() => void save()} tabIndex={dirty ? 0 : -1}>
            Save changes
          </Button>
        </div>
      </div>
    </div>
  );
}
