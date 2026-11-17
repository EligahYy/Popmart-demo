import type { Cents } from '@my-popmart/contracts';
import {
  buildLedgerIndex,
  lineHeldQty,
  netBoughtQty,
  netSpend,
  type AcquisitionLineLike,
  type RefundLineLike,
  type TransferLineLike,
} from '../domain/collection.js';
import type { PopmartDb } from './database.js';
import type {
  AcquisitionRow,
  AcquisitionSource,
  CollectionProfileRow,
  IpRow,
  SeriesRow,
  StyleRow,
} from './rows.js';

export interface CollectionState {
  readonly heldByStyle: ReadonlyMap<string, number>;
  readonly acquisitionsById: ReadonlyMap<string, AcquisitionRow>;
  readonly netSpendCents: Cents;
  readonly netBoughtQty: number;
}

export async function loadCollectionState(
  db: PopmartDb,
  datasetId: string,
): Promise<CollectionState> {
  const [acquisitions, lines, refundLines, transferLines] = await Promise.all([
    db.acquisitions.where({ datasetId }).toArray(),
    db.acquisitionLines.where({ datasetId }).toArray(),
    db.refundLines.where({ datasetId }).toArray(),
    db.transferLines.where({ datasetId }).toArray(),
  ]);

  const index = buildLedgerIndex(
    refundLines as unknown as RefundLineLike[],
    transferLines as unknown as TransferLineLike[],
  );

  const acquisitionsById = new Map<string, AcquisitionRow>(
    acquisitions.map((row) => [row.id, row]),
  );

  const heldByStyle = new Map<string, number>();
  for (const line of lines as unknown as AcquisitionLineLike[]) {
    const acquisition = acquisitionsById.get(line.acquisitionId);
    if (!acquisition || acquisition.status !== 'active' || line.status !== 'active') continue;
    const held = lineHeldQty(line, index);
    const current = heldByStyle.get(line.styleId) ?? 0;
    const next = current + held;
    if (next > 0) heldByStyle.set(line.styleId, next);
    else heldByStyle.delete(line.styleId);
  }

  const query = {
    acquisitionsById,
    lines: lines as unknown as AcquisitionLineLike[],
    index,
  };

  return {
    heldByStyle,
    acquisitionsById,
    netSpendCents: netSpend(query),
    netBoughtQty: netBoughtQty(query),
  };
}

export interface StyleWithHeld {
  readonly style: StyleRow;
  readonly held: number;
}

export interface SeriesView {
  readonly series: SeriesRow;
  readonly ip: IpRow | null;
  readonly styles: readonly StyleWithHeld[];
  readonly heldTotal: number;
  readonly ownedStyles: number;
}

export async function getSeriesViews(
  db: PopmartDb,
  datasetId: string,
): Promise<SeriesView[]> {
  const [seriesRows, styleRows, ipRows, state] = await Promise.all([
    db.series.where({ datasetId }).toArray(),
    db.styles.where({ datasetId }).toArray(),
    db.ips.where({ datasetId }).toArray(),
    loadCollectionState(db, datasetId),
  ]);

  const ipById = new Map(ipRows.map((ip) => [ip.id, ip]));
  const stylesBySeries = new Map<string, StyleRow[]>();
  for (const style of styleRows) {
    const bucket = stylesBySeries.get(style.seriesId);
    if (bucket) bucket.push(style);
    else stylesBySeries.set(style.seriesId, [style]);
  }

  return seriesRows
    .map((series) => {
      const styles = (stylesBySeries.get(series.id) ?? [])
        .slice()
        .sort((left, right) => left.sortOrder - right.sortOrder)
        .map((style) => ({ style, held: state.heldByStyle.get(style.id) ?? 0 }));
      const ownedStyles = styles.filter((entry) => entry.held > 0).length;
      const heldTotal = styles.reduce((total, entry) => total + entry.held, 0);
      return {
        series,
        ip: ipById.get(series.ipId) ?? null,
        styles,
        heldTotal,
        ownedStyles,
      };
    })
    .sort((left, right) => {
      const order = (right.series.importOrder ?? 0) - (left.series.importOrder ?? 0);
      if (order !== 0) return order;
      const leftTime = left.series.importedAt ?? left.series.createdAt;
      const rightTime = right.series.importedAt ?? right.series.createdAt;
      return rightTime.localeCompare(leftTime) || right.series.createdAt.localeCompare(left.series.createdAt) || left.series.id.localeCompare(right.series.id);
    });
}

export interface OwnedIpView {
  readonly ip: IpRow;
  readonly seriesCount: number;
  readonly styleCount: number;
  readonly heldTotal: number;
  readonly coverUrl: string | null;
  readonly coverAssetId: string | null;
  readonly covers: ReadonlyArray<{ url: string; assetId: string | null }>;
}

