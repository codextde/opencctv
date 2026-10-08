import { useEffect, useMemo, useState } from 'react';
import { api, errorMessage, media } from '../api';
import { setQuery, useRoute } from '../router';
import { useApp, useAsync, useLive } from '../store';
import type { MotionEvent, Recording, Timeline } from '../types';
import {
  addDays, dayKey, fmtDate, fmtTime, fmtTimeSec, fmtWeekday, formatBytes, formatDuration, formatUptime, parseDay, timeZone,
} from '../format';
import { PlaybackModal, RecordingVideo, TimelineBar } from '../components/Playback';
import { confirm, toast } from '../components/feedback';
import {
  IconChevronLeft, IconChevronRight, IconDownload, IconList, IconMotion, IconPlay, IconRecordings, IconTimeline,
  IconTrash,
} from '../components/icons';
import { Alert, Badge, Button, cx, EmptyState, IconButton, PageHeader, Segmented, Select, Skeleton } from '../components/ui';

export function RecordingsPage() {
  const { cameras } = useApp();
  const route = useRoute();
  const today = dayKey(new Date());
  const day = route.query.get('day') || today;
  const view = (route.query.get('view') as 'timeline' | 'list') || 'timeline';
  const cameraParam = route.query.get('camera') || '';
  const camera = view === 'timeline' ? cameraParam || cameras?.[0]?.id || '' : cameraParam;
  const [days, setDays] = useState<string[]>([]);

  return (
    <div className="page page-wide">
      <PageHeader
        title="Recordings"
        description={view === 'timeline' ? 'Browse footage by day. Click anywhere on the timeline to jump to that moment.' : 'Every recorded clip for the selected day, newest first.'}
        actions={
          <Segmented
            size="sm"
            value={view}
            onChange={(v) => setQuery({ view: v === 'timeline' ? undefined : v })}
            ariaLabel="View"
            options={[
              { value: 'timeline', label: <span className="seg-icon"><IconTimeline size={15} /> Timeline</span> },
              { value: 'list', label: <span className="seg-icon"><IconList size={15} /> List</span> },
            ]}
          />
        }
      />

      <div className="toolbar">
        <Select value={camera} onChange={(e) => setQuery({ camera: e.target.value || undefined })} aria-label="Camera" className="toolbar-select">
          {view === 'list' && <option value="">All cameras</option>}
          {(cameras ?? []).map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </Select>
        <DayStrip day={day} days={days} onChange={(d) => setQuery({ day: d === today ? undefined : d })} />
      </div>

      {view === 'timeline' ? (
        camera ? (
          <TimelineView key={camera} camera={camera} day={day} onDays={setDays} />
        ) : cameras ? (
          <EmptyState icon={<IconRecordings size={26} />} title="No cameras">
            Add a camera to start recording.
          </EmptyState>
        ) : (
          <Skeleton h={420} r={12} w="100%" />
        )
      ) : (
        <ListView camera={camera} day={day} onDays={setDays} />
      )}
    </div>
  );
}

function DayStrip({ day, days, onChange }: { day: string; days: string[]; onChange: (d: string) => void }) {
  const today = dayKey(new Date());
  const set = useMemo(() => new Set(days), [days]);
  // window of 7 days ending at max(day, ...) — keep the selected day visible
  const end = day > addDays(today, -4) ? today : addDays(day, 3);
  const list = Array.from({ length: 7 }, (_, i) => addDays(end, i - 6));
  return (
    <div className="daystrip">
      <IconButton label="Previous day" onClick={() => onChange(addDays(day, -1))}>
        <IconChevronLeft size={16} />
      </IconButton>
      <div className="daystrip-days">
        {list.map((d) => {
          const date = parseDay(d);
          return (
            <button
              key={d}
              type="button"
              className={cx('day', d === day && 'is-active', set.has(d) && 'has-footage')}
              onClick={() => onChange(d)}
              aria-pressed={d === day}
            >
              <span className="day-wd">{d === today ? 'Today' : fmtWeekday(date)}</span>
              <span className="day-n tabular">{date.getDate()}</span>
              <span className="day-dot" />
            </button>
          );
        })}
      </div>
      <IconButton label="Next day" onClick={() => onChange(addDays(day, 1))} disabled={day >= today}>
        <IconChevronRight size={16} />
      </IconButton>
      <input
        type="date"
        className="input date-input"
        value={day}
        max={today}
        onChange={(e) => e.target.value && onChange(e.target.value)}
        aria-label="Pick a date"
      />
    </div>
  );
}

/* ---------------- Timeline view ---------------- */

function TimelineView({ camera, day, onDays }: { camera: string; day: string; onDays: (d: string[]) => void }) {
  const { cameraById } = useApp();
  const cam = cameraById(camera);
  const dayStart = parseDay(day).getTime();
  const { data, error, loading, reload } = useAsync<Timeline>(() => api.timeline({ camera, day, tz: timeZone() }), [camera, day]);
  const [sel, setSel] = useState<{ recordingId: string; offset: number; base: number } | null>(null);
  const [pos, setPos] = useState<number | null>(null);

  useEffect(() => {
    if (data) onDays(data.days);
  }, [data, onDays]);
  useEffect(() => {
    setSel(null);
    setPos(null);
  }, [camera, day]);

  useLive((m) => {
    if (m.type === 'recording' && m.recording.cameraId === camera) void reload();
  });

  const ranges = useMemo(
    () =>
      (data?.ranges ?? [])
        .map((r) => ({ ...r, s: new Date(r.start).getTime(), e: new Date(r.end).getTime() }))
        .sort((a, b) => a.s - b.s),
    [data],
  );

  const seek = (ms: number) => {
    let r = ranges.find((x) => ms >= x.s && ms < x.e);
    let at = ms;
    if (!r) {
      r = ranges.find((x) => x.s > ms);
      if (!r) {
        toast({ title: 'No footage', description: `Nothing recorded after ${fmtTime(new Date(ms))} on this day.` });
        return;
      }
      at = r.s;
    }
    setSel({ recordingId: r.recordingId, offset: (at - r.s) / 1000, base: r.s });
    setPos(at);
  };

  const playNext = () => {
    if (!sel) return;
    const i = ranges.findIndex((x) => x.recordingId === sel.recordingId);
    const n = ranges[i + 1];
    if (n) {
      setSel({ recordingId: n.recordingId, offset: 0, base: n.s });
      setPos(n.s);
    }
  };

  const openEvent = (ev: MotionEvent) => {
    if (ev.recordingId) {
      const r = ranges.find((x) => x.recordingId === ev.recordingId);
      const base = r?.s ?? new Date(ev.start).getTime() - (ev.offsetSec ?? 0) * 1000;
      setSel({ recordingId: ev.recordingId, offset: ev.offsetSec ?? 0, base });
      setPos(base + (ev.offsetSec ?? 0) * 1000);
    } else seek(new Date(ev.start).getTime());
  };

  const totalSec = ranges.reduce((a, r) => a + (r.e - r.s) / 1000, 0);

  return (
    <div className="tl-layout">
      <div className="card tl-player-card">
        <div className="tl-player">
          {sel ? (
            <RecordingVideo
              recordingId={sel.recordingId}
              offsetSec={sel.offset}
              onTime={(t) => setPos(sel.base + t * 1000)}
              onEnded={playNext}
              className="tl-video"
            />
          ) : (
            <div className="tl-placeholder">
              {cam && cam.status.online && <img className="tl-placeholder-img" src={media.snapshot(camera, 1280)} alt="" />}
              <div className="tl-placeholder-inner">
                <span className="tl-placeholder-icon">
                  <IconPlay size={20} />
                </span>
                <div className="tl-placeholder-title">{ranges.length ? 'Pick a moment on the timeline' : loading ? 'Loading footage…' : 'No footage on this day'}</div>
                {ranges.length > 0 && (
                  <Button size="sm" variant="secondary" onClick={() => seek(ranges[ranges.length - 1]!.s)}>
                    Play latest clip
                  </Button>
                )}
              </div>
            </div>
          )}
        </div>
        <div className="tl-bar-wrap">
          <div className="tl-bar-head">
            <div className="tl-bar-title">
              <span>{cam?.name ?? 'Camera'}</span>
              <span className="muted">{fmtDate(parseDay(day))}</span>
            </div>
            <div className="tl-legend">
              <span><i className="lg-rec" /> Recorded <b className="tabular">{formatUptime(totalSec)}</b></span>
              <span><i className="lg-motion" /> Motion <b className="tabular">{data?.events.length ?? 0}</b></span>
            </div>
          </div>
          {loading && !data ? <Skeleton h={56} r={8} w="100%" /> : <TimelineBar dayStart={dayStart} timeline={data} playhead={pos} onSeek={seek} onEvent={openEvent} />}
          {error && <Alert>{error}</Alert>}
        </div>
      </div>

      {data && data.events.length > 0 && (
        <div className="tl-events">
          <div className="section-label">Motion on this day</div>
          <div className="tl-events-scroll">
            {[...data.events]
              .sort((a, b) => b.start.localeCompare(a.start))
              .map((ev) => (
                <button key={ev.id} type="button" className="mini-event" onClick={() => openEvent(ev)}>
                  <img src={media.eventSnapshot(ev.id)} alt="" loading="lazy" />
                  <span className="mini-event-time tabular">{fmtTimeSec(ev.start)}</span>
                </button>
              ))}
          </div>
        </div>
      )}
    </div>
  );
}

/* ---------------- List view ---------------- */

function ListView({ camera, day, onDays }: { camera: string; day: string; onDays: (d: string[]) => void }) {
  const { cameraById, isAdmin } = useApp();
  const [items, setItems] = useState<Recording[] | null>(null);
  const [cursor, setCursor] = useState<string | undefined>();
  const [error, setError] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [playing, setPlaying] = useState<Recording | null>(null);

  const from = parseDay(day);
  const to = parseDay(addDays(day, 1));

  const load = async (next?: string) => {
    try {
      const res = await api.recordings({ camera: camera || undefined, from: from.toISOString(), to: to.toISOString(), limit: 50, cursor: next });
      setItems((prev) => (next && prev ? [...prev, ...res.items] : res.items));
      setCursor(res.nextCursor);
      setError(null);
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  useEffect(() => {
    setItems(null);
    void load();
    onDays([]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [camera, day]);

  useLive((m) => {
    if (m.type === 'recording' && (!camera || m.recording.cameraId === camera) && day === dayKey(new Date()))
      setItems((prev) => (prev && !prev.some((r) => r.id === m.recording.id) ? [m.recording, ...prev] : prev));
  });

  const remove = async (r: Recording) => {
    const ok = await confirm({
      title: 'Delete recording?',
      message: `The ${formatDuration(r.durationSec)} clip from ${fmtTime(r.start)} will be removed from all storage locations.`,
      confirmLabel: 'Delete',
      danger: true,
    });
    if (!ok) return;
    try {
      await api.deleteRecording(r.id);
      setItems((prev) => prev?.filter((x) => x.id !== r.id) ?? null);
      toast.success('Recording deleted');
    } catch (e) {
      toast.error('Could not delete', errorMessage(e));
    }
  };

  if (error && !items) return <Alert>{error}</Alert>;
  if (!items)
    return (
      <div className="rec-list">
        {Array.from({ length: 6 }, (_, i) => (
          <div className="rec-row" key={i}>
            <Skeleton w={112} h={63} r={6} />
            <div className="grow">
              <Skeleton w="40%" h={12} />
              <Skeleton w="25%" h={10} className="mt-8" />
            </div>
          </div>
        ))}
      </div>
    );
  if (items.length === 0)
    return (
      <EmptyState icon={<IconRecordings size={26} />} title="No recordings on this day">
        Try another day or camera. Cameras set to motion recording only save clips when something moves.
      </EmptyState>
    );

  return (
    <>
      <div className="rec-list card">
        {items.map((r) => {
          const cam = cameraById(r.cameraId);
          return (
            <div className="rec-row" key={r.id}>
              <button type="button" className="rec-thumb" onClick={() => setPlaying(r)} aria-label="Play">
                <img src={media.thumb(r.id)} alt="" loading="lazy" />
                <span className="rec-thumb-play">
                  <IconPlay size={16} />
                </span>
                <span className="rec-thumb-dur tabular">{formatDuration(r.durationSec)}</span>
              </button>
              <div className="rec-main">
                <div className="rec-title">
                  <span className="tabular">
                    {fmtTime(r.start)} – {fmtTime(r.end)}
                  </span>
                  {!camera && <span className="muted">{cam?.name ?? r.cameraId}</span>}
                </div>
                <div className="rec-badges">
                  <Badge tone={r.location === 'local' ? 'neutral' : r.location === 'remote' ? 'info' : 'accent'}>
                    {r.location === 'both' ? 'Local + cloud' : r.location === 'remote' ? 'Cloud' : 'Local'}
                  </Badge>
                  {r.motion && (
                    <Badge tone="warn">
                      <IconMotion size={12} /> Motion
                    </Badge>
                  )}
                </div>
              </div>
              <div className="rec-size tabular muted">{formatBytes(r.sizeBytes)}</div>
              <div className="rec-actions">
                <a className="icon-btn" href={media.video(r.id)} download title="Download" aria-label="Download">
                  <IconDownload size={16} />
                </a>
                {isAdmin && (
                  <IconButton label="Delete" className="danger-hover" onClick={() => void remove(r)}>
                    <IconTrash size={16} />
                  </IconButton>
                )}
              </div>
            </div>
          );
        })}
      </div>
      {cursor && (
        <div className="load-more">
          <Button
            variant="secondary"
            loading={loadingMore}
            onClick={async () => {
              setLoadingMore(true);
              await load(cursor);
              setLoadingMore(false);
            }}
          >
            Load more
          </Button>
        </div>
      )}
      {playing && (
        <PlaybackModal
          title={cameraById(playing.cameraId)?.name ?? 'Recording'}
          subtitle={`${fmtDate(playing.start)} · ${fmtTime(playing.start)} – ${fmtTime(playing.end)}`}
          recordingId={playing.id}
          onClose={() => setPlaying(null)}
        />
      )}
    </>
  );
}
