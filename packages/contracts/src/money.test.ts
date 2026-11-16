import { describe, expect, it } from 'vitest';
import {
  AmountError,
  allocateByWeight,
  allocationGap,
  assertAllocationSumsTo,
  formatCents,
  formatCny,
  parseCents,
  sumCents,
} from './money.js';

describe('parseCents', () => {
  it('parses whole yuan and one/two decimals', () => {
    expect(parseCents('69')).toBe(6900);
    expect(parseCents('69.5')).toBe(6950);
    expect(parseCents('69.50')).toBe(6950);
    expect(parseCents('0.01')).toBe(1);
    expect(parseCents('0')).toBe(0);
    expect(parseCents(' 128 ')).toBe(12800);
  });

  it('rejects malformed input instead of guessing', () => {
    for (const input of ['', ' ', '-1', '+1', '1e3', '1.234', '1,000', '.5', '69.', 'abc']) {
      expect(() => parseCents(input), input).toThrow(AmountError);
    }
  });

  it('rejects values beyond safe integer', () => {
    expect(() => parseCents('99999999999999999')).toThrow(AmountError);
  });
});

describe('format', () => {
  it('formats cents with two decimals', () => {
    expect(formatCents(6900)).toBe('69.00');
    expect(formatCents(1)).toBe('0.01');
    expect(formatCents(0)).toBe('0.00');
    expect(formatCny(6900)).toBe('¥69.00');
  });
});

describe('allocateByWeight', () => {
  it('T01: ¥69×2 vs ¥138×1, total ¥240 → ¥120 each', () => {
    const allocations = allocateByWeight(24000, [6900 * 2, 13800]);
    expect(allocations).toEqual([12000, 12000]);
    expect(sumCents(allocations)).toBe(24000);
  });

  it('T02: three equal weights, total ¥0.01 → 1, 0, 0', () => {
    expect(allocateByWeight(1, [100, 100, 100])).toEqual([1, 0, 0]);
  });

  it('breaks ties by stable index order', () => {
    expect(allocateByWeight(2, [1, 1, 1])).toEqual([1, 1, 0]);
  });

  it('returns zeros when total is zero', () => {
    expect(allocateByWeight(0, [6900, 13800])).toEqual([0, 0]);
  });

  it('allows explicit zero weight to receive zero', () => {
    const allocations = allocateByWeight(1000, [1000, 0]);
    expect(allocations).toEqual([1000, 0]);
  });

  it('refuses to allocate when all weights are zero', () => {
    expect(() => allocateByWeight(1000, [0, 0])).toThrow(AmountError);
  });

  it('refuses empty weights with non-zero total', () => {
    expect(() => allocateByWeight(100, [])).toThrow(AmountError);
    expect(allocateByWeight(0, [])).toEqual([]);
  });

  it('keeps the sum invariant on random orders', () => {
    let seed = 42;
    const random = () => {
      seed = (seed * 1103515245 + 12345) % 2 ** 31;
      return seed / 2 ** 31;
    };
    for (let round = 0; round < 200; round += 1) {
      const count = 1 + Math.floor(random() * 8);
      const weights = Array.from({ length: count }, () => Math.floor(random() * 20000));
      const total = Math.floor(random() * 100000);
      const allocations = allocateByWeight(total, weights);
      expect(sumCents(allocations)).toBe(total);
      expect(allocations.every((value) => Number.isSafeInteger(value) && value >= 0)).toBe(true);
    }
  });
});

describe('allocation checks', () => {
  it('detects mismatch', () => {
    expect(() => assertAllocationSumsTo(24000, [12000, 11000])).toThrow(AmountError);
    expect(() => assertAllocationSumsTo(24000, [12000, 12000])).not.toThrow();
  });

  it('reports remaining gap, negative when over', () => {
    expect(allocationGap(1000, [600, 300])).toBe(100);
    expect(allocationGap(1000, [600, 500])).toBe(-100);
  });
});
