import {
  useEffect, useId, useRef, useState, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode,
  type SelectHTMLAttributes,
} from 'react';
import { createPortal } from 'react-dom';
import { IconCheck, IconClose, IconCopy } from './icons';

export function cx(...c: (string | false | null | undefined)[]): string {
  return c.filter(Boolean).join(' ');
}

/* ---------------- Logo ---------------- */

export function LogoMark({ size = 28 }: { size?: number }) {
  const id = useId();
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <defs>
        <linearGradient id={`${id}g`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#2DD4BF" />
          <stop offset="1" stopColor="#0F8F81" />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="9" fill={`url(#${id}g)`} />
      <circle cx="16" cy="16" r="8.6" fill="none" stroke="#06201D" strokeWidth="2.4" />
      <circle cx="16" cy="16" r="3.8" fill="#06201D" />
      <circle cx="17.5" cy="14.5" r="1.1" fill="#99F6E4" />
    </svg>
  );
}

export function Logo({ size = 28 }: { size?: number }) {
  return (
    <span className="logo">
      <LogoMark size={size} />
      <span className="logo-word">
        Open<span>CCTV</span>
      </span>
    </span>
  );
}

/* ---------------- Buttons ---------------- */

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'danger-ghost';

export function Button({
  variant = 'secondary',
  size = 'md',
  loading,
  icon,
  className,
  children,
  disabled,
  type = 'button',
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  size?: 'sm' | 'md' | 'lg';
  loading?: boolean;
  icon?: ReactNode;
}) {
  return (
    <button
      type={type}
      className={cx('btn', `btn-${variant}`, `btn-${size}`, loading && 'is-loading', className)}
      disabled={disabled || loading}
      {...rest}
    >
      {loading ? <Spinner size={14} /> : icon}
      {children && <span>{children}</span>}
    </button>
  );
}

export function IconButton({
  label,
  className,
  children,
  active,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: string; active?: boolean }) {
  return (
    <button type="button" className={cx('icon-btn', active && 'is-active', className)} aria-label={label} title={label} {...rest}>
      {children}
    </button>
  );
}

export function Spinner({ size = 16 }: { size?: number }) {
  return (
    <svg className="spinner" width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeOpacity=".2" strokeWidth="2.5" />
      <path d="M21 12a9 9 0 0 0-9-9" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
    </svg>
  );
}

/* ---------------- Forms ---------------- */

export function FormField({
  label,
  hint,
  error,
  children,
  htmlFor,
  optional,
}: {
  label: ReactNode;
  hint?: ReactNode;
  error?: string | null;
  children: ReactNode;
  htmlFor?: string;
  optional?: boolean;
}) {
  return (
    <div className={cx('field', error && 'has-error')}>
      <label className="field-label" htmlFor={htmlFor}>
        {label}
        {optional && <span className="field-optional">Optional</span>}
      </label>
      {children}
      {error ? <div className="field-error">{error}</div> : hint ? <div className="field-hint">{hint}</div> : null}
    </div>
  );
}

export function Input({ className, ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cx('input', className)} {...rest} />;
}

export function Select({ className, children, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <div className={cx('select-wrap', className)}>
      <select className="input select" {...rest}>
        {children}
      </select>
      <svg className="select-caret" width="14" height="14" viewBox="0 0 24 24" aria-hidden="true">
        <path d="m6 9.5 6 6 6-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </div>
  );
}

export function Toggle({
  checked,
  onChange,
  label,
  disabled,
  size = 'md',
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label?: string;
  disabled?: boolean;
  size?: 'sm' | 'md';
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      className={cx('toggle', `toggle-${size}`, checked && 'is-on')}
      onClick={() => onChange(!checked)}
    >
      <span className="toggle-knob" />
    </button>
  );
}

export function SwitchRow({
  title,
  description,
  checked,
  onChange,
  disabled,
}: {
  title: ReactNode;
  description?: ReactNode;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <div className="switch-row">
      <div>
        <div className="switch-row-title">{title}</div>
        {description && <div className="switch-row-desc">{description}</div>}
      </div>
      <Toggle checked={checked} onChange={onChange} disabled={disabled} label={typeof title === 'string' ? title : undefined} />
    </div>
  );
}

