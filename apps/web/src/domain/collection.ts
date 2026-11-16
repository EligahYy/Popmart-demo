import type { Cents } from '@my-popmart/contracts';

export type RecordStatus = 'active' | 'deleted';
export type AcquisitionSource = 'official' | 'secondhand' | 'gift';

export interface AcquisitionLike {
  readonly id: string;
  readonly source: AcquisitionSource;
  readonly status: RecordStatus;
}

export interface AcquisitionLineLike {
  readonly id: string;
  readonly acquisitionId: string;
  readonly styleId: string;
  readonly quantity: number;
  readonly allocatedCents: Cents | null;
  readonly status: RecordStatus;
}

export interface RefundLineLike {
  readonly acquisitionLineId: string;
  readonly refundCents: Cents;
  readonly returnedQuantity: number;
  readonly status: RecordStatus;
}

export interface TransferLineLike {
  readonly acquisitionLineId: string;
  readonly quantity: number;
  readonly status: RecordStatus;
}

export interface LedgerIndex {
  readonly refundsByLine: ReadonlyMap<string, readonly RefundLineLike[]>;
  readonly transfersByLine: ReadonlyMap<string, readonly TransferLineLike[]>;
}

export function buildLedgerIndex(
  refundLines: readonly RefundLineLike[],
  transferLines: readonly TransferLineLike[],
): LedgerIndex {
  const refundsByLine = new Map<string, RefundLineLike[]>();
  for (const line of refundLines) {
    if (line.status !== 'active') continue;
    const bucket = refundsByLine.get(line.acquisitionLineId);
    if (bucket) bucket.push(line);
    else refundsByLine.set(line.acquisitionLineId, [line]);
  }

  const transfersByLine = new Map<string, TransferLineLike[]>();
  for (const line of transferLines) {
    if (line.status !== 'active') continue;
    const bucket = transfersByLine.get(line.acquisitionLineId);
    if (bucket) bucket.push(line);
    else transfersByLine.set(line.acquisitionLineId, [line]);
  }

  return { refundsByLine, transfersByLine };
}

export function lineReturnedQty(lineId: string, index: LedgerIndex): number {
  const lines = index.refundsByLine.get(lineId) ?? [];
  return lines.reduce((total, line) => total + line.returnedQuantity, 0);
}

export function lineTransferredQty(lineId: string, index: LedgerIndex): number {
  const lines = index.transfersByLine.get(lineId) ?? [];
  return lines.reduce((total, line) => total + line.quantity, 0);
}

/** 批次当前持有量 = 购买数量 − 已退货 − 已转出。 */
export function lineHeldQty(line: AcquisitionLineLike, index: LedgerIndex): number {
  return line.quantity - lineReturnedQty(line.id, index) - lineTransferredQty(line.id, index);
}

/** 批次净实付 = 分摊金额 − 已退款。 */
export function lineNetPaid(line: AcquisitionLineLike, index: LedgerIndex): Cents {
  if (line.allocatedCents === null) return 0;
  const refunded = (index.refundsByLine.get(line.id) ?? []).reduce(
    (total, refund) => total + refund.refundCents,
    0,
  );
  return line.allocatedCents - refunded;
}

export interface LedgerQuery {
  readonly acquisitionsById: ReadonlyMap<string, AcquisitionLike>;
  readonly lines: readonly AcquisitionLineLike[];
  readonly index: LedgerIndex;
  readonly match?: (acquisition: AcquisitionLike, line: AcquisitionLineLike) => boolean;
}

function isCountedLine(line: AcquisitionLineLike, acquisition: AcquisitionLike): boolean {
  return line.status === 'active' && acquisition.status === 'active';
}

/** 按款式汇总当前持有量，用于收藏架。 */
export function styleHeldQtyMap(query: LedgerQuery): Map<string, number> {
  const result = new Map<string, number>();
  for (const line of query.lines) {
    const acquisition = query.acquisitionsById.get(line.acquisitionId);
    if (!acquisition || !isCountedLine(line, acquisition)) continue;
    if (query.match && !query.match(acquisition, line)) continue;
    const held = lineHeldQty(line, query.index);
    result.set(line.styleId, (result.get(line.styleId) ?? 0) + held);
  }
  return result;
}

