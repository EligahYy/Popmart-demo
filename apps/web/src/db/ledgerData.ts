import {
  buildLedgerIndex,
  lineHeldQty,
  type AcquisitionLineLike,
  type RefundLineLike,
  type TransferLineLike,
} from '../domain/collection.js';
import type { LedgerRecord } from '../domain/ledger.js';
import type { PopmartDb } from './database.js';

export interface LedgerData {
  readonly records: readonly LedgerRecord[];
  readonly ips: ReadonlyArray<{ id: string; name: string }>;
}

export async function loadLedgerData(db: PopmartDb, datasetId: string): Promise<LedgerData> {
  const [acquisitions, lines, refundLines, transferLines, styles, series, ips] = await Promise.all([
    db.acquisitions.where({ datasetId }).toArray(),
    db.acquisitionLines.where({ datasetId }).toArray(),
    db.refundLines.where({ datasetId }).toArray(),
    db.transferLines.where({ datasetId }).toArray(),
    db.styles.where({ datasetId }).toArray(),
    db.series.where({ datasetId }).toArray(),
    db.ips.where({ datasetId }).toArray(),
  ]);

  const acquisitionById = new Map(acquisitions.map((row) => [row.id, row]));
  const styleById = new Map(styles.map((row) => [row.id, row]));
  const seriesById = new Map(series.map((row) => [row.id, row]));
  const ipById = new Map(ips.map((row) => [row.id, row]));

  const index = buildLedgerIndex(
    refundLines as unknown as RefundLineLike[],
    transferLines as unknown as TransferLineLike[],
  );

  const records: LedgerRecord[] = [];

  for (const line of lines as unknown as AcquisitionLineLike[]) {
    const acquisition = acquisitionById.get(line.acquisitionId);
    if (!acquisition || acquisition.status !== 'active' || line.status !== 'active') continue;

    const style = styleById.get(line.styleId);
    if (!style) continue;
    const series = seriesById.get(style.seriesId);
    if (!series) continue;
    const ip = ipById.get(series.ipId);

    const returned = (index.refundsByLine.get(line.id) ?? []).reduce(
      (total, refund) => total + refund.returnedQuantity,
      0,
    );
    const refunded = (index.refundsByLine.get(line.id) ?? []).reduce(
      (total, refund) => total + refund.refundCents,
      0,
    );

    const isGift = acquisition.source === 'gift';
    const statsQty = isGift ? 0 : Math.max(0, line.quantity - returned);
    const statsCents = isGift ? 0 : Math.max(0, (line.allocatedCents ?? 0) - refunded);

    records.push({
      lineId: line.id,
      acquisitionId: acquisition.id,
      styleId: style.id,
      ipId: ip?.id ?? 'unknown',
      ipName: ip?.displayName ?? '未知 IP',
      styleName: style.displayName,
      seriesName: series.displayName,
      imageUrl: style.imageUrl,
      imageAssetId: style.imageAssetId,
      date: acquisition.date,
      source: acquisition.source,
      channel: acquisition.channel,
      note: acquisition.note,
      quantity: line.quantity,
      statsQty,
      statsCents,
    });
  }

  const ipOptions = new Map<string, string>();
  for (const record of records) {
    ipOptions.set(record.ipId, record.ipName);
  }

  return {
    records,
    ips: [...ipOptions.entries()].map(([id, name]) => ({ id, name })),
  };
}

/** 本月额度用量：全部 IP、本自然月、不含日期不详。 */
export function monthUsage(records: readonly LedgerRecord[], month: string): { cents: number; qty: number } {
  let cents = 0;
  let qty = 0;
  for (const record of records) {
    const inMonth =
      (record.date.precision === 'day' && record.date.month === month) ||
      (record.date.precision === 'month' && record.date.month === month);
    if (!inMonth) continue;
    cents += record.statsCents;
    qty += record.statsQty;
  }
  return { cents, qty };
}

export interface BudgetLimits {
  readonly amountLimitCents: number | null;
  readonly quantityLimit: number | null;
  readonly fromSnapshot: boolean;
}

/** 读取某月额度：优先当月快照，其次最近一条生效规则；都没有则未设置。 */
export async function getBudgetLimits(
  db: PopmartDb,
  datasetId: string,
  month: string,
): Promise<BudgetLimits> {
  const snapshot = await db.budgetMonths
    .where('[datasetId+month]')
    .equals([datasetId, month])
    .first();

  if (snapshot) {
    return {
      amountLimitCents: snapshot.amountLimitCents,
      quantityLimit: snapshot.quantityLimit,
      fromSnapshot: true,
    };
  }

  const rules = await db.budgetRules.where({ datasetId }).toArray();
  const applicable = rules
    .filter((rule) => rule.effectiveFromMonth <= month)
    .sort((left, right) => right.effectiveFromMonth.localeCompare(left.effectiveFromMonth))[0];

  if (!applicable) {
    return { amountLimitCents: null, quantityLimit: null, fromSnapshot: false };
  }
  return {
    amountLimitCents: applicable.amountLimitCents,
    quantityLimit: applicable.quantityLimit,
    fromSnapshot: false,
  };
}

