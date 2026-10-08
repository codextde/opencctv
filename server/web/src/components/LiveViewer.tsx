import { useEffect, useRef, type PointerEvent as RPointerEvent, type ReactNode } from 'react';
import { api, isMock, media, mediaUrl } from '../api';
import type { Camera } from '../types';
import { navigate } from '../router';
import { cameraStatus, LiveSnapshot, streamInfo } from './CameraMedia';
import {
  IconArrowDown, IconArrowUp, IconChevronLeft, IconChevronRight, IconClose, IconDownload, IconExpand, IconRecordings,
  IconZoomIn, IconZoomOut,
} from './icons';
import { IconButton, Modal, Segmented, StatusDot, useLocalStorage } from './ui';
import { toast } from './feedback';

export function LiveViewer({
  camera,
  onClose,
  onPrev,
  onNext,
}: {
  camera: Camera;
  onClose: () => void;
  onPrev?: () => void;
  onNext?: () => void;
}) {
  const [quality, setQuality] = useLocalStorage<'hd' | 'sd'>('opencctv.quality', 'hd');
  const stageRef = useRef<HTMLDivElement>(null);
  const st = cameraStatus(camera);
  const info = streamInfo(camera);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest('input, textarea, select')) return;
      if (e.key === 'ArrowLeft' && onPrev) onPrev();
      if (e.key === 'ArrowRight' && onNext) onNext();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onPrev, onNext]);

  const fullscreen = () => {
    const el = stageRef.current;
    if (!el) return;
    if (document.fullscreenElement) void document.exitFullscreen();
    else void el.requestFullscreen?.();
  };

  const snapshotHref = isMock() ? media.snapshot(camera.id, 1280) : mediaUrl(`/api/cameras/${encodeURIComponent(camera.id)}/snapshot.jpg`);

  return (
    <Modal open onClose={onClose} size="full" bare className="viewer">
      <header className="viewer-head">
        <div className="viewer-title">
          <StatusDot status={st.dot} />
          <h2>{camera.name}</h2>
          <span className="viewer-sub">
            {st.label}
            {info ? ` · ${info}` : ''}
          </span>
        </div>
        <div className="viewer-actions">
          <Segmented
            size="sm"
            value={quality}
            onChange={setQuality}
            ariaLabel="Stream quality"
            options={[
              { value: 'hd', label: 'HD', title: 'Main stream' },
              { value: 'sd', label: 'SD', title: 'Sub stream (lower bandwidth)' },
            ]}
          />
          <a className="icon-btn" href={snapshotHref} download={`${camera.name}-${Date.now()}.jpg`} title="Download snapshot" aria-label="Download snapshot">
            <IconDownload size={18} />
          </a>
          <IconButton label="Recordings" onClick={() => navigate('/recordings', { camera: camera.id })}>
            <IconRecordings size={18} />
          </IconButton>
          <IconButton label="Fullscreen" onClick={fullscreen}>
            <IconExpand size={18} />
          </IconButton>
          <span className="viewer-divider" />
          <IconButton label="Close" onClick={onClose}>
            <IconClose size={18} />
          </IconButton>
        </div>
      </header>
      <div className="viewer-stage" ref={stageRef}>
        {camera.status.online && camera.enabled ? (
          isMock() ? (
            <LiveSnapshot cameraId={camera.id} width={1280} interval={1000} className="viewer-media" />
          ) : (
            <iframe
              key={`${camera.id}-${quality}`}
              className="viewer-media"
              src={media.player(camera.id, quality)}
              title={`${camera.name} live`}
              allow="autoplay; fullscreen; microphone; picture-in-picture"
              allowFullScreen
            />
          )
        ) : (
          <div className="viewer-offline">
            <div className="viewer-offline-title">{camera.enabled ? 'Camera is offline' : 'Camera is disabled'}</div>
            {camera.status.error && <div className="viewer-offline-err mono">{camera.status.error}</div>}
          </div>
        )}
        <span className="live-chip">
          <span className="live-dot" /> LIVE
        </span>
        {onPrev && (
          <button type="button" className="viewer-nav viewer-nav-prev" onClick={onPrev} aria-label="Previous camera">
            <IconChevronLeft size={22} />
          </button>
        )}
        {onNext && (
          <button type="button" className="viewer-nav viewer-nav-next" onClick={onNext} aria-label="Next camera">
            <IconChevronRight size={22} />
          </button>
        )}
        {camera.capabilities.ptz && camera.status.online && <PtzPad cameraId={camera.id} />}
      </div>
    </Modal>
  );
}

function PtzPad({ cameraId }: { cameraId: string }) {
  const moving = useRef(false);
  const start = (pan: number, tilt: number, zoom: number) => (e: RPointerEvent) => {
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    moving.current = true;
    api.ptz(cameraId, { action: 'move', pan, tilt, zoom }).catch((err: Error) => toast.error('PTZ failed', err.message));
  };
  const stop = () => {
    if (!moving.current) return;
    moving.current = false;
    api.ptz(cameraId, { action: 'stop' }).catch(() => undefined);
  };
  useEffect(() => () => stop(), []); // eslint-disable-line react-hooks/exhaustive-deps

  const btn = (label: string, pan: number, tilt: number, zoom: number, child: ReactNode, cls: string) => (
    <button
      type="button"
      className={`ptz-btn ${cls}`}
      aria-label={label}
      title={label}
      onPointerDown={start(pan, tilt, zoom)}
      onPointerUp={stop}
      onPointerCancel={stop}
      onLostPointerCapture={stop}
      onContextMenu={(e) => e.preventDefault()}
    >
      {child}
    </button>
  );
  return (
    <div className="ptz" aria-label="Pan, tilt and zoom">
      <div className="ptz-pad">
        {btn('Tilt up', 0, 0.6, 0, <IconArrowUp size={16} />, 'ptz-up')}
        {btn('Pan left', -0.6, 0, 0, <IconArrowUp size={16} style={{ transform: 'rotate(-90deg)' }} />, 'ptz-left')}
        <span className="ptz-center" />
        {btn('Pan right', 0.6, 0, 0, <IconArrowUp size={16} style={{ transform: 'rotate(90deg)' }} />, 'ptz-right')}
        {btn('Tilt down', 0, -0.6, 0, <IconArrowDown size={16} />, 'ptz-down')}
      </div>
      <div className="ptz-zoom">
        {btn('Zoom in', 0, 0, 0.6, <IconZoomIn size={16} />, '')}
        {btn('Zoom out', 0, 0, -0.6, <IconZoomOut size={16} />, '')}
      </div>
    </div>
  );
}
