import { useEffect, useRef, useState } from 'react';
import { media } from '../api';
import type { Camera } from '../types';
import { resolution } from '../format';
import { cx, StatusDot, usePageVisible } from './ui';
import { IconOffline } from './icons';

/**
 * Snapshot that refreshes periodically without flicker: the next frame is
 * preloaded off-screen and swapped in once decoded.
 */
export function LiveSnapshot({
  cameraId,
  width = 640,
  interval = 2000,
  paused,
  className,
}: {
  cameraId: string;
  width?: number;
  interval?: number;
  paused?: boolean;
  className?: string;
}) {
  const [src, setSrc] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const visible = usePageVisible();
  const active = visible && !paused;
  const busy = useRef(false);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const load = () => {
      if (busy.current) return;
      busy.current = true;
      const url = media.snapshot(cameraId, width, Date.now());
      const img = new Image();
      img.decoding = 'async';
      img.onload = () => {
        busy.current = false;
        if (cancelled) return;
        setSrc(url);
        setFailed(false);
        if (active) timer = setTimeout(load, interval);
      };
      img.onerror = () => {
        busy.current = false;
        if (cancelled) return;
        setFailed(true);
        if (active) timer = setTimeout(load, interval * 2.5);
      };
      img.src = url;
    };
    load();
    return () => {
      cancelled = true;
      busy.current = false;
      if (timer) clearTimeout(timer);
    };
  }, [cameraId, width, interval, active]);

  return (
    <div className={cx('snapshot', className)}>
      {src && <img src={src} alt="" draggable={false} />}
      {!src && !failed && <div className="snapshot-loading skeleton" />}
      {!src && failed && (
        <div className="snapshot-fallback">
          <IconOffline size={22} />
          <span>No image</span>
        </div>
      )}
    </div>
  );
}

export function cameraStatus(c: Camera): { dot: 'ok' | 'error' | 'off' | 'warn'; label: string } {
  if (!c.enabled) return { dot: 'off', label: 'Disabled' };
  if (!c.status.online) return { dot: 'error', label: c.status.error ? 'Offline' : 'Offline' };
  if (c.status.recording) return { dot: 'ok', label: 'Recording' };
  return { dot: 'ok', label: 'Online' };
}

export function streamInfo(c: Camera): string | null {
  const parts = [c.status.codec, resolution(c.status.width, c.status.height), c.status.fps ? `${c.status.fps} fps` : null].filter(Boolean);
  return parts.length ? parts.join(' · ') : null;
}

export function CameraTile({ camera, onOpen, compact }: { camera: Camera; onOpen: () => void; compact?: boolean }) {
  const st = cameraStatus(camera);
  const offline = !camera.enabled || !camera.status.online;
  const info = streamInfo(camera);
  return (
    <button type="button" className={cx('tile', offline && 'is-offline', compact && 'tile-compact')} onClick={onOpen}>
      <div className="tile-media">
        {offline ? (
          <div className="tile-offline">
            <IconOffline size={26} />
            <span className="tile-offline-title">{camera.enabled ? 'Camera offline' : 'Camera disabled'}</span>
            {camera.enabled && camera.status.error && <span className="tile-offline-err">{camera.status.error}</span>}
          </div>
        ) : (
          <LiveSnapshot cameraId={camera.id} />
        )}
      </div>
      <div className="tile-top">
        {camera.status.recording && camera.status.online && (
          <span className="rec-chip">
            <span className="rec-dot" /> REC
          </span>
        )}
      </div>
      <div className="tile-bottom">
        <div className="tile-name">
          <StatusDot status={st.dot} />
          <span>{camera.name}</span>
        </div>
        {info && !offline && <span className="tile-meta tabular">{info}</span>}
      </div>
    </button>
  );
}
