import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { NavLink, useParams } from 'react-router-dom';
import { useRuntime } from '../../app/RuntimeProvider.js';
import { getOwnedSeries, type OwnedSeriesView } from '../../db/queries.js';
import type { IpRow } from '../../db/rows.js';
import type { StyleWithHeld } from '../../db/queries.js';
import { IdentityCard } from './IdentityCard.js';
import { StyleImage } from '../../components/StyleImage.js';

const CARD_WIDTH = 80;
const CARD_OFFSET = 28;
const ROTATE = 5;
const SIDE_SCALE = 0.86;
const SIDE_DROP = 6;
const SWIPE_THRESHOLD = 48;
const MAX_DRAG = 36;

export function CollectionPage() {
  const { ipId } = useParams();
  const { db, datasetId, sharedVersion } = useRuntime();
  const [ip, setIp] = useState<IpRow | null>(null);
  const [series, setSeries] = useState<OwnedSeriesView[] | null>(null);
  const [openStyleId, setOpenStyleId] = useState<string | null>(null);
  const [openOrigin, setOpenOrigin] = useState<DOMRect | null>(null);

  const load = useCallback(async () => {
    if (!ipId) return;
    const [ipRow, seriesRows] = await Promise.all([
      db.ips.get([datasetId, ipId]),
      getOwnedSeries(db, datasetId, ipId),
    ]);
    setIp(ipRow ?? null);
    setSeries(seriesRows);
  }, [db, datasetId, sharedVersion, ipId]);

  useEffect(() => {
    void load();
  }, [load]);

  const totals = useMemo(() => {
    const rows = series ?? [];
    return {
      series: rows.length,
      styles: rows.reduce((total, row) => total + row.styles.length, 0),
      held: rows.reduce((total, row) => total + row.heldTotal, 0),
    };
  }, [series]);

  return (
    <main className="page">
      <header className="hero">
        <div className="hero__top">
          <NavLink to="/" className="hero__settings" aria-label="返回小窝">
            ← 小窝
          </NavLink>
        </div>
        <h1 className="page__title">{ip?.displayName ?? '收藏夹'}</h1>
        <p className="page__hint">
          {series === null ? '正在整理卡组…' : `${totals.series} 个系列 · ${totals.styles} 款 · 共 ${totals.held} 只`}
        </p>
      </header>

      {series !== null && series.length === 0 ? (
        <div className="empty">
          <p>这个 IP 还没有已拥有的款式。</p>
        </div>
      ) : null}

      <div className="series-grid">
        {(series ?? []).map((row) => (
          <section key={row.series.id} className="series-block">
            <h2 className="series-block__title">{row.series.displayName}</h2>
            <SeriesFan
              entries={row.styles}
              onOpen={(styleId, rect) => {
                setOpenStyleId(styleId);
                setOpenOrigin(rect);
              }}
            />
            <p className="list__meta">
              已拥有 {row.styles.length} 款 · 共 {row.heldTotal} 只
            </p>
          </section>
        ))}
      </div>

      {openStyleId ? (
        <IdentityCard
          styleId={openStyleId}
          originRect={openOrigin}
          onClose={() => {
            setOpenStyleId(null);
            setOpenOrigin(null);
          }}
          onTransferred={() => {
            void load();
          }}
        />
      ) : null}
    </main>
  );
}

function SeriesFan({
  entries,
  onOpen,
}: {
  entries: readonly StyleWithHeld[];
  onOpen: (styleId: string, rect: DOMRect) => void;
}) {
  const count = entries.length;
  const [index, setIndex] = useState(0);
  const [dragX, setDragX] = useState(0);
  const [dragging, setDragging] = useState(false);
  const startX = useRef(0);
  const movedRef = useRef(false);

  if (count === 0) return null;

  const clampedIndex = Math.min(index, count - 1);

  // 始终展示三张：首尾循环，不存在边界
  let slots: Array<StyleWithHeld | null>;
  if (count >= 3) {
    slots = [
      entries[(clampedIndex - 1 + count) % count] ?? null,
      entries[clampedIndex] ?? null,
      entries[(clampedIndex + 1) % count] ?? null,
    ];
  } else if (count === 2) {
    slots = [null, entries[clampedIndex] ?? null, entries[(clampedIndex + 1) % count] ?? null];
  } else {
    slots = [null, entries[0] ?? null, null];
  }

  function move(delta: number) {
    setIndex((current) => (current + delta + count) % count);
  }

  function endDrag() {
    if (dragging && Math.abs(dragX) > SWIPE_THRESHOLD) {
      move(dragX < 0 ? 1 : -1);
    }
    setDragX(0);
    setDragging(false);
  }

  const clampedDrag = Math.max(-MAX_DRAG, Math.min(MAX_DRAG, dragX));

  return (
    <div className="fan" aria-label="系列卡组">
      <div
        className="fan__stage"
        onPointerDown={(event) => {
          startX.current = event.clientX;
          movedRef.current = false;
          setDragging(true);
          setDragX(0);
        }}
        onPointerMove={(event) => {
          if (!dragging) return;
          const dx = event.clientX - startX.current;
          if (Math.abs(dx) > 8) movedRef.current = true;
          setDragX(dx);
        }}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        {slots.map((entry, position) => {
          if (!entry) return null;
          const isMiddle = position === 1;
          const offset = isMiddle ? clampedDrag : (position - 1) * CARD_OFFSET + clampedDrag * 0.3;
          const drop = isMiddle ? 0 : SIDE_DROP;
          const rot = (position - 1) * ROTATE;
          const scale = isMiddle ? 1 : SIDE_SCALE;
          return (
            <button
              key={entry.style.id}
              type="button"
              className={`fan__card${isMiddle ? ' fan__card--active' : ''}${
                dragging ? '' : ' fan__card--settling'
              }`}
              style={{
                left: '50%',
                width: `${CARD_WIDTH}px`,
                transform: `translateX(-50%) translateX(${offset}px) translateY(${drop}px) rotate(${rot}deg) scale(${scale})`,
                zIndex: isMiddle ? 30 : 20,
              }}
              onClick={(event) => {
                if (movedRef.current) return;
                onOpen(entry.style.id, event.currentTarget.getBoundingClientRect());
              }}
            >
              <StyleImage
                url={entry.style.imageUrl}
                assetId={entry.style.imageAssetId}
                alt={entry.style.displayName}
              />
              {entry.held > 1 ? <span className="fan__count">×{entry.held}</span> : null}
            </button>
          );
        })}
      </div>

      <div className="fan__footer">
        <span className="fan__indicator">
          第 {clampedIndex + 1} / {count} 款
        </span>
      </div>
    </div>
  );
}