/** 净购买数量：只算 official / secondhand，扣除退货；礼物不计。 */
export function netBoughtQty(query: LedgerQuery): number {
  let total = 0;
  for (const line of query.lines) {
    const acquisition = query.acquisitionsById.get(line.acquisitionId);
    if (!acquisition || !isCountedLine(line, acquisition)) continue;
    if (acquisition.source === 'gift') continue;
    if (query.match && !query.match(acquisition, line)) continue;
    total += line.quantity - lineReturnedQty(line.id, query.index);
  }
  return total;
}

/** 净消费：只算 official / secondhand；礼物与售出收入不进入。 */
export function netSpend(query: LedgerQuery): Cents {
  let total = 0;
  for (const line of query.lines) {
    const acquisition = query.acquisitionsById.get(line.acquisitionId);
    if (!acquisition || !isCountedLine(line, acquisition)) continue;
    if (acquisition.source === 'gift') continue;
    if (query.match && !query.match(acquisition, line)) continue;
    total += lineNetPaid(line, query.index);
  }
  return total;
}

/** 订单净额应等于其明细净额之和。 */
export function orderNetPaid(
  acquisitionId: string,
  lines: readonly AcquisitionLineLike[],
  index: LedgerIndex,
): Cents {
  return lines
    .filter((line) => line.acquisitionId === acquisitionId && line.status === 'active')
    .reduce((total, line) => total + lineNetPaid(line, index), 0);
}

export interface InvariantViolation {
  readonly code:
    | 'NEGATIVE_HELD'
    | 'NEGATIVE_NET_PAID'
    | 'REFUND_EXCEEDS_ALLOCATION'
    | 'RETURN_EXCEEDS_QUANTITY'
    | 'TRANSFER_EXCEEDS_HELD';
  readonly lineId: string;
  readonly detail: string;
}

/**
 * 写入前校验：持有量、退款、转出都不得越界。
 * 命令层必须在事务内调用，不能只信表单展示值。
 */
export function checkLineInvariants(
  line: AcquisitionLineLike,
  index: LedgerIndex,
): InvariantViolation[] {
  const violations: InvariantViolation[] = [];
  const refunded = (index.refundsByLine.get(line.id) ?? []).reduce(
    (total, refund) => total + refund.refundCents,
    0,
  );
  const returned = lineReturnedQty(line.id, index);
  const transferred = lineTransferredQty(line.id, index);

  if (returned > line.quantity) {
    violations.push({
      code: 'RETURN_EXCEEDS_QUANTITY',
      lineId: line.id,
      detail: `退货 ${returned} 超过购买数量 ${line.quantity}`,
    });
  }
  if (transferred > line.quantity - returned) {
    violations.push({
      code: 'TRANSFER_EXCEEDS_HELD',
      lineId: line.id,
      detail: `转出 ${transferred} 超过可转出数量 ${line.quantity - returned}`,
    });
  }
  if (line.quantity - returned - transferred < 0) {
    violations.push({
      code: 'NEGATIVE_HELD',
      lineId: line.id,
      detail: `持有数量为负：${line.quantity - returned - transferred}`,
    });
  }
  if (line.allocatedCents !== null) {
    if (refunded > line.allocatedCents) {
      violations.push({
        code: 'REFUND_EXCEEDS_ALLOCATION',
        lineId: line.id,
        detail: `退款 ${refunded} 超过分摊金额 ${line.allocatedCents}`,
      });
    }
    if (line.allocatedCents - refunded < 0) {
      violations.push({
        code: 'NEGATIVE_NET_PAID',
        lineId: line.id,
        detail: `净实付为负：${line.allocatedCents - refunded}`,
      });
    }
  }
  return violations;
}
