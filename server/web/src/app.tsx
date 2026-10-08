import { useCallback, useEffect, useRef, useState, type ComponentType, type ReactNode } from 'react';
import { api, errorMessage, getToken, isMock, media, onUnauthorized, setToken } from './api';
import { ApiError } from './errors';
import { navigate, useRoute } from './router';
import { AppProvider, useApp, useLive } from './store';
import type { Info, User } from './types';
import { ConfirmHost, toast, ToastHost } from './components/feedback';
import {
  IconCamera, IconEvents, IconGateway, IconLive, IconLogout, IconPhone, IconRecordings, IconSettings, IconStorage,
  IconSystem, IconUsers,
} from './components/icons';
import { Button, cx, Logo, Spinner, StatusDot } from './components/ui';
import { PairDialog } from './components/PairDialog';
import { AuthPage } from './pages/Auth';
import { LivePage } from './pages/Live';
import { RecordingsPage } from './pages/Recordings';
import { EventsPage } from './pages/Events';
import { CamerasPage } from './pages/Cameras';
import { StoragePage } from './pages/Storage';
import { GatewayPage } from './pages/Gateway';
import { UsersPage } from './pages/Users';
import { SettingsPage } from './pages/Settings';
import { SystemPage } from './pages/System';
import { initials } from './format';

type Boot =
  | { phase: 'loading' }
  | { phase: 'error'; message: string }
  | { phase: 'auth'; info: Info; mode: 'login' | 'setup' }
  | { phase: 'ready'; info: Info; user: User };

export function App() {
  const [boot, setBoot] = useState<Boot>({ phase: 'loading' });

  const start = useCallback(async () => {
    let info: Info;
    try {
      info = await api.info();
    } catch (e) {
      setBoot({ phase: 'error', message: errorMessage(e) });
      return;
    }
    document.title = info.name ? `${info.name} · OpenCCTV` : 'OpenCCTV';
    const authMode = info.setupRequired ? 'setup' : 'login';
    if (!getToken()) return setBoot({ phase: 'auth', info, mode: authMode });
    try {
      const { user } = await api.me();
      setBoot({ phase: 'ready', info, user });
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) {
        setToken(null);
        setBoot({ phase: 'auth', info, mode: authMode });
      } else setBoot({ phase: 'error', message: errorMessage(e) });
    }
  }, []);

  useEffect(() => {
    onUnauthorized(() => {
      setToken(null);
      setBoot((b) => (b.phase === 'ready' ? { phase: 'auth', info: b.info, mode: 'login' } : b));
    });
    void start();
  }, [start]);

  const logout = useCallback(() => {
    api.logout().catch(() => undefined);
    setToken(null);
    setBoot((b) => (b.phase === 'ready' ? { phase: 'auth', info: b.info, mode: 'login' } : b));
  }, []);

  let content: ReactNode;
  if (boot.phase === 'loading')
    content = (
      <div className="boot">
        <Spinner size={22} />
      </div>
    );
  else if (boot.phase === 'error')
    content = (
      <div className="auth-screen">
        <div className="auth-card auth-card-center">
          <Logo size={32} />
          <h1 className="auth-title">Can't reach the server</h1>
          <p className="auth-sub">{boot.message}</p>
          <Button variant="primary" onClick={() => void start()}>
            Try again
          </Button>
        </div>
      </div>
    );
  else if (boot.phase === 'auth')
    content = (
      <AuthPage
        info={boot.info}
        mode={boot.mode}
        onAuthed={(token, user) => {
          setToken(token);
          setBoot({ phase: 'ready', info: { ...boot.info, setupRequired: false }, user });
        }}
      />
    );
  else
    content = (
      <AppProvider info={boot.info} user={boot.user} onLogout={logout}>
        <Shell />
      </AppProvider>
    );

  return (
    <>
      {content}
      <ToastHost />
      <ConfirmHost />
      {isMock() && <div className="mock-flag">Preview data</div>}
    </>
  );
}

/* ------------------------------------------------------------------ */

interface NavItem {
  path: string;
  label: string;
  icon: ComponentType<{ size?: number }>;
  admin?: boolean;
  page: ComponentType;
}

const NAV: { section: string; items: NavItem[] }[] = [
  {
    section: 'Monitor',
    items: [
      { path: 'live', label: 'Live', icon: IconLive, page: LivePage },
      { path: 'recordings', label: 'Recordings', icon: IconRecordings, page: RecordingsPage },
      { path: 'events', label: 'Events', icon: IconEvents, page: EventsPage },
    ],
  },
  {
    section: 'Manage',
    items: [
      { path: 'cameras', label: 'Cameras', icon: IconCamera, page: CamerasPage },
      { path: 'storage', label: 'Storage', icon: IconStorage, admin: true, page: StoragePage },
      { path: 'gateway', label: 'Gateway', icon: IconGateway, admin: true, page: GatewayPage },
      { path: 'users', label: 'Users', icon: IconUsers, admin: true, page: UsersPage },
    ],
  },
  {
    section: 'Server',
    items: [
      { path: 'settings', label: 'Settings', icon: IconSettings, admin: true, page: SettingsPage },
      { path: 'system', label: 'System', icon: IconSystem, page: SystemPage },
    ],
  },
];

