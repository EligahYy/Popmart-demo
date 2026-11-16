import { describe, expect, it } from 'vitest';
import { budgetLevel, budgetRemaining, describeBudgetUsage } from './budget.js';

describe('budgetLevel', () => {
  it('is ample below 75%', () => {
    expect(budgetLevel(0, 30000)).toBe('ample');
    expect(budgetLevel(22499, 30000)).toBe('ample');
  });

  it('warns from exactly 75% up to but not including 100%', () => {
    expect(budgetLevel(22500, 30000)).toBe('warning');
    expect(budgetLevel(29999, 30000)).toBe('warning');
  });

  it('is reached at exactly 100%', () => {
    expect(budgetLevel(30000, 30000)).toBe('reached');
  });

  it('is exceeded above 100%', () => {
    expect(budgetLevel(30001, 30000)).toBe('exceeded');
    expect(budgetLevel(32800, 30000)).toBe('exceeded');
  });

  it('works for small quantity limits (e.g. 3 of 4)', () => {
    expect(budgetLevel(3, 4)).toBe('warning');
    expect(budgetLevel(4, 4)).toBe('reached');
    expect(budgetLevel(5, 4)).toBe('exceeded');
  });

  it('rejects invalid limits', () => {
    expect(() => budgetLevel(0, 0)).toThrow();
    expect(() => budgetLevel(0, -1)).toThrow();
    expect(() => budgetLevel(-1, 100)).toThrow();
  });
});

describe('budgetRemaining', () => {
  it('is negative when over budget, not clamped', () => {
    expect(budgetRemaining(10000, 30000)).toBe(20000);
    expect(budgetRemaining(32800, 30000)).toBe(-2800);
  });
});

describe('describeBudgetUsage', () => {
  it('exposes exceeded amount separately', () => {
    const view = describeBudgetUsage(32800, 30000);
    expect(view.level).toBe('exceeded');
    expect(view.remaining).toBe(-2800);
    expect(view.exceededBy).toBe(2800);
  });
});
