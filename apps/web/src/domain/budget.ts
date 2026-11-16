export type BudgetLevel = 'ample' | 'warning' | 'reached' | 'exceeded';

/**
 * 预算状态用整数比较，避免浮点误差：
 * <75% 宽裕，75%–99.99% 提醒，恰好 100% 到上限，>100% 超额。
 */
export function budgetLevel(used: number, limit: number): BudgetLevel {
  if (!Number.isSafeInteger(used) || used < 0) {
    throw new Error('used must be a non-negative safe integer');
  }
  if (!Number.isSafeInteger(limit) || limit <= 0) {
    throw new Error('limit must be a positive safe integer');
  }

  const usedBig = BigInt(used);
  const limitBig = BigInt(limit);

  if (usedBig === limitBig) return 'reached';
  if (usedBig > limitBig) return 'exceeded';
  if (usedBig * 100n >= limitBig * 75n) return 'warning';
  return 'ample';
}

/** 余额；负数表示超出。 */
export function budgetRemaining(used: number, limit: number): number {
  return limit - used;
}

/** 恰好 75% 也进入提醒区间。 */
export function isAtOrAboveRatio(
  used: number,
  limit: number,
  numerator: number,
  denominator: number,
): boolean {
  return BigInt(used) * BigInt(denominator) >= BigInt(limit) * BigInt(numerator);
}

export interface BudgetUsageView {
  readonly used: number;
  readonly limit: number;
  readonly level: BudgetLevel;
  readonly remaining: number;
  readonly exceededBy: number;
}

export function describeBudgetUsage(used: number, limit: number): BudgetUsageView {
  const level = budgetLevel(used, limit);
  const remaining = budgetRemaining(used, limit);
  return {
    used,
    limit,
    level,
    remaining,
    exceededBy: remaining < 0 ? -remaining : 0,
  };
}
