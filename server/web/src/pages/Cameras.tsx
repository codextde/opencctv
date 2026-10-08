import { useEffect, useMemo, useRef, useState } from 'react';
import { api, errorMessage } from '../api';
import { navigate, useRoute } from '../router';
import { useApp, useAsync } from '../store';
import type { Brand, Camera, CameraPatch, RecordingMode } from '../types';
import { relativeTime } from '../format';
import { cameraStatus, LiveSnapshot, streamInfo } from '../components/CameraMedia';
import { FieldsForm, initialValues } from '../components/FieldsForm';
import { confirm, toast } from '../components/feedback';
import {
  IconCamera, IconChevronDown, IconChevronUp, IconEdit, IconGrip, IconMotion, IconOffline, IconPlus, IconRadar,
} from '../components/icons';
import {
  Alert, Badge, Button, CopyField, cx, EmptyState, FormField, IconButton, Input, Modal, PageHeader, RangeInput,
  Skeleton, StatusDot, SwitchRow, Toggle,
} from '../components/ui';
import { AddCamera, BrandMark, kindLabel } from './AddCamera';

export function CamerasPage() {
  const route = useRoute();
  const { isAdmin } = useApp();
  const brands = useAsync(() => api.brands(), []);
  if (route.segments[1] === 'add' && isAdmin) return <AddCamera brands={brands.data} brandsError={brands.error} />;
  return <CameraList brands={brands.data} editId={isAdmin ? route.segments[1] : undefined} />;
}

const MODE_LABEL: Record<RecordingMode, string> = { continuous: 'Continuous', motion: 'Motion only', off: 'Not recording' };

