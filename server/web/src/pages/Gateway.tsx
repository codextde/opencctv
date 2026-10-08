import { useState, type FormEvent } from 'react';
import { api, errorMessage } from '../api';
import { useAsync } from '../store';
import type { Settings, Site } from '../types';
import { relativeTime } from '../format';
import { confirm, toast } from '../components/feedback';
import { IconGateway, IconLink, IconPlus, IconServer, IconShield, IconTrash, IconUnlink } from '../components/icons';
import {
  Alert, Badge, Button, Card, CopyField, EmptyState, FormField, IconButton, Input, Modal, PageHeader, Skeleton,
  StatusDot,
} from '../components/ui';

export function GatewayPage() {
  return (
    <div className="page">
      <PageHeader
        title="Gateway"
        description="Reach your cameras from anywhere without port forwarding. A gateway is an OpenCCTV server on a public host that home servers connect out to."
      />
      <div className="gw-diagram" aria-hidden="true">
        <div className="gw-node">
          <IconServer size={18} />
          <span>Home server</span>
        </div>
        <div className="gw-line">
          <span className="gw-line-label">outbound tunnel</span>
        </div>
        <div className="gw-node gw-node-accent">
          <IconGateway size={18} />
          <span>Gateway</span>
        </div>
        <div className="gw-line">
          <span className="gw-line-label">HTTPS</span>
        </div>
        <div className="gw-node">
          <IconShield size={18} />
          <span>Phone &amp; browser</span>
        </div>
      </div>
      <ConnectSection />
      <SitesSection />
    </div>
  );
}

