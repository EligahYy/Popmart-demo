import { describe, expect, it } from 'vitest';
import {
  buildLedgerIndex,
  checkLineInvariants,
  lineHeldQty,
  lineNetPaid,
  netBoughtQty,
  netSpend,
  styleHeldQtyMap,
  type AcquisitionLike,
  type AcquisitionLineLike,
} from './collection.js';

const order: AcquisitionLike = { id: 'o1', source: 'official', status: 'active' };
const lineA: AcquisitionLineLike = {
  id: 'lA',
  acquisitionId: 'o1',
  styleId: 'A',
  quantity: 2,
  allocatedCents: 12000,
  status: 'active',
};
const lineB: AcquisitionLineLike = {
  id: 'lB',
  acquisitionId: 'o1',
  styleId: 'B',
  quantity: 1,
  allocatedCents: 12000,
  status: 'active',
};

const acquisitionsById = new Map<string, AcquisitionLike>([[order.id, order]]);
const lines = [lineA, lineB];

describe('line math', () => {
  it('derives held and net paid from refunds and transfers', () => {
    const index = buildLedgerIndex(
      [
        {
          acquisitionLineId: 'lA',
          refundCents: 2000,
          returnedQuantity: 0,
          status: 'active',
        },
      ],
      [],
    );
    expect(lineHeldQty(lineA, index)).toBe(2);
    expect(lineNetPaid(lineA, index)).toBe(10000);
  });

  it('ignores deleted refund lines', () => {
    const index = buildLedgerIndex(
      [{ acquisitionLineId: 'lA', refundCents: 2000, returnedQuantity: 0, status: 'deleted' }],
      [],
    );
    expect(lineNetPaid(lineA, index)).toBe(12000);
  });
});

describe('T03–T05 scenario', () => {
  it('T03: refund difference on last month order', () => {
    const index = buildLedgerIndex(
      [{ acquisitionLineId: 'lA', refundCents: 2000, returnedQuantity: 0, status: 'active' }],
      [],
    );
    const query = { acquisitionsById, lines, index };
    expect(netSpend(query)).toBe(22000);
    expect(netBoughtQty(query)).toBe(3);
  });

  it('T04: return one unit and refund', () => {
    const index = buildLedgerIndex(
      [
        { acquisitionLineId: 'lA', refundCents: 2000, returnedQuantity: 0, status: 'active' },
        { acquisitionLineId: 'lA', refundCents: 5000, returnedQuantity: 1, status: 'active' },
      ],
      [],
    );
    const query = { acquisitionsById, lines, index };
    expect(netSpend(query)).toBe(17000);
    expect(netBoughtQty(query)).toBe(2);
    expect(styleHeldQtyMap(query).get('A')).toBe(1);
  });

  it('T05: give away the remaining unit keeps history', () => {
    const index = buildLedgerIndex(
      [
        { acquisitionLineId: 'lA', refundCents: 2000, returnedQuantity: 0, status: 'active' },
        { acquisitionLineId: 'lA', refundCents: 5000, returnedQuantity: 1, status: 'active' },
      ],
      [{ acquisitionLineId: 'lA', quantity: 1, status: 'active' }],
    );
    const query = { acquisitionsById, lines, index };
    expect(styleHeldQtyMap(query).get('A')).toBe(0);
    expect(netBoughtQty(query)).toBe(2);
    expect(netSpend(query)).toBe(17000);
  });
});

describe('gift and deleted records', () => {
  it('gift adds held stock but not spend or bought quantity', () => {
    const giftOrder: AcquisitionLike = { id: 'g1', source: 'gift', status: 'active' };
    const giftLine: AcquisitionLineLike = {
      id: 'lg',
      acquisitionId: 'g1',
      styleId: 'C',
      quantity: 1,
      allocatedCents: null,
      status: 'active',
    };
    const query = {
      acquisitionsById: new Map([...acquisitionsById, [giftOrder.id, giftOrder]]),
      lines: [...lines, giftLine],
      index: buildLedgerIndex([], []),
    };
    expect(netSpend(query)).toBe(24000);
    expect(netBoughtQty(query)).toBe(3);
    expect(styleHeldQtyMap(query).get('C')).toBe(1);
    expect(lineNetPaid(giftLine, query.index)).toBe(0);
  });

  it('deleted acquisition is fully excluded', () => {
    const deleted: AcquisitionLike = { ...order, status: 'deleted' };
    const query = {
      acquisitionsById: new Map([[deleted.id, deleted]]),
      lines,
      index: buildLedgerIndex([], []),
    };
    expect(netSpend(query)).toBe(0);
    expect(netBoughtQty(query)).toBe(0);
    expect(styleHeldQtyMap(query).size).toBe(0);
  });
});

describe('invariants', () => {
  it('flags refund above allocation', () => {
    const index = buildLedgerIndex(
      [{ acquisitionLineId: 'lA', refundCents: 13000, returnedQuantity: 0, status: 'active' }],
      [],
    );
    const codes = checkLineInvariants(lineA, index).map((violation) => violation.code);
    expect(codes).toContain('REFUND_EXCEEDS_ALLOCATION');
    expect(codes).toContain('NEGATIVE_NET_PAID');
  });

  it('flags transfer beyond held quantity', () => {
    const index = buildLedgerIndex([], [{ acquisitionLineId: 'lA', quantity: 3, status: 'active' }]);
    const codes = checkLineInvariants(lineA, index).map((violation) => violation.code);
    expect(codes).toContain('TRANSFER_EXCEEDS_HELD');
    expect(codes).toContain('NEGATIVE_HELD');
  });

  it('passes for a valid record', () => {
    expect(checkLineInvariants(lineA, buildLedgerIndex([], []))).toEqual([]);
  });
});
