import { describe, expect, it } from 'vitest';
import { allocateOrder, orderAllocationGap, orderDefaultTotal, orderWeights } from './order.js';

const lineA = { styleId: 'a', quantity: 2, unitCents: 6900 };
const lineB = { styleId: 'b', quantity: 1, unitCents: 13800 };

describe('orderWeights', () => {
  it('multiplies unit price by quantity', () => {
    expect(orderWeights([lineA, lineB])).toEqual([13800, 13800]);
  });

  it('returns null when any line lacks a reference price', () => {
    expect(orderWeights([lineA, { styleId: 'c', quantity: 1, unitCents: null }])).toBeNull();
  });
});

describe('orderDefaultTotal', () => {
  it('sums reference price × quantity', () => {
    expect(orderDefaultTotal([lineA, lineB])).toBe(27600);
  });

  it('does not invent a total with incomplete prices', () => {
    expect(orderDefaultTotal([lineA, { styleId: 'c', quantity: 1, unitCents: null }])).toBeNull();
  });
});

describe('allocateOrder', () => {
  it('T01: ¥69×2 and ¥138×1 with ¥240 paid → ¥120 each', () => {
    expect(allocateOrder(24000, [lineA, lineB])).toEqual([12000, 12000]);
  });

  it('T02: tail cent goes to the first line on a tie', () => {
    expect(allocateOrder(1, [
      { styleId: 'a', quantity: 1, unitCents: 100 },
      { styleId: 'b', quantity: 1, unitCents: 100 },
      { styleId: 'c', quantity: 1, unitCents: 100 },
    ])).toEqual([1, 0, 0]);
  });

  it('returns null when weights are incomplete', () => {
    expect(allocateOrder(1000, [{ styleId: 'a', quantity: 1, unitCents: null }])).toBeNull();
  });
});

describe('orderAllocationGap', () => {
  it('reports zero for a complete allocation', () => {
    expect(orderAllocationGap(24000, [12000, 12000])).toBe(0);
  });

  it('reports the remaining gap', () => {
    expect(orderAllocationGap(24000, [12000, 11000])).toBe(1000);
  });
});
