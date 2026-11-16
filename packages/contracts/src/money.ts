/**
 * 金额以「分」存储，始终为非负安全整数。
 * 本文件不做任何浮点乘除，避免 0.1 + 0.2 类误差。
 */

export type Cents = number;

export const MAX_SAFE_CENTS = Number.MAX_SAFE_INTEGER;

const DECIMAL_RE = /^(\d+)(?:\.(\d{1,2}))?$/;

export type AmountErrorCode =
  | 'INVALID_AMOUNT'
  | 'AMOUNT_OUT_OF_RANGE'
  | 'NEGATIVE_AMOUNT'
  | 'ZERO_WEIGHTS'
  | 'EMPTY_WEIGHTS'
  | 'ALLOCATION_MISMATCH';

export class AmountError extends Error {
  override readonly name = 'AmountError';
  constructor(
    readonly code: AmountErrorCode,
    message: string,
  ) {
    super(message);
  }
}

export function isCents(value: unknown): value is Cents {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

export function assertCents(value: unknown, field = 'amount'): asserts value is Cents {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value < 0) {
    throw new AmountError('NEGATIVE_AMOUNT', `${field} 不能为负数`);
  }
  if (!isCents(value)) {
    throw new AmountError('AMOUNT_OUT_OF_RANGE', `${field} 必须是安全的非负整数分`);
  }
}

/**
 * 十进制字符串 → 分。只接受 `69`、`69.5`、`69.50` 这类写法；
 * 拒绝负号、指数、超过两位小数、千分位与空串。
 */
export function parseCents(input: string): Cents {
  const text = input.trim();
  if (text === '') {
    throw new AmountError('INVALID_AMOUNT', '金额不能为空');
  }
  const matched = DECIMAL_RE.exec(text);
  if (!matched) {
    throw new AmountError('INVALID_AMOUNT', '金额格式应为最多两位小数');
  }
  const whole = matched[1] ?? '0';
  const fraction = (matched[2] ?? '').padEnd(2, '0');
  const digits = `${whole}${fraction}`;
  const value = BigInt(digits);
  if (value > BigInt(MAX_SAFE_CENTS)) {
    throw new AmountError('AMOUNT_OUT_OF_RANGE', '金额超出安全范围');
  }
  return Number(value);
}

/** 分 → `69.00` 形式（不带货币符号）。 */
export function formatCents(value: Cents): string {
  assertCents(value);
  const yuan = Math.floor(value / 100);
  const fen = value % 100;
  return `${yuan}.${String(fen).padStart(2, '0')}`;
}

/** 分 → `¥69.00` 形式。 */
export function formatCny(value: Cents): string {
  return `¥${formatCents(value)}`;
}

export function sumCents(values: readonly Cents[]): Cents {
  let total = 0;
  for (const value of values) {
    assertCents(value);
    total += value;
    if (!Number.isSafeInteger(total)) {
      throw new AmountError('AMOUNT_OUT_OF_RANGE', '金额合计超出安全范围');
    }
  }
  return total;
}

/**
 * 最大余数法：把 total 按 weights 比例拆成整数分，合计严格等于 total。
 * 余数相同时按数组下标升序补 1 分（稳定的 lineOrder）。
 */
export function allocateByWeight(total: Cents, weights: readonly Cents[]): Cents[] {
  assertCents(total, 'total');
  for (const weight of weights) {
    assertCents(weight, 'weight');
  }

  if (weights.length === 0) {
    if (total === 0) return [];
    throw new AmountError('EMPTY_WEIGHTS', '没有可分摊的明细');
  }

  const totalBig = BigInt(total);
  const sumWeight = weights.reduce((acc, weight) => acc + BigInt(weight), 0n);

  if (sumWeight === 0n) {
    if (totalBig === 0n) return weights.map(() => 0);
    throw new AmountError('ZERO_WEIGHTS', '权重合计为零，无法按比例分摊');
  }

  const floors: bigint[] = [];
  const remainders: bigint[] = [];
  for (const weight of weights) {
    const numerator = totalBig * BigInt(weight);
    floors.push(numerator / sumWeight);
    remainders.push(numerator % sumWeight);
  }

  const distributed = floors.reduce((acc, value) => acc + value, 0n);
  let remaining = totalBig - distributed;

  const order = remainders
    .map((remainder, index) => ({ remainder, index }))
    .sort((left, right) =>
      left.remainder === right.remainder
        ? left.index - right.index
        : left.remainder > right.remainder
          ? -1
          : 1,
    );

  let cursor = 0;
  while (remaining > 0n) {
    const target = order[cursor % order.length];
    if (!target) break;
    floors[target.index] = (floors[target.index] ?? 0n) + 1n;
    remaining -= 1n;
    cursor += 1;
  }

  return floors.map((value) => Number(value));
}

/** 校验一组分摊金额合计等于总额，且每项非负。 */
export function assertAllocationSumsTo(total: Cents, allocations: readonly Cents[]): void {
  assertCents(total, 'total');
  const sum = sumCents(allocations);
  if (sum !== total) {
    throw new AmountError('ALLOCATION_MISMATCH', `分摊合计 ${sum} 与总额 ${total} 不一致`);
  }
}

/** 手动分摊后还剩多少；负数表示超出。 */
export function allocationGap(total: Cents, allocations: readonly Cents[]): number {
  return total - sumCents(allocations);
}
