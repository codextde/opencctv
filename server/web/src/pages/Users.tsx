import { useState, type FormEvent } from 'react';
import { api, errorMessage } from '../api';
import { useApp, useAsync } from '../store';
import type { Role, User } from '../types';
import { fmtDate, initials } from '../format';
import { confirm, toast } from '../components/feedback';
import { IconEdit, IconPlus, IconTrash, IconUsers } from '../components/icons';
import { Alert, Badge, Button, Card, EmptyState, FormField, IconButton, Input, Modal, PageHeader, Segmented, Skeleton } from '../components/ui';

export function UsersPage() {
  const { user: me } = useApp();
  const { data, setData, error, loading } = useAsync<User[]>(() => api.users(), []);
  const [editing, setEditing] = useState<User | 'new' | null>(null);

  const remove = async (u: User) => {
    const ok = await confirm({
      title: `Delete ${u.username}?`,
      message: 'Their sessions and paired phones are signed out immediately.',
      confirmLabel: 'Delete user',
      danger: true,
    });
    if (!ok) return;
    try {
      await api.deleteUser(u.id);
      setData((d) => d?.filter((x) => x.id !== u.id) ?? null);
      toast.success(`${u.username} deleted`);
    } catch (e) {
      toast.error('Could not delete user', errorMessage(e));
    }
  };

  return (
    <div className="page">
      <PageHeader
        title="Users"
        description="Admins can change everything. Viewers can watch live video, recordings and events."
        actions={
          <Button variant="primary" icon={<IconPlus size={16} />} onClick={() => setEditing('new')}>
            Add user
          </Button>
        }
      />
      {error && <Alert>{error}</Alert>}
      <Card padded={false}>
        {loading && !data && (
          <div className="card-body stack-12">
            <Skeleton h={36} w="100%" />
            <Skeleton h={36} w="100%" />
          </div>
        )}
        {data && data.length === 0 && <EmptyState compact icon={<IconUsers size={22} />} title="No users" />}
        {data && data.length > 0 && (
          <table className="table">
            <thead>
              <tr>
                <th>User</th>
                <th>Role</th>
                <th>Created</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {data.map((u) => (
                <tr key={u.id}>
                  <td>
                    <span className="row gap-10">
                      <span className="avatar avatar-sm">{initials(u.username)}</span>
                      <span className="strong">{u.username}</span>
                      {u.id === me.id && <Badge>You</Badge>}
                    </span>
                  </td>
                  <td>
                    <Badge tone={u.role === 'admin' ? 'accent' : 'neutral'}>{u.role === 'admin' ? 'Admin' : 'Viewer'}</Badge>
                  </td>
                  <td className="muted tabular">{fmtDate(u.createdAt)}</td>
                  <td className="td-actions">
                    <IconButton label="Edit" onClick={() => setEditing(u)}>
                      <IconEdit size={16} />
                    </IconButton>
                    <IconButton label="Delete" className="danger-hover" disabled={u.id === me.id} onClick={() => void remove(u)}>
                      <IconTrash size={16} />
                    </IconButton>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
      {editing && (
        <UserDialog
          user={editing === 'new' ? null : editing}
          isSelf={editing !== 'new' && editing.id === me.id}
          onClose={() => setEditing(null)}
          onSaved={(u) => {
            setData((d) => {
              const list = d ?? [];
              return list.some((x) => x.id === u.id) ? list.map((x) => (x.id === u.id ? u : x)) : [...list, u];
            });
            setEditing(null);
          }}
        />
      )}
    </div>
  );
}

function UserDialog({ user, isSelf, onClose, onSaved }: { user: User | null; isSelf: boolean; onClose: () => void; onSaved: (u: User) => void }) {
  const [username, setUsername] = useState(user?.username ?? '');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<Role>(user?.role ?? 'viewer');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!user && password.length < 8) return setError('Use at least 8 characters for the password.');
    if (user && password && password.length < 8) return setError('Use at least 8 characters for the password.');
    setBusy(true);
    try {
      const u = user
        ? await api.updateUser(user.id, { username: username.trim(), role, ...(password ? { password } : {}) })
        : await api.createUser({ username: username.trim(), password, role });
      toast.success(user ? 'User saved' : `${u.username} added`);
      onSaved(u);
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  };

  return (
    <Modal open onClose={onClose} size="sm" title={user ? `Edit ${user.username}` : 'Add user'}>
      <form className="stack-16" onSubmit={submit}>
        <FormField label="Username" htmlFor="u-name">
          <Input id="u-name" value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="off" required />
        </FormField>
        <FormField label={user ? 'New password' : 'Password'} htmlFor="u-pass" optional={!!user} hint={user ? 'Leave empty to keep the current password.' : 'At least 8 characters.'}>
          <Input id="u-pass" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" />
        </FormField>
        <FormField label="Role" hint={isSelf ? 'You cannot change your own role.' : undefined}>
          {isSelf ? (
            <div>
              <Badge tone="accent">Admin</Badge>
            </div>
          ) : (
            <Segmented
              value={role}
              onChange={setRole}
              ariaLabel="Role"
              options={[
                { value: 'viewer', label: 'Viewer' },
                { value: 'admin', label: 'Admin' },
              ]}
            />
          )}
        </FormField>
        {error && <Alert>{error}</Alert>}
        <div className="form-actions">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" loading={busy}>
            {user ? 'Save' : 'Add user'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
