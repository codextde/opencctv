import { useEffect, useMemo, useRef, useState, type MouseEvent as RMouseEvent } from 'react';
import { isMock, media } from '../api';
import type { MotionEvent, Timeline } from '../types';
import { fmtTime, fmtTimeSec } from '../format';
import { cx, Modal } from './ui';

/** Video element for a recording. In preview (mock) mode shows a still instead. */
export function RecordingVideo({
  recordingId,
  offsetSec = 0,
  autoPlay = true,
  onTime,
  onEnded,
  className,
}: {
  recordingId: string;
  offsetSec?: number;
  autoPlay?: boolean;
  onTime?: (sec: number) => void;
  onEnded?: () => void;
  className?: string;
}) {
  const ref = useRef<HTMLVideoElement>(null);
  const src = media.video(recordingId);

  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    const seek = () => {
      if (offsetSec > 0 && Math.abs(v.currentTime - offsetSec) > 0.5) v.currentTime = offsetSec;
    };
    if (v.readyState >= 1) seek();
    else v.addEventListener('loadedmetadata', seek, { once: true });
    return () => v.removeEventListener('loadedmetadata', seek);
  }, [recordingId, offsetSec]);

  if (isMock())
    return (
      <div className={cx('video', className)}>
        <img src={src} alt="" />
      </div>
    );
  return (
    <div className={cx('video', className)}>
      <video
        ref={ref}
        key={recordingId}
        src={offsetSec > 0 ? `${src}#t=${offsetSec.toFixed(1)}` : src}
        controls
        autoPlay={autoPlay}
        playsInline
        preload="metadata"
        onTimeUpdate={(e) => onTime?.(e.currentTarget.currentTime)}
        onEnded={onEnded}
      />
    </div>
  );
}

export function PlaybackModal({
  title,
  subtitle,
  recordingId,
  offsetSec,
  fallbackImage,
  onClose,
}: {
  title: string;
  subtitle?: string;
  recordingId?: string;
  offsetSec?: number;
  fallbackImage?: string;
  onClose: () => void;
}) {
  return (
    <Modal open onClose={onClose} size="xl" title={title} description={subtitle}>
      {recordingId ? (
        <RecordingVideo recordingId={recordingId} offsetSec={offsetSec} className="playback-video" />
      ) : (
        <div className="video playback-video">
          {fallbackImage && <img src={fallbackImage} alt="" />}
          <div className="video-note">No recording is linked to this event.</div>
        </div>
      )}
    </Modal>
  );
}

/* ---------------- 24h timeline bar ---------------- */

const DAY_MS = 86400e3;

export function TimelineBar({
  dayStart,
  timeline,
  playhead,
  onSeek,
  onEvent,
}: {
  dayStart: number;
  timeline: Timeline | null;
  playhead: number | null;
  onSeek: (ms: number) => void;
  onEvent: (e: MotionEvent) => void;
}) {
  const barRef = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<number | null>(null);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  const dayLen = useMemo(() => {
    // handle DST days: compute next local midnight
    const d = new Date(dayStart);
    d.setDate(d.getDate() + 1);
    return d.getTime() - dayStart || DAY_MS;
  }, [dayStart]);

  const pct = (ms: number) => Math.min(100, Math.max(0, ((ms - dayStart) / dayLen) * 100));

  const ranges = useMemo(() => {
    if (!timeline) return [];
    // merge ranges that touch (continuous recording segments) for a clean bar
    const sorted = timeline.ranges
      .map((r) => ({ s: new Date(r.start).getTime(), e: new Date(r.end).getTime() }))
      .sort((a, b) => a.s - b.s);
    const out: { s: number; e: number }[] = [];
    for (const r of sorted) {
      const last = out[out.length - 1];
      if (last && r.s - last.e < 5000) last.e = Math.max(last.e, r.e);
      else out.push({ ...r });
    }
    return out;
  }, [timeline]);

  const msAt = (clientX: number) => {
    const rect = barRef.current!.getBoundingClientRect();
    const x = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    return dayStart + x * dayLen;
  };

  const isToday = now >= dayStart && now < dayStart + dayLen;
  const hours = [0, 3, 6, 9, 12, 15, 18, 21, 24];

  return (
    <div className="timeline">
      <div
        className="timeline-track"
        ref={barRef}
        onMouseMove={(e: RMouseEvent) => setHover(msAt(e.clientX))}
        onMouseLeave={() => setHover(null)}
        onClick={(e) => onSeek(msAt(e.clientX))}
        role="slider"
        aria-label="Timeline"
        aria-valuemin={0}
        aria-valuemax={24}
        aria-valuenow={playhead ? Math.round((playhead - dayStart) / 3600e3) : 0}
        tabIndex={0}
        onKeyDown={(e) => {
          if (!playhead) return;
          if (e.key === 'ArrowRight') onSeek(playhead + 60e3);
          if (e.key === 'ArrowLeft') onSeek(playhead - 60e3);
        }}
      >
        {hours.slice(1, -1).map((h) => (
          <span key={h} className="timeline-grid" style={{ left: `${(h / 24) * 100}%` }} />
        ))}
        {ranges.map((r, i) => (
          <span key={i} className="timeline-range" style={{ left: `${pct(r.s)}%`, width: `max(2px, ${pct(r.e) - pct(r.s)}%)` }} />
        ))}
        {isToday && <span className="timeline-future" style={{ left: `${pct(now)}%` }} />}
        {timeline?.events.map((ev) => (
          <button
            key={ev.id}
            type="button"
            className="timeline-event"
            style={{ left: `${pct(new Date(ev.start).getTime())}%` }}
            title={`Motion at ${fmtTimeSec(ev.start)}`}
            aria-label={`Motion at ${fmtTimeSec(ev.start)}`}
            onClick={(e) => {
              e.stopPropagation();
              onEvent(ev);
            }}
          />
        ))}
        {playhead !== null && (
          <span className="timeline-playhead" style={{ left: `${pct(playhead)}%` }}>
            <span className="timeline-playhead-label tabular">{fmtTimeSec(new Date(playhead))}</span>
          </span>
        )}
        {hover !== null && (
          <span className="timeline-hover" style={{ left: `${pct(hover)}%` }}>
            {(playhead === null || Math.abs(pct(hover) - pct(playhead)) > 4) && (
              <span className="timeline-hover-label tabular">{fmtTime(new Date(hover))}</span>
            )}
          </span>
        )}
      </div>
      <div className="timeline-hours tabular">
        {hours.map((h) => (
          <span key={h} style={{ left: `${(h / 24) * 100}%` }}>
            {String(h).padStart(2, '0')}:00
          </span>
        ))}
      </div>
    </div>
  );
}
