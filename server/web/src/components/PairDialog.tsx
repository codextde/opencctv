import { useEffect, useMemo, useState } from 'react';
import qrcode from 'qrcode-generator';
import { api, errorMessage } from '../api';
import type { PairingCode, Role } from '../types';
import { Alert, Button, Modal, Segmented, Skeleton, useNow } from './ui';
import { IconRefresh } from './icons';

export function QrCode({ value, size = 220 }: { value: string; size?: number }) {
  const path = useMemo(() => {
    const qr = qrcode(0, 'M');
    qr.addData(value);
    qr.make();
    const n = qr.getModuleCount();
    let d = '';
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        if (qr.isDark(r, c)) d += `M${c} ${r}h1v1h-1z`;
      }
    }
    return { d, n };
  }, [value]);
  const quiet = 3;
  const total = path.n + quiet * 2;
  return (
    <svg
      className="qr"
      width={size}
      height={size}
      viewBox={`${-quiet} ${-quiet} ${total} ${total}`}
      shapeRendering="crispEdges"
      role="img"
      aria-label="QR code"
    >
      <rect x={-quiet} y={-quiet} width={total} height={total} rx={2.4} fill="#fff" />
      <path d={path.d} fill="#0B0D10" />
    </svg>
  );
}

export function PairDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [role, setRole] = useState<Role>('viewer');
  const [pc, setPc] = useState<PairingCode | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const now = useNow(1000);

  const generate = async (r: Role = role) => {
    setLoading(true);
    setError(null);
    try {
      setPc(await api.pairingCode(r));
    } catch (e) {
      setError(errorMessage(e));
      setPc(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (open) void generate();
    else setPc(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const remaining = pc ? Math.max(0, Math.floor((new Date(pc.expiresAt).getTime() - now) / 1000)) : 0;
  const expired = !!pc && remaining <= 0;
  const mm = Math.floor(remaining / 60);
  const ss = String(remaining % 60).padStart(2, '0');

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="sm"
      title="Pair a phone"
      description="Scan the code with the OpenCCTV app, or enter it manually."
    >
      <div className="pair">
        <Segmented
          value={role}
          ariaLabel="Access level"
          onChange={(r) => {
            setRole(r);
            void generate(r);
          }}
          options={[
            { value: 'viewer', label: 'Viewer access' },
            { value: 'admin', label: 'Admin access' },
          ]}
        />
        <div className={`pair-qr ${expired ? 'is-expired' : ''}`}>
          {pc && !loading ? <QrCode value={pc.url} size={208} /> : <Skeleton w={208} h={208} r={12} />}
          {expired && (
            <div className="pair-expired">
              <Button variant="primary" size="sm" icon={<IconRefresh size={14} />} onClick={() => void generate()}>
                New code
              </Button>
            </div>
          )}
        </div>
        <div className="pair-code mono" aria-label="Pairing code">
          {pc ? pc.code : '······'}
        </div>
        <div className="pair-expiry tabular">
          {pc ? (expired ? 'This code has expired' : `Expires in ${mm}:${ss}`) : loading ? 'Generating…' : ''}
        </div>
        {error && <Alert>{error}</Alert>}
        <ol className="pair-steps">
          <li>Install the OpenCCTV app on your phone.</li>
          <li>Tap <strong>Add server</strong>, then <strong>Scan code</strong>.</li>
          <li>Point the camera at this screen. The code works once.</li>
        </ol>
      </div>
    </Modal>
  );
}