export function Segmented<T extends string | number>({
  value,
  options,
  onChange,
  size = 'md',
  ariaLabel,
}: {
  value: T;
  options: { value: T; label: ReactNode; title?: string }[];
  onChange: (v: T) => void;
  size?: 'sm' | 'md';
  ariaLabel?: string;
}) {
  return (
    <div className={cx('segmented', `segmented-${size}`)} role="radiogroup" aria-label={ariaLabel}>
      {options.map((o) => (
        <button
          key={String(o.value)}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          title={o.title}
          className={cx('segmented-item', o.value === value && 'is-active')}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function RangeInput({
  value,
  min,
  max,
  step = 1,
  onChange,
  label,
}: {
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (v: number) => void;
  label?: string;
}) {
  const pct = ((value - min) / (max - min)) * 100;
  return (
    <div className="range">
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        aria-label={label}
        onChange={(e) => onChange(Number(e.target.value))}
        style={{ ['--pct' as string]: `${pct}%` }}
      />
      <span className="range-value tabular">{value}</span>
    </div>
  );
}

/* ---------------- Display ---------------- */

export function StatusDot({ status, pulse }: { status: 'ok' | 'warn' | 'error' | 'off' | 'rec'; pulse?: boolean }) {
  return <span className={cx('dot', `dot-${status}`, pulse && 'dot-pulse')} aria-hidden="true" />;
}

export function Badge({
  tone = 'neutral',
  children,
  className,
  title,
}: {
  tone?: 'neutral' | 'accent' | 'warn' | 'danger' | 'info';
  children: ReactNode;
  className?: string;
  title?: string;
}) {
  return (
    <span className={cx('badge', `badge-${tone}`, className)} title={title}>
      {children}
    </span>
  );
}

export function Skeleton({ w, h, r, className }: { w?: number | string; h?: number | string; r?: number; className?: string }) {
  return <span className={cx('skeleton', className)} style={{ width: w, height: h, borderRadius: r }} />;
}

export function EmptyState({
  icon,
  title,
  children,
  action,
  compact,
}: {
  icon?: ReactNode;
  title: ReactNode;
  children?: ReactNode;
  action?: ReactNode;
  compact?: boolean;
}) {
  return (
    <div className={cx('empty', compact && 'empty-compact')}>
      {icon && <div className="empty-icon">{icon}</div>}
      <div className="empty-title">{title}</div>
      {children && <div className="empty-text">{children}</div>}
      {action && <div className="empty-action">{action}</div>}
    </div>
  );
}

export function PageHeader({ title, description, actions }: { title: ReactNode; description?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="page-header">
      <div>
        <h1 className="page-title">{title}</h1>
        {description && <p className="page-desc">{description}</p>}
      </div>
      {actions && <div className="page-actions">{actions}</div>}
    </div>
  );
}

export function Card({
  title,
  description,
  actions,
  children,
  className,
  padded = true,
}: {
  title?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
  className?: string;
  padded?: boolean;
}) {
  return (
    <section className={cx('card', className)}>
      {(title || actions) && (
        <header className="card-header">
          <div>
            {title && <h2 className="card-title">{title}</h2>}
            {description && <p className="card-desc">{description}</p>}
          </div>
          {actions && <div className="card-actions">{actions}</div>}
        </header>
      )}
      <div className={cx(padded && 'card-body')}>{children}</div>
    </section>
  );
}

export function UsageBar({ used, total, tone }: { used: number; total: number; tone?: 'accent' | 'warn' | 'danger' }) {
  const pct = total > 0 ? Math.min(100, (used / total) * 100) : 0;
  const t = tone ?? (pct > 92 ? 'danger' : pct > 80 ? 'warn' : 'accent');
  return (
    <div className={cx('usage', `usage-${t}`)} role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100}>
      <div className="usage-fill" style={{ width: `${pct}%` }} />
    </div>
  );
}

export function Alert({ tone = 'danger', children }: { tone?: 'danger' | 'warn' | 'info' | 'ok'; children: ReactNode }) {
  return <div className={cx('alert', `alert-${tone}`)}>{children}</div>;
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="kbd">{children}</kbd>;
}

/** Help text with newlines → numbered steps (or a paragraph if single line). */
export function HelpText({ text }: { text: string }) {
  const lines = text
    .split(/\n+/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length <= 1) return <p className="help-text">{lines[0]}</p>;
  return (
    <ol className="help-steps">
      {lines.map((l, i) => (
        <li key={i}>
          <span className="help-step-n tabular">{i + 1}</span>
          <span>{l.replace(/^\d+[.)]\s*/, '')}</span>
        </li>
      ))}
    </ol>
  );
}

export function CopyButton({ value, label = 'Copy', compact }: { value: string; label?: string; compact?: boolean }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = value;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };
  if (compact)
    return (
      <IconButton label={copied ? 'Copied' : label} onClick={copy}>
        {copied ? <IconCheck size={16} /> : <IconCopy size={16} />}
      </IconButton>
    );
  return (
    <Button size="sm" variant="secondary" icon={copied ? <IconCheck size={14} /> : <IconCopy size={14} />} onClick={copy}>
      {copied ? 'Copied' : label}
    </Button>
  );
}

export function CopyField({ value, mono = true }: { value: string; mono?: boolean }) {
  return (
    <div className="copy-field">
      <code className={cx('copy-field-value', mono && 'mono')}>{value}</code>
      <CopyButton value={value} compact />
    </div>
  );
}

/* ---------------- Modal ---------------- */

let openModals = 0;

export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = 'md',
  className,
  bare,
}: {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl' | 'full';
  className?: string;
  bare?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onCloseRef.current();
      }
    };
    document.addEventListener('keydown', onKey);
    openModals++;
    document.body.classList.add('modal-open');
    requestAnimationFrame(() => {
      const el = ref.current?.querySelector<HTMLElement>('[autofocus], input, select, textarea, button:not(.modal-close)');
      (el ?? ref.current)?.focus();
    });
    return () => {
      document.removeEventListener('keydown', onKey);
      openModals = Math.max(0, openModals - 1);
      if (openModals === 0) document.body.classList.remove('modal-open');
      prev?.focus?.();
    };
  }, [open]);

  if (!open) return null;
  return createPortal(
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={ref} className={cx('modal', `modal-${size}`, bare && 'modal-bare', className)} role="dialog" aria-modal="true" tabIndex={-1}>
        {title && (
          <header className="modal-header">
            <div>
              <h2 className="modal-title">{title}</h2>
              {description && <p className="modal-desc">{description}</p>}
            </div>
            <IconButton label="Close" className="modal-close" onClick={onClose}>
              <IconClose size={18} />
            </IconButton>
          </header>
        )}
        <div className={bare ? 'modal-bare-body' : 'modal-body'}>{children}</div>
        {footer && <footer className="modal-footer">{footer}</footer>}
      </div>
    </div>,
    document.body,
  );
}

/* ---------------- hooks ---------------- */

export function useInterval(fn: () => void, ms: number | null) {
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => {
    if (ms === null) return;
    const t = setInterval(() => ref.current(), ms);
    return () => clearInterval(t);
  }, [ms]);
}

export function useNow(ms = 1000): number {
  const [now, setNow] = useState(Date.now());
  useInterval(() => setNow(Date.now()), ms);
  return now;
}

export function usePageVisible(): boolean {
  const [v, setV] = useState(!document.hidden);
  useEffect(() => {
    const on = () => setV(!document.hidden);
    document.addEventListener('visibilitychange', on);
    return () => document.removeEventListener('visibilitychange', on);
  }, []);
  return v;
}

export function useLocalStorage<T>(key: string, initial: T): [T, (v: T) => void] {
  const [v, setV] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(key);
      return raw === null ? initial : (JSON.parse(raw) as T);
    } catch {
      return initial;
    }
  });
  const set = (nv: T) => {
    setV(nv);
    try {
      localStorage.setItem(key, JSON.stringify(nv));
    } catch {
      /* ignore */
    }
  };
  return [v, set];
}