function Shell() {
  const route = useRoute();
  const { isAdmin, cameraById } = useApp();
  const items = NAV.flatMap((s) => s.items).filter((i) => !i.admin || isAdmin);
  const current = items.find((i) => i.path === route.segments[0]);

  useEffect(() => {
    if (!current) navigate('/live', undefined, true);
  }, [current]);

  // Motion toasts (throttled per camera)
  const lastToast = useRef<Record<string, number>>({});
  useLive((m) => {
    if (m.type !== 'motion') return;
    const cam = cameraById(m.event.cameraId);
    const now = Date.now();
    if (now - (lastToast.current[m.event.cameraId] ?? 0) < 15_000) return;
    lastToast.current[m.event.cameraId] = now;
    toast({
      tone: 'motion',
      title: `Motion on ${cam?.name ?? 'camera'}`,
      description: new Date(m.event.start).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      image: isMock() || !m.event.id ? media.snapshot(m.event.cameraId, 160) : media.eventSnapshot(m.event.id),
      onClick: () => navigate('/events', { camera: m.event.cameraId }),
    });
  });

  const Page = current?.page;
  return (
    <div className="shell">
      <Sidebar active={current?.path} />
      <div className="main">
        <Topbar title={current?.label ?? ''} />
        <main className="content" key={current?.path}>
          {Page && <Page />}
        </main>
      </div>
    </div>
  );
}

function Sidebar({ active }: { active?: string }) {
  const { isAdmin, socket, info } = useApp();
  return (
    <nav className="sidebar" aria-label="Main">
      <a className="sidebar-brand" href="#/live" aria-label="OpenCCTV home">
        <Logo size={26} />
      </a>
      <div className="sidebar-nav">
        {NAV.map((s) => {
          const visible = s.items.filter((i) => !i.admin || isAdmin);
          if (!visible.length) return null;
          return (
            <div className="nav-section" key={s.section}>
              <div className="nav-section-label">{s.section}</div>
              {visible.map((i) => (
                <a key={i.path} href={`#/${i.path}`} className={cx('nav-item', active === i.path && 'is-active')} title={i.label}>
                  <i.icon size={18} />
                  <span className="nav-label">{i.label}</span>
                </a>
              ))}
            </div>
          );
        })}
      </div>
      <div className="sidebar-foot">
        <div className="conn" title={socket === 'open' ? 'Live updates connected' : 'Reconnecting to live updates'}>
          <StatusDot status={socket === 'open' ? 'ok' : 'warn'} pulse={socket !== 'open'} />
          <span className="nav-label">{socket === 'open' ? 'Live updates' : 'Reconnecting'}</span>
        </div>
        <div className="sidebar-version nav-label tabular">v{info.version}</div>
      </div>
    </nav>
  );
}

function Topbar({ title }: { title: string }) {
  const { serverName, user, isAdmin, logout } = useApp();
  const [pairOpen, setPairOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const routePath = useRoute().path;
  useEffect(() => {
    setPairOpen(false);
    setMenuOpen(false);
  }, [routePath]);

  useEffect(() => {
    if (!menuOpen) return;
    const close = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setMenuOpen(false);
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', esc);
    };
  }, [menuOpen]);

  return (
    <header className="topbar">
      <div className="topbar-title">
        <span className="topbar-server">{serverName}</span>
        <span className="topbar-sep">/</span>
        <span className="topbar-page">{title}</span>
      </div>
      <div className="topbar-actions">
        {isAdmin && (
          <Button size="sm" variant="secondary" icon={<IconPhone size={15} />} onClick={() => setPairOpen(true)}>
            Pair phone
          </Button>
        )}
        <div className="user-menu" ref={menuRef}>
          <button
            type="button"
            className="avatar-btn"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((v) => !v)}
          >
            <span className="avatar">{initials(user.username)}</span>
          </button>
          {menuOpen && (
            <div className="menu" role="menu">
              <div className="menu-header">
                <div className="menu-name">{user.username}</div>
                <div className="menu-role">{user.role === 'admin' ? 'Administrator' : 'Viewer'}</div>
              </div>
              <div className="menu-sep" />
              {isAdmin && (
                <button type="button" role="menuitem" className="menu-item" onClick={() => (setMenuOpen(false), setPairOpen(true))}>
                  <IconPhone size={16} /> Pair a phone
                </button>
              )}
              <button type="button" role="menuitem" className="menu-item" onClick={logout}>
                <IconLogout size={16} /> Sign out
              </button>
            </div>
          )}
        </div>
      </div>
      <PairDialog open={pairOpen} onClose={() => setPairOpen(false)} />
    </header>
  );
}
