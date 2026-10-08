import { useState, type FormEvent } from 'react';
import { api, errorMessage } from '../api';
import type { Info, User } from '../types';
import { Alert, Button, FormField, Input, Logo } from '../components/ui';
import { IconKey } from '../components/icons';

export function AuthPage({
  info,
  mode: initialMode,
  onAuthed,
}: {
  info: Info;
  mode: 'login' | 'setup';
  onAuthed: (token: string, user: User) => void;
}) {
  const [mode, setMode] = useState(initialMode);
  const [username, setUsername] = useState(initialMode === 'setup' ? 'admin' : '');
  const [password, setPassword] = useState('');
  const [confirmPw, setConfirmPw] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e?: FormEvent, creds?: { username: string; password: string }) => {
    e?.preventDefault();
    setError(null);
    const u = (creds?.username ?? username).trim();
    const p = creds?.password ?? password;
    if (mode === 'setup') {
      if (p.length < 8) return setError('Use at least 8 characters for the password.');
      if (p !== confirmPw) return setError('The passwords do not match.');
    }
    setBusy(true);
    try {
      const res = mode === 'setup' ? await api.setup(u, p) : await api.login(u, p);
      onAuthed(res.token, res.user);
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  };

  return (
    <div className="auth-screen">
      <div className="auth-glow" aria-hidden="true" />
      <div className="auth-wrap">
        <div className="auth-card">
          <div className="auth-head">
            <Logo size={34} />
            {mode === 'setup' ? (
              <>
                <h1 className="auth-title">Welcome to OpenCCTV</h1>
                <p className="auth-sub">Create the administrator account for this server. You can add more users later.</p>
              </>
            ) : (
              <>
                <h1 className="auth-title">Sign in to {info.name || 'OpenCCTV'}</h1>
                <p className="auth-sub">Your cameras, recordings and events — private, on your own hardware.</p>
              </>
            )}
          </div>

          <form className="auth-form" onSubmit={submit}>
            <FormField label="Username" htmlFor="auth-user">
              <Input
                id="auth-user"
                autoComplete="username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                autoFocus={mode === 'login'}
                required
              />
            </FormField>
            <FormField label="Password" htmlFor="auth-pass" hint={mode === 'setup' ? 'At least 8 characters.' : undefined}>
              <Input
                id="auth-pass"
                type="password"
                autoComplete={mode === 'setup' ? 'new-password' : 'current-password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoFocus={mode === 'setup'}
                required
              />
            </FormField>
            {mode === 'setup' && (
              <FormField label="Confirm password" htmlFor="auth-pass2">
                <Input
                  id="auth-pass2"
                  type="password"
                  autoComplete="new-password"
                  value={confirmPw}
                  onChange={(e) => setConfirmPw(e.target.value)}
                  required
                />
              </FormField>
            )}
            {error && <Alert>{error}</Alert>}
            <Button type="submit" variant="primary" size="lg" loading={busy} className="auth-submit">
              {mode === 'setup' ? 'Create account' : 'Sign in'}
            </Button>
          </form>

          {mode === 'setup' && info.demo && info.demoLogin && (
            <button
              type="button"
              className="auth-switch"
              onClick={() => {
                setMode('login');
                setUsername('');
                setPassword('');
                setConfirmPw('');
                setError(null);
              }}
            >
              Just looking? Sign in with the demo account
            </button>
          )}

          {mode === 'login' && info.demo && info.demoLogin && (
            <div className="demo-box">
              <div className="demo-icon">
                <IconKey size={16} />
              </div>
              <div className="demo-text">
                <div className="demo-title">Demo server</div>
                <div className="demo-creds">
                  <code>{info.demoLogin.username}</code>
                  <span>/</span>
                  <code>{info.demoLogin.password}</code>
                </div>
              </div>
              <Button
                size="sm"
                variant="secondary"
                disabled={busy}
                onClick={() => {
                  const c = info.demoLogin!;
                  setUsername(c.username);
                  setPassword(c.password);
                  void submit(undefined, c);
                }}
              >
                Use demo login
              </Button>
            </div>
          )}
        </div>
        <div className="auth-foot tabular">
          OpenCCTV {info.version ? `v${info.version}` : ''} · Open source under the MIT license
        </div>
      </div>
    </div>
  );
}