export async function getOwnedIps(db: PopmartDb, datasetId: string): Promise<OwnedIpView[]> {
  const views = await getSeriesViews(db, datasetId);
  const byIp = new Map<string, OwnedIpView>();

  for (const view of views) {
    if (!view.ip || view.heldTotal === 0) continue;
    const existing = byIp.get(view.ip.id);
    const ownedWithImage = view.styles.filter(
      (entry) => entry.held > 0 && entry.style.imageUrl !== null,
    );
    const coverEntry = ownedWithImage[0];
    const cover = coverEntry?.style.imageUrl ?? null;
    const coverAssetId = coverEntry?.style.imageAssetId ?? null;
    const covers = ownedWithImage.map((entry) => ({
      url: entry.style.imageUrl ?? '',
      assetId: entry.style.imageAssetId,
    }));

    if (existing) {
      byIp.set(view.ip.id, {
        ...existing,
        seriesCount: existing.seriesCount + 1,
        styleCount: existing.styleCount + view.ownedStyles,
        heldTotal: existing.heldTotal + view.heldTotal,
        coverUrl: existing.coverUrl ?? cover,
        coverAssetId: existing.coverAssetId ?? coverAssetId,
        covers: [...existing.covers, ...covers],
      });
    } else {
      byIp.set(view.ip.id, {
        ip: view.ip,
        seriesCount: 1,
        styleCount: view.ownedStyles,
        heldTotal: view.heldTotal,
        coverUrl: cover,
        coverAssetId,
        covers,
      });
    }
  }

  return [...byIp.values()].sort((left, right) => right.heldTotal - left.heldTotal);
}

export interface OwnedSeriesView {
  readonly series: SeriesRow;
  readonly styles: readonly StyleWithHeld[];
  readonly heldTotal: number;
}

export async function getOwnedSeries(
  db: PopmartDb,
  datasetId: string,
  ipId: string,
): Promise<OwnedSeriesView[]> {
  const views = await getSeriesViews(db, datasetId);
  return views
    .filter((view) => view.ip?.id === ipId && view.heldTotal > 0)
    .map((view) => ({
      series: view.series,
      styles: view.styles.filter((entry) => entry.held > 0),
      heldTotal: view.heldTotal,
    }));
}

export interface CardRecord {
  readonly date: import('@my-popmart/contracts').AcquisitionDate;
  readonly source: AcquisitionSource;
  readonly quantity: number;
  readonly channel: string | null;
}

export interface IdentityCardData {
  readonly style: StyleRow;
  readonly series: SeriesRow;
  readonly ip: IpRow | null;
  readonly profile: CollectionProfileRow | null;
  readonly held: number;
  readonly records: readonly CardRecord[];
}

export async function getIdentityCard(
  db: PopmartDb,
  datasetId: string,
  styleId: string,
): Promise<IdentityCardData | null> {
  const style = await db.styles.get([datasetId, styleId]);
  if (!style) return null;
  const series = await db.series.get([datasetId, style.seriesId]);
  if (!series) return null;

  const [ip, profile, lines, acquisitions, refundLines, transferLines] = await Promise.all([
    db.ips.get([datasetId, series.ipId]),
    db.collectionProfiles.where('[datasetId+styleId]').equals([datasetId, styleId]).first(),
    db.acquisitionLines.where('[datasetId+styleId]').equals([datasetId, styleId]).toArray(),
    db.acquisitions.where({ datasetId }).toArray(),
    db.refundLines.where({ datasetId }).toArray(),
    db.transferLines.where({ datasetId }).toArray(),
  ]);

  const acquisitionById = new Map(acquisitions.map((row) => [row.id, row]));
  const index = buildLedgerIndex(
    refundLines as unknown as RefundLineLike[],
    transferLines as unknown as TransferLineLike[],
  );

  let held = 0;
  const records: CardRecord[] = [];

  for (const line of lines as unknown as AcquisitionLineLike[]) {
    const acquisition = acquisitionById.get(line.acquisitionId);
    if (!acquisition || acquisition.status !== 'active' || line.status !== 'active') continue;
    const lineHeld = lineHeldQty(line, index);
    held += lineHeld;
    records.push({
      date: acquisition.date,
      source: acquisition.source,
      quantity: line.quantity,
      channel: acquisition.channel,
    });
  }

  records.sort((left, right) => {
    const leftKey = left.date.precision === 'day' ? left.date.day : left.date.precision === 'month' ? left.date.month : '';
    const rightKey = right.date.precision === 'day' ? right.date.day : right.date.precision === 'month' ? right.date.month : '';
    return rightKey.localeCompare(leftKey);
  });

  return { style, series, ip: ip ?? null, profile: profile ?? null, held, records };
}

export { DEFAULT_SPACE_NAME } from './commands.js';

export async function getSpaceName(db: PopmartDb, datasetId: string): Promise<string> {
  const row = await db.preferences.get([datasetId, 'spaceName']);
  const value = row?.value?.trim() ?? '';
  return value === '' ? '红彤彤收纳' : value;
}
