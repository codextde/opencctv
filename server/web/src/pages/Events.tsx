import { useEffect, useMemo, useState } from 'react';
import { api, errorMessage, media } from '../api';
import { setQuery, useRoute } from '../router';
import { useApp, useLive } from '../store';
import type { MotionEvent } from '../types';
import { dayKey, fmtDate, fmtTime, fmtTimeSec, relativeTime } from '../format';
import { PlaybackModal } from '../components/Playback';
import { IconEvents, IconPlay } from '../components/icons';
import { Alert, Button, EmptyState, PageHeader, Select, Skeleton } from '../components/ui';

export function EventsPage() {
  const { cameras, cameraById } = useApp();
  const route = useRoute();
  const camera = route.query.get('camera') || '';
  const [items, setItems] = useState<MotionEvent[] | null>(null);
  const [cursor, setCursor] = useState<string | undefined>();
  const [error, setError] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [open, setOpen] = useState<MotionEvent | null>(null);

  const load = async (before?: string) => {
    try {
      const res = await api.events({ camera: camera || undefined, before, limit: 48 });
      setItems((prev) => (before && prev ? [...prev, ...res.items] : res.items));
      setCursor(res.nextCursor);
      setError(null);
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  useEffect(() => {
    setItems(null);
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [camera]);

  useLive((m) => {
    if (m.type === 'motion' && (!camera || m.event.cameraId === camera))
      setItems((prev) => (prev && !prev.some((e) => e.id === m.event.id) ? [m.event, ...prev] : prev));
  });

  // group by day
  const groups = useMemo(() => {
    const out: { day: string; label: string; items: MotionEvent[] }[] = [];
    const today = dayKey(new Date());
    const yesterday = dayKey(new Date(Date.now() - 86400e3));
    for (const ev of items ?? []) {
      const d = dayKey(new Date(ev.start));
      let g = out[out.length - 1];
      if (!g || g.day !== d) {
        g = { day: d, label: d === today ? 'Today' : d === yesterday ? 'Yesterday' : fmtDate(ev.start), items: [] };
        out.push(g);
      }
      g.items.push(ev);
    }
    return out;
  }, [items]);

  return (
    <div className="page page-wide">
      <PageHeader
        title="Events"
        description="Motion detected by your cameras, newest first."
        actions={
          <Select value={camera} onChange={(e) => setQuery({ camera: e.target.value || undefined })} aria-label="Camera" className="toolbar-select">
            <option value="">All cameras</option>
            {(cameras ?? []).map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        }
      />

      {error && <Alert>{error}</Alert>}

      {!items && !error && (
        <div className="event-grid">
          {Array.from({ length: 12 }, (_, i) => (
            <div className="event-card" key={i}>
              <Skeleton className="event-thumb" r={0} />
              <div className="event-meta">
                <Skeleton w="50%" h={11} />
              </div>
            </div>
          ))}
        </div>
      )}

      {items && items.length === 0 && (
        <EmptyState icon={<IconEvents size={26} />} title="No motion events yet">
          When a camera with motion detection sees movement, the event shows up here with a snapshot. Enable motion detection per camera under
          Cameras.
        </EmptyState>
      )}

      {groups.map((g) => (
        <section key={g.day} className="event-group">
          <div className="section-label">
            {g.label}
            <span className="section-count tabular">{g.items.length}</span>
          </div>
          <div className="event-grid">
            {g.items.map((ev) => {
              const cam = cameraById(ev.cameraId);
              return (
                <button key={ev.id} type="button" className="event-card" onClick={() => setOpen(ev)}>
                  <div className="event-thumb">
                    <img src={media.eventSnapshot(ev.id)} alt="" loading="lazy" />
                    {ev.recordingId && (
                      <span className="event-play">
                        <IconPlay size={16} />
                      </span>
                    )}
                    <span className="event-score tabular" title="Motion score">
                      {Math.round(ev.score * 100)}%
                    </span>
                  </div>
                  <div className="event-meta">
                    <span className="event-cam">{cam?.name ?? 'Unknown camera'}</span>
                    <span className="event-time tabular" title={new Date(ev.start).toLocaleString()}>
                      {g.label === 'Today' ? relativeTime(ev.start) : fmtTime(ev.start)}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        </section>
      ))}

      {cursor && items && items.length > 0 && (
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
            Load older events
          </Button>
        </div>
      )}

      {open && (
        <PlaybackModal
          title={`Motion · ${cameraById(open.cameraId)?.name ?? 'Camera'}`}
          subtitle={`${fmtDate(open.start)} at ${fmtTimeSec(open.start)}`}
          recordingId={open.recordingId}
          offsetSec={Math.max(0, (open.offsetSec ?? 0) - 2)}
          fallbackImage={media.eventSnapshot(open.id)}
          onClose={() => setOpen(null)}
        />
      )}
    </div>
  );
}
