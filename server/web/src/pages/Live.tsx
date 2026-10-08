import { useMemo } from 'react';
import { navigate, useRoute } from '../router';
import { useApp } from '../store';
import { CameraTile } from '../components/CameraMedia';
import { LiveViewer } from '../components/LiveViewer';
import { IconCamera, IconPlus, IconRadar } from '../components/icons';
import { Alert, Button, EmptyState, PageHeader, Segmented, Skeleton, useLocalStorage } from '../components/ui';

type Cols = 1 | 2 | 3 | 4;

function GridGlyph({ n }: { n: Cols }) {
  const cells = n === 1 ? 1 : n;
  const w = 14;
  const gap = 1.5;
  const cw = (w - gap * (cells - 1)) / cells;
  return (
    <svg width="14" height="12" viewBox="0 0 14 12" aria-hidden="true">
      {Array.from({ length: cells }, (_, i) => (
        <rect key={i} x={i * (cw + gap)} y="0" width={cw} height="12" rx="1.2" fill="currentColor" opacity=".9" />
      ))}
    </svg>
  );
}

export function LivePage() {
  const { cameras, camerasError, isAdmin } = useApp();
  const route = useRoute();
  const [cols, setCols] = useLocalStorage<Cols>('opencctv.liveCols', 3);
  const [group, setGroup] = useLocalStorage<string>('opencctv.liveGroup', '');

  const groups = useMemo(() => [...new Set((cameras ?? []).map((c) => c.group).filter((g): g is string => !!g))].sort(), [cameras]);
  const activeGroup = groups.includes(group) ? group : '';
  const visible = useMemo(
    () => (cameras ?? []).filter((c) => !activeGroup || c.group === activeGroup),
    [cameras, activeGroup],
  );

  const openId = route.segments[1];
  const openIdx = visible.findIndex((c) => c.id === openId);
  const openCam = openIdx >= 0 ? visible[openIdx] : cameras?.find((c) => c.id === openId);

  const online = (cameras ?? []).filter((c) => c.enabled && c.status.online).length;
  const recording = (cameras ?? []).filter((c) => c.status.recording).length;

  return (
    <div className="page page-wide">
      <PageHeader
        title="Live"
        description={
          cameras ? (
            <span className="tabular">
              {cameras.length} {cameras.length === 1 ? 'camera' : 'cameras'} · {online} online · {recording} recording
            </span>
          ) : (
            <Skeleton w={200} h={12} />
          )
        }
        actions={
          <>
            {groups.length > 0 && (
              <Segmented
                size="sm"
                value={activeGroup}
                onChange={setGroup}
                ariaLabel="Camera group"
                options={[{ value: '', label: 'All' }, ...groups.map((g) => ({ value: g, label: g }))]}
              />
            )}
            <Segmented<Cols>
              size="sm"
              value={cols}
              onChange={setCols}
              ariaLabel="Grid columns"
              options={([1, 2, 3, 4] as Cols[]).map((n) => ({ value: n, label: <GridGlyph n={n} />, title: `${n} per row` }))}
            />
          </>
        }
      />

      {camerasError && !cameras && <Alert>{camerasError}</Alert>}

      {!cameras && !camerasError && (
        <div className={`live-grid cols-${cols}`}>
          {Array.from({ length: 6 }, (_, i) => (
            <div key={i} className="tile tile-skeleton">
              <div className="tile-media skeleton" />
            </div>
          ))}
        </div>
      )}

      {cameras && cameras.length === 0 && (
        <EmptyState
          icon={<IconCamera size={26} />}
          title="No cameras yet"
          action={
            isAdmin && (
              <div className="row gap-8">
                <Button variant="primary" icon={<IconPlus size={16} />} onClick={() => navigate('/cameras/add')}>
                  Add camera
                </Button>
                <Button variant="secondary" icon={<IconRadar size={16} />} onClick={() => navigate('/cameras/add', { step: 'discover' })}>
                  Scan network
                </Button>
              </div>
            )
          }
        >
          {isAdmin
            ? 'Add your first camera to see it here. OpenCCTV works with RTSP and ONVIF cameras from Reolink, Tapo, Hikvision, UniFi and many more.'
            : 'An administrator needs to add cameras before they show up here.'}
        </EmptyState>
      )}

      {cameras && cameras.length > 0 && (
        <div className={`live-grid cols-${cols}`}>
          {visible.map((c) => (
            <CameraTile key={c.id} camera={c} compact={cols === 4} onOpen={() => navigate(`/live/${c.id}`)} />
          ))}
        </div>
      )}

      {openCam && (
        <LiveViewer
          camera={openCam}
          onClose={() => navigate('/live')}
          onPrev={openIdx > 0 ? () => navigate(`/live/${visible[openIdx - 1]!.id}`, undefined, true) : undefined}
          onNext={openIdx >= 0 && openIdx < visible.length - 1 ? () => navigate(`/live/${visible[openIdx + 1]!.id}`, undefined, true) : undefined}
        />
      )}
    </div>
  );
}