function ConnectSection() {
  const { data, setData, error, loading } = useAsync<Settings>(() => api.settings(), []);
  const [url, setUrl] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const gw = data?.gateway;

  const link = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setFormError(null);
    try {
      await api.gatewayLink(url.trim().replace(/\/+$/, ''), code.trim());
      const s = await api.settings();
      setData(s);
      toast.success('Connected to gateway');
      setCode('');
    } catch (err) {
      setFormError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const unlink = async () => {
    const ok = await confirm({
      title: 'Disconnect from gateway?',
      message: 'Phones that reach this server through the gateway will lose access until you link it again.',
      confirmLabel: 'Disconnect',
      danger: true,
    });
    if (!ok) return;
    try {
      await api.gatewayUnlink();
      setData((d) => (d ? { ...d, gateway: { connected: false, enabled: false } } : d));
      toast.success('Disconnected from gateway');
    } catch (e) {
      toast.error('Could not disconnect', errorMessage(e));
    }
  };

  return (
    <Card title="Connect this server to a gateway" description="Use this on your home server. Get a link code from the gateway's Sites list.">
      {loading && !data && <Skeleton h={80} w="100%" />}
      {error && <Alert>{error}</Alert>}
      {gw && (gw.enabled || gw.connected) && gw.url ? (
        <div className="gw-status">
          <div className={`gw-status-icon ${gw.connected ? 'is-ok' : 'is-warn'}`}>
            <IconLink size={20} />
          </div>
          <div className="grow">
            <div className="gw-status-title">
              <StatusDot status={gw.connected ? 'ok' : 'warn'} pulse={!gw.connected} />
              {gw.connected ? 'Connected' : 'Connecting…'}
              {gw.siteName && <Badge>{gw.siteName}</Badge>}
            </div>
            <div className="mono muted small">{gw.url}</div>
          </div>
          <Button variant="danger-ghost" icon={<IconUnlink size={15} />} onClick={() => void unlink()}>
            Disconnect
          </Button>
        </div>
      ) : (
        data && (
          <form className="stack-16" onSubmit={link}>
            <div className="form-grid">
              <FormField label="Gateway URL" htmlFor="gw-url">
                <Input id="gw-url" className="mono-input" type="url" placeholder="https://gateway.example.com" value={url} onChange={(e) => setUrl(e.target.value)} required />
              </FormField>
              <FormField label="Link code" htmlFor="gw-code">
                <Input id="gw-code" className="mono-input" placeholder="OCL-XXXXXXXX" value={code} onChange={(e) => setCode(e.target.value)} required />
              </FormField>
            </div>
            {formError && <Alert>{formError}</Alert>}
            <div>
              <Button type="submit" variant="primary" loading={busy} icon={<IconLink size={15} />}>
                Connect
              </Button>
            </div>
          </form>
        )
      )}
    </Card>
  );
}

function SitesSection() {
  const { data, setData, error, loading } = useAsync(() => api.sites(), []);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState<{ name: string; linkCode: string } | null>(null);
  const [createError, setCreateError] = useState<string | null>(null);

  const create = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setCreateError(null);
    try {
      const r = await api.createSite(name.trim());
      setCreated(r);
      setData((d) => ({ items: [...(d?.items ?? []), { id: r.id, name: r.name, online: false, cameras: 0 }] }));
    } catch (err) {
      setCreateError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (s: Site) => {
    const ok = await confirm({
      title: `Remove ${s.name}?`,
      message: 'The site is disconnected and must be linked again with a new code.',
      confirmLabel: 'Remove site',
      danger: true,
    });
    if (!ok) return;
    try {
      await api.deleteSite(s.id);
      setData((d) => ({ items: (d?.items ?? []).filter((x) => x.id !== s.id) }));
    } catch (e) {
      toast.error('Could not remove site', errorMessage(e));
    }
  };

  const close = () => {
    setCreating(false);
    setCreated(null);
    setName('');
    setCreateError(null);
  };

  return (
    <Card
      title="This server as a gateway"
      description="Home servers linked to this one. The app connects here and picks a site."
      actions={
        <Button size="sm" variant="secondary" icon={<IconPlus size={14} />} onClick={() => setCreating(true)}>
          Add site
        </Button>
      }
      padded={false}
    >
      {error && (
        <div className="card-body">
          <Alert>{error}</Alert>
        </div>
      )}
      {loading && !data && (
        <div className="card-body">
          <Skeleton h={44} w="100%" />
        </div>
      )}
      {data && data.items.length === 0 && (
        <EmptyState compact icon={<IconGateway size={22} />} title="No sites linked">
          Add a site to get a link code, then enter it on your home server under Gateway.
        </EmptyState>
      )}
      {data && data.items.length > 0 && (
        <table className="table">
          <thead>
            <tr>
              <th>Site</th>
              <th>Status</th>
              <th>Cameras</th>
              <th>Version</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {data.items.map((s) => (
              <tr key={s.id}>
                <td>
                  <div className="strong">{s.name}</div>
                  <div className="mono muted small">/s/{s.id}</div>
                </td>
                <td>
                  <span className="row gap-6">
                    <StatusDot status={s.online ? 'ok' : 'off'} />
                    {s.online ? 'Online' : s.lastSeen ? `Seen ${relativeTime(s.lastSeen)}` : 'Waiting for link'}
                  </span>
                </td>
                <td className="tabular">{s.cameras}</td>
                <td className="tabular muted">{s.version ? `v${s.version}` : '–'}</td>
                <td className="td-actions">
                  <IconButton label="Remove site" className="danger-hover" onClick={() => void remove(s)}>
                    <IconTrash size={16} />
                  </IconButton>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <Modal
        open={creating}
        onClose={close}
        size="sm"
        title={created ? 'Link code' : 'Add a site'}
        description={created ? `Enter this on ${created.name} under Gateway › Connect.` : 'Give the location a name, e.g. Home or Office.'}
      >
        {created ? (
          <div className="stack-16">
            <div className="link-code mono">{created.linkCode}</div>
            <CopyField value={created.linkCode} />
            <Button variant="primary" onClick={close}>
              Done
            </Button>
          </div>
        ) : (
          <form className="stack-16" onSubmit={create}>
            <FormField label="Site name" htmlFor="site-name">
              <Input id="site-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Home" required autoFocus />
            </FormField>
            {createError && <Alert>{createError}</Alert>}
            <div className="form-actions">
              <Button variant="ghost" onClick={close}>
                Cancel
              </Button>
              <Button type="submit" variant="primary" loading={busy}>
                Create link code
              </Button>
            </div>
          </form>
        )}
      </Modal>
    </Card>
  );
}