export interface AcquisitionDetailLine {
  readonly line: import('./rows.js').AcquisitionLineRow;
  readonly style: import('./rows.js').StyleRow | null;
  readonly refundedCents: number;
  readonly returnedQty: number;
  readonly transferredQty: number;
  readonly netPaidCents: number;
}

export interface AcquisitionDetail {
  readonly acquisition: import('./rows.js').AcquisitionRow;
  readonly lines: readonly AcquisitionDetailLine[];
  readonly refunds: readonly import('./rows.js').RefundRow[];
}

export async function getAcquisitionDetail(
  db: PopmartDb,
  datasetId: string,
  acquisitionId: string,
): Promise<AcquisitionDetail | null> {
  const acquisition = await db.acquisitions.get([datasetId, acquisitionId]);
  if (!acquisition) return null;

  const [lines, styles, refundLines, refunds, transferLines] = await Promise.all([
    db.acquisitionLines.where({ datasetId, acquisitionId }).toArray(),
    db.styles.where({ datasetId }).toArray(),
    db.refundLines.where({ datasetId }).toArray(),
    db.refunds.where({ datasetId }).toArray(),
    db.transferLines.where({ datasetId }).toArray(),
  ]);

  const styleById = new Map(styles.map((row) => [row.id, row]));
  const activeRefundIds = new Set(refunds.filter((row) => row.status === 'active').map((row) => row.id));

  const detailLines = lines
    .filter((line) => line.status === 'active')
    .map((line) => {
      const related = refundLines.filter(
        (row) => row.status === 'active' && row.acquisitionLineId === line.id && activeRefundIds.has(row.refundId),
      );
      const refundedCents = related.reduce((total, row) => total + row.refundCents, 0);
      const returnedQty = related.reduce((total, row) => total + row.returnedQuantity, 0);
      const transferredQty = transferLines
        .filter((row) => row.status === 'active' && row.acquisitionLineId === line.id)
        .reduce((total, row) => total + row.quantity, 0);
      return {
        line,
        style: styleById.get(line.styleId) ?? null,
        refundedCents,
        returnedQty,
        transferredQty,
        netPaidCents: (line.allocatedCents ?? 0) - refundedCents,
      };
    });

  return {
    acquisition,
    lines: detailLines,
    refunds: refunds.filter((row) => row.acquisitionId === acquisitionId && row.status === 'active'),
  };
}

export interface TransferableLine {
  readonly lineId: string;
  readonly held: number;
  readonly quantity: number;
  readonly date: string;
}

export async function getTransferableLines(
  db: PopmartDb,
  datasetId: string,
  styleId: string,
): Promise<TransferableLine[]> {
  const [lines, refundLines, transferLines] = await Promise.all([
    db.acquisitionLines.where('[datasetId+styleId]').equals([datasetId, styleId]).toArray(),
    db.refundLines.where({ datasetId }).toArray(),
    db.transferLines.where({ datasetId }).toArray(),
  ]);

  const returned = new Map<string, number>();
  for (const row of refundLines) {
    if (row.status !== 'active') continue;
    returned.set(row.acquisitionLineId, (returned.get(row.acquisitionLineId) ?? 0) + row.returnedQuantity);
  }
  const transferred = new Map<string, number>();
  for (const row of transferLines) {
    if (row.status !== 'active') continue;
    transferred.set(row.acquisitionLineId, (transferred.get(row.acquisitionLineId) ?? 0) + row.quantity);
  }

  const acquisitions = await db.acquisitions.where({ datasetId }).toArray();
  const acquisitionById = new Map(acquisitions.map((row) => [row.id, row]));

  return lines
    .filter((line) => line.status === 'active')
    .flatMap((line) => {
      const acquisition = acquisitionById.get(line.acquisitionId);
      if (!acquisition || acquisition.status !== 'active') return [];
      const held = line.quantity - (returned.get(line.id) ?? 0) - (transferred.get(line.id) ?? 0);
      if (held <= 0) return [];
      const date =
        acquisition.date.precision === 'day'
          ? acquisition.date.day
          : acquisition.date.precision === 'month'
            ? acquisition.date.month
            : '';
      return [{ lineId: line.id, held, quantity: line.quantity, date }];
    })
    .sort((left, right) => left.date.localeCompare(right.date));
}
