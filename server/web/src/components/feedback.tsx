import { useState, useSyncExternalStore, type ReactNode } from 'react';
import { Button, cx, Modal } from './ui';
import { IconAlert, IconCheck, IconClose, IconMotion } from './icons';

/* ---------------- Toasts ---------------- */

export interface Toast {
  id: number;
  title: ReactNode;
  description?: ReactNode;
  tone?: 'default' | 'success' | 'error' | 'motion';
  image?: string;
  onClick?: () => void;
}

let toasts: Toast[] = [];
let nextId = 1;
const toastListeners = new Set<() => void>();
const emitToasts = () => toastListeners.forEach((l) => l());

export function toast(t: Omit<Toast, 'id'>, ms = 4200): number {
  const id = nextId++;
  toasts = [...toasts.slice(-3), { ...t, id }];
  emitToasts();
  setTimeout(() => dismissToast(id), ms);
  return id;
}
toast.success = (title: ReactNode, description?: ReactNode) => toast({ title, description, tone: 'success' });
toast.error = (title: ReactNode, description?: ReactNode) => toast({ title, description, tone: 'error' }, 6000);

export function dismissToast(id: number): void {
  toasts = toasts.filter((t) => t.id !== id);
  emitToasts();
}

export function ToastHost() {
  const list = useSyncExternalStore(
    (fn) => (toastListeners.add(fn), () => toastListeners.delete(fn)),
    () => toasts,
  );
  return (
    <div className="toasts" aria-live="polite">
      {list.map((t) => (
        <div
          key={t.id}
          className={cx('toast', `toast-${t.tone ?? 'default'}`, t.onClick && 'is-clickable')}
          onClick={() => {
            if (t.onClick) {
              t.onClick();
              dismissToast(t.id);
            }
          }}
        >
          {t.image ? (
            <img className="toast-image" src={t.image} alt="" />
          ) : (
            <span className="toast-icon">
              {t.tone === 'success' ? <IconCheck size={16} /> : t.tone === 'error' ? <IconAlert size={16} /> : t.tone === 'motion' ? <IconMotion size={16} /> : null}
            </span>
          )}
          <div className="toast-content">
            <div className="toast-title">{t.title}</div>
            {t.description && <div className="toast-desc">{t.description}</div>}
          </div>
          <button
            type="button"
            className="toast-close"
            aria-label="Dismiss"
            onClick={(e) => {
              e.stopPropagation();
              dismissToast(t.id);
            }}
          >
            <IconClose size={14} />
          </button>
        </div>
      ))}
    </div>
  );
}

/* ---------------- Confirm ---------------- */

interface ConfirmReq {
  title: ReactNode;
  message?: ReactNode;
  confirmLabel?: string;
  danger?: boolean;
  resolve: (v: boolean) => void;
}

let confirmReq: ConfirmReq | null = null;
const confirmListeners = new Set<() => void>();

export function confirm(opts: Omit<ConfirmReq, 'resolve'>): Promise<boolean> {
  return new Promise((resolve) => {
    confirmReq = { ...opts, resolve };
    confirmListeners.forEach((l) => l());
  });
}

export function ConfirmHost() {
  const req = useSyncExternalStore(
    (fn) => (confirmListeners.add(fn), () => confirmListeners.delete(fn)),
    () => confirmReq,
  );
  const [busy, setBusy] = useState(false);
  const close = (v: boolean) => {
    req?.resolve(v);
    confirmReq = null;
    setBusy(false);
    confirmListeners.forEach((l) => l());
  };
  return (
    <Modal
      open={!!req}
      onClose={() => close(false)}
      size="sm"
      title={req?.title}
      footer={
        <>
          <Button variant="ghost" onClick={() => close(false)}>
            Cancel
          </Button>
          <Button
            variant={req?.danger ? 'danger' : 'primary'}
            loading={busy}
            autoFocus
            onClick={() => {
              setBusy(true);
              close(true);
            }}
          >
            {req?.confirmLabel ?? 'Confirm'}
          </Button>
        </>
      }
    >
      {req?.message && <div className="confirm-message">{req.message}</div>}
    </Modal>
  );
}
