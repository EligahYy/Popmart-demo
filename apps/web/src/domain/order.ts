import { allocateByWeight, sumCents, type Cents } from '@my-popmart/contracts';

export interface OrderLineInput {
  readonly styleId: string;
  readonly quantity: number;
  readonly unitCents: Cents | null;
}

/** 权重 = 参考价 × 数量；任一款缺参考价时返回 null，不把不完整合计当整单金额。 */
export function orderWeights(lines: readonly OrderLineInput[]): Cents[] | null {
  const weights: Cents[] = [];
  for (const line of lines) {
    if (line.unitCents === null) return null;
    if (!Number.isSafeInteger(line.quantity) || line.quantity <= 0) return null;
    weights.push(line.unitCents * line.quantity);
  }
  return weights;
}

/** 默认订单金额：所有参考价齐全时等于各款参考价 × 数量之和。 */
export function orderDefaultTotal(lines: readonly OrderLineInput[]): Cents | null {
  const weights = orderWeights(lines);
  return weights === null ? null : sumCents(weights);
}

/** 按官方价权重分摊订单实付；权重缺失时返回 null，要求手动分配。 */
export function allocateOrder(
  totalCents: Cents,
  lines: readonly OrderLineInput[],
): Cents[] | null {
  const weights = orderWeights(lines);
  if (weights === null) return null;
  return allocateByWeight(totalCents, weights);
}

/** 手动分配与订单总额的差额；0 表示可以保存。 */
export function orderAllocationGap(totalCents: Cents, allocations: readonly Cents[]): number {
  return totalCents - sumCents(allocations);
}
