import { isCents, type Cents } from '@my-popmart/contracts';

export type PriceProvenance = 'user_confirmed' | 'catalog' | 'from_history';

export interface StylePriceFields {
  readonly referenceUnitCents?: Cents | null;
}

export interface SeriesPriceFields {
  readonly defaultUnitCents?: Cents | null;
}

/**
 * 参考价解析：款式级优先，其次系列级，都没有则为 null。
 * 只存人民币分，海外币种价不进入这里。
 */
export function resolveReferenceUnitCents(
  style: StylePriceFields,
  series: SeriesPriceFields,
): Cents | null {
  const own = style.referenceUnitCents;
  if (own !== null && own !== undefined && isCents(own)) return own;

  const fallback = series.defaultUnitCents;
  if (fallback !== null && fallback !== undefined && isCents(fallback)) return fallback;

  return null;
}

/** 自动金额 = 参考价 × 数量；没有参考价时不预填，绝不虚构。 */
export function defaultPaidTotalCents(unit: Cents | null, quantity: number): Cents | null {
  if (unit === null) return null;
  if (!isCents(unit)) {
    throw new Error('reference unit must be non-negative safe integer cents');
  }
  if (!Number.isSafeInteger(quantity) || quantity <= 0) {
    throw new Error('quantity must be a positive integer');
  }
  const total = unit * quantity;
  if (!Number.isSafeInteger(total)) {
    throw new Error('paid total exceeds safe integer range');
  }
  return total;
}

export type AmountMode = 'official_auto' | 'manual';

/** 只有自动模式才允许随数量重算；手动输入永远保留。 */
export function shouldRecalculateAutomatically(mode: AmountMode): boolean {
  return mode === 'official_auto';
}