function CameraList({ brands, editId }: { brands: Brand[] | null; editId?: string }) {
  const { cameras, camerasError, isAdmin, setCameras, refreshCameras, cameraById } = useApp();
  const [dragId, setDragId] = useState<string | null>(null);
  const orderBefore = useRef<string[]>([]);
  const brandName = (id: string) => brands?.find((b) => b.id === id)?.name ?? id;

  const commitOrder = async (list: Camera[]) => {
    const ids = list.map((c) => c.id);
    if (ids.join() === orderBefore.current.join()) return;
    try {
      await api.reorderCameras(ids);
    } catch (e) {
      toast.error('Could not save order', errorMessage(e));
      void refreshCameras();
    }
  };

  const move = (id: string, dir: -1 | 1) => {
    if (!cameras) return;
    const list = cameras.slice();
    const i = list.findIndex((c) => c.id === id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j]!, list[i]!];
    const next = list.map((c, k) => ({ ...c, order: k }));
    orderBefore.current = cameras.map((c) => c.id);
    setCameras(() => next);
    void commitOrder(next);
  };

  const onDragOver = (overId: string) => {
    if (!dragId || dragId === overId || !cameras) return;
    const list = cameras.slice();
    const from = list.findIndex((c) => c.id === dragId);
    const to = list.findIndex((c) => c.id === overId);
    const [item] = list.splice(from, 1);
    list.splice(to, 0, item!);
    setCameras(() => list.map((c, k) => ({ ...c, order: k })));
  };

  const toggleEnabled = async (c: Camera, enabled: boolean) => {
    setCameras((prev) => prev.map((x) => (x.id === c.id ? { ...x, enabled } : x)));
    try {
      const updated = await api.updateCamera(c.id, { enabled });
      setCameras((prev) => prev.map((x) => (x.id === c.id ? updated : x)));
    } catch (e) {
      toast.error('Could not update camera', errorMessage(e));
      void refreshCameras();
    }
  };

  const editing = cameraById(editId);

  return (
    <div className="page">
      <PageHeader
        title="Cameras"
        description={isAdmin ? 'Add, configure and arrange your cameras. Drag to change the order in the live view.' : 'Cameras on this server.'}
        actions={
          isAdmin && (
            <>
              <Button variant="secondary" icon={<IconRadar size={16} />} onClick={() => navigate('/cameras/add', { step: 'discover' })}>
                Scan network
              </Button>
              <Button variant="primary" icon={<IconPlus size={16} />} onClick={() => navigate('/cameras/add')}>
                Add camera
              </Button>
            </>
          )
        }
      />
      {camerasError && <Alert>{camerasError}</Alert>}
      {!cameras && !camerasError && (
        <div className="card cam-list">
          {Array.from({ length: 4 }, (_, i) => (
            <div className="cam-row" key={i}>
              <Skeleton w={96} h={54} r={6} />
              <div className="grow">
                <Skeleton w="30%" h={12} />
                <Skeleton w="20%" h={10} className="mt-8" />
              </div>
            </div>
          ))}
        </div>
      )}
      {cameras && cameras.length === 0 && (
        <EmptyState
          icon={<IconCamera size={26} />}
          title="No cameras yet"
          action={
            isAdmin && (
              <Button variant="primary" icon={<IconPlus size={16} />} onClick={() => navigate('/cameras/add')}>
                Add your first camera
              </Button>
            )
          }
        >
          OpenCCTV supports RTSP and ONVIF cameras, Tapo, UniFi Protect, Reolink, Hikvision, Dahua and more — plus cameras that push RTMP.
        </EmptyState>
      )}
      {cameras && cameras.length > 0 && (
        <div className="card cam-list">
          {cameras.map((c, i) => {
            const st = cameraStatus(c);
            const info = streamInfo(c);
            return (
              <div
                key={c.id}
                className={cx('cam-row', dragId === c.id && 'is-dragging', isAdmin && 'is-editable')}
                draggable={isAdmin}
                onDragStart={(e) => {
                  orderBefore.current = cameras.map((x) => x.id);
                  setDragId(c.id);
                  e.dataTransfer.effectAllowed = 'move';
                  e.dataTransfer.setData('text/plain', c.id);
                }}
                onDragOver={(e) => {
                  if (!dragId) return;
                  e.preventDefault();
                  onDragOver(c.id);
                }}
                onDragEnd={() => {
                  setDragId(null);
                  if (cameras) void commitOrder(cameras);
                }}
                onClick={(e) => {
                  if (isAdmin && !(e.target as HTMLElement).closest('button, a, [role=switch]')) navigate(`/cameras/${c.id}`);
                }}
              >
                {isAdmin && (
                  <span className="cam-grip" aria-hidden="true">
                    <IconGrip size={16} />
                  </span>
                )}
                <div className="cam-thumb">
                  {c.enabled && c.status.online ? (
                    <LiveSnapshot cameraId={c.id} width={320} interval={15000} />
                  ) : (
                    <div className="cam-thumb-off">
                      <IconOffline size={18} />
                    </div>
                  )}
                </div>
                <div className="cam-main">
                  <div className="cam-name">
                    {c.name}
                    {c.group && <Badge>{c.group}</Badge>}
                  </div>
                  <div className="cam-sub">
                    {brandName(c.brand)} · {kindLabel(c.source.kind)}
                    {info && <span className="tabular"> · {info}</span>}
                  </div>
                </div>
                <div className="cam-status">
                  <div className="cam-status-line">
                    <StatusDot status={st.dot} />
                    <span>{st.label}</span>
                  </div>
                  <div className="cam-status-sub" title={c.status.error}>
                    {c.enabled && !c.status.online
                      ? c.status.error ?? `Last seen ${relativeTime(c.status.lastSeen)}`
                      : MODE_LABEL[c.recording.mode]}
                    {c.motion.enabled && c.enabled && c.status.online && (
                      <span className="cam-motion" title={`Motion detection · sensitivity ${c.motion.sensitivity}`}>
                        <IconMotion size={13} />
                      </span>
                    )}
                  </div>
                </div>
                {isAdmin && (
                  <div className="cam-actions">
                    <div className="cam-move">
                      <IconButton label="Move up" disabled={i === 0} onClick={() => move(c.id, -1)}>
                        <IconChevronUp size={15} />
                      </IconButton>
                      <IconButton label="Move down" disabled={i === cameras.length - 1} onClick={() => move(c.id, 1)}>
                        <IconChevronDown size={15} />
                      </IconButton>
                    </div>
                    <Toggle size="sm" checked={c.enabled} onChange={(v) => void toggleEnabled(c, v)} label={`${c.name} enabled`} />
                    <IconButton label="Edit" onClick={() => navigate(`/cameras/${c.id}`)}>
                      <IconEdit size={16} />
                    </IconButton>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
      {editing && <CameraEditor camera={editing} brand={brands?.find((b) => b.id === editing.brand)} onClose={() => navigate('/cameras')} />}
    </div>
  );
}

/* ---------------- Editor ---------------- */

type Tab = 'general' | 'recording' | 'motion' | 'connection';

function CameraEditor({ camera, brand, onClose }: { camera: Camera; brand?: Brand; onClose: () => void }) {
  const { setCameras } = useApp();
  const [tab, setTab] = useState<Tab>('general');
  const [name, setName] = useState(camera.name);
  const [group, setGroup] = useState(camera.group ?? '');
  const [enabled, setEnabled] = useState(camera.enabled);
  const [recording, setRecording] = useState(camera.recording);
  const [motion, setMotion] = useState(camera.motion);
  const [fields, setFields] = useState<Record<string, string>>(() => initialValues(brand?.fields ?? []));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (brand) setFields(initialValues(brand.fields));
  }, [brand]);

  const fieldsChanged = useMemo(() => Object.values(fields).some((v) => v.trim() !== ''), [fields]);

  const save = async () => {
    if (!name.trim()) return setError('Give the camera a name.');
    const patch: CameraPatch = {};
    if (name !== camera.name) patch.name = name.trim();
    if (group !== (camera.group ?? '')) patch.group = group.trim();
    if (enabled !== camera.enabled) patch.enabled = enabled;
    if (JSON.stringify(recording) !== JSON.stringify(camera.recording)) patch.recording = recording;
    if (JSON.stringify(motion) !== JSON.stringify(camera.motion)) patch.motion = motion;
    if (fieldsChanged) patch.fields = Object.fromEntries(Object.entries(fields).filter(([, v]) => v.trim() !== ''));
    if (Object.keys(patch).length === 0) return onClose();
    setBusy(true);
    setError(null);
    try {
      const updated = await api.updateCamera(camera.id, patch);
      setCameras((prev) => prev.map((c) => (c.id === camera.id ? updated : c)));
      toast.success('Camera saved');
      onClose();
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  };

  const remove = async () => {
    const ok = await confirm({
      title: `Delete ${camera.name}?`,
      message: 'The camera is removed from OpenCCTV. Existing recordings are kept until retention deletes them.',
      confirmLabel: 'Delete camera',
      danger: true,
    });
    if (!ok) return;
    try {
      await api.deleteCamera(camera.id);
      setCameras((prev) => prev.filter((c) => c.id !== camera.id));
      toast.success(`${camera.name} deleted`);
      onClose();
    } catch (e) {
      toast.error('Could not delete camera', errorMessage(e));
    }
  };

  const st = cameraStatus(camera);

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title={camera.name}
      description={
        <span className="row gap-6">
          <StatusDot status={st.dot} /> {st.label}
          {streamInfo(camera) && <span className="muted tabular">· {streamInfo(camera)}</span>}
        </span>
      }
      footer={
        <>
          <Button variant="danger-ghost" onClick={() => void remove()} className="mr-auto">
            Delete camera
          </Button>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" loading={busy} onClick={() => void save()}>
            Save changes
          </Button>
        </>
      }
    >
      <div className="tabs" role="tablist">
        {(
          [
            ['general', 'General'],
            ['recording', 'Recording'],
            ['motion', 'Motion'],
            ['connection', 'Connection'],
          ] as [Tab, string][]
        ).map(([k, l]) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} className={cx('tab', tab === k && 'is-active')} onClick={() => setTab(k)}>
            {l}
          </button>
        ))}
      </div>

      <div className="tab-panel">
        {tab === 'general' && (
          <div className="form-grid">
            <FormField label="Name" htmlFor="ce-name">
              <Input id="ce-name" value={name} onChange={(e) => setName(e.target.value)} />
            </FormField>
            <FormField label="Group" htmlFor="ce-group" optional hint="Used to filter the live view, e.g. Outside or Upstairs.">
              <Input id="ce-group" value={group} onChange={(e) => setGroup(e.target.value)} placeholder="Outside" />
            </FormField>
            <div className="span-2">
              <SwitchRow title="Enabled" description="Disabled cameras are not streamed, recorded or analysed." checked={enabled} onChange={setEnabled} />
            </div>
            {camera.push && (
              <div className="span-2">
                <FormField label="Push URL" hint="Enter this URL in your camera's RTMP / RTSP push settings.">
                  <CopyField value={camera.push.url} />
                </FormField>
              </div>
            )}
          </div>
        )}

        {tab === 'recording' && (
          <div className="stack-16">
            <FormField label="Recording mode">
              <div className="choice-grid">
                {(
                  [
                    ['continuous', 'Continuous', 'Record around the clock.'],
                    ['motion', 'Motion only', 'Save clips when something moves.'],
                    ['off', 'Off', 'Live view only, nothing is stored.'],
                  ] as [RecordingMode, string, string][]
                ).map(([v, t, d]) => (
                  <button
                    key={v}
                    type="button"
                    className={cx('choice', recording.mode === v && 'is-active')}
                    onClick={() => setRecording({ ...recording, mode: v })}
                    aria-pressed={recording.mode === v}
                  >
                    <span className="choice-radio" />
                    <span className="choice-title">{t}</span>
                    <span className="choice-desc">{d}</span>
                  </button>
                ))}
              </div>
            </FormField>
            <SwitchRow
              title="Record the sub stream"
              description={
                camera.capabilities.substream
                  ? 'Uses the lower-resolution stream to save disk space.'
                  : 'This camera does not provide a sub stream.'
              }
              checked={recording.useSubstream}
              disabled={!camera.capabilities.substream}
              onChange={(v) => setRecording({ ...recording, useSubstream: v })}
            />
          </div>
        )}

        {tab === 'motion' && (
          <div className="stack-16">
            <SwitchRow title="Motion detection" description="Detect movement and create events." checked={motion.enabled} onChange={(v) => setMotion({ ...motion, enabled: v })} />
            <FormField label="Sensitivity" hint="Higher values react to smaller movements. Lower it if trees or rain trigger events.">
              <RangeInput value={motion.sensitivity} min={1} max={10} onChange={(v) => setMotion({ ...motion, sensitivity: v })} label="Sensitivity" />
            </FormField>
            <SwitchRow
              title="Push notifications"
              description="Notify paired phones when motion is detected."
              checked={motion.notify}
              disabled={!motion.enabled}
              onChange={(v) => setMotion({ ...motion, notify: v })}
            />
          </div>
        )}

        {tab === 'connection' && (
          <div className="stack-16">
            <div className="kv">
              <div className="kv-row">
                <span>Brand</span>
                <span className="row gap-8">
                  <BrandMark id={camera.brand} name={brand?.name ?? camera.brand} size={20} />
                  {brand?.name ?? camera.brand}
                </span>
              </div>
              <div className="kv-row">
                <span>Type</span>
                <span>{kindLabel(camera.source.kind)}</span>
              </div>
              {camera.source.url && (
                <div className="kv-row">
                  <span>Stream</span>
                  <code className="mono truncate">{camera.source.url}</code>
                </div>
              )}
              {camera.source.subUrl && (
                <div className="kv-row">
                  <span>Sub stream</span>
                  <code className="mono truncate">{camera.source.subUrl}</code>
                </div>
              )}
            </div>
            {brand && brand.fields.length > 0 ? (
              <>
                <p className="muted small">Fill in only what you want to change — empty fields keep their current value.</p>
                <div className="form-grid">
                  <FieldsForm
                    fields={brand.fields.map((f) => ({ ...f, required: false }))}
                    values={fields}
                    onChange={(k, v) => setFields((p) => ({ ...p, [k]: v }))}
                    idPrefix="ce"
                    secretPlaceholder="Unchanged"
                  />
                </div>
              </>
            ) : (
              <Skeleton h={80} w="100%" r={8} />
            )}
          </div>
        )}
        {error && <Alert>{error}</Alert>}
      </div>
    </Modal>
  );
}
