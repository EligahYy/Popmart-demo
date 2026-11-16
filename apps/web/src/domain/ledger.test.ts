import { describe, expect, it } from 'vitest';
import { dayDate, monthDate, unknownDate } from '@my-popmart/contracts';
import {
  aggregatePeriod,
  canShiftBackward,
  canShiftForward,
  cumulative,
  defaultBucketKey,
  firstBoundary,
  firstRecordYear,
  groupEntries,
  periodLabel,
  periodRange,
  recordsByIp,
  shiftPeriod,
  type LedgerRecord,
} from './ledger.js';

function record(overrides: Partial<LedgerRecord> = {}): LedgerRecord {
  return {
    lineId: crypto.randomUUID(),
    acquisitionId: 'order',
    styleId: 'style',
    ipId: 'ip-twinkle',
    ipName: 'Twinkle Twinkle',
    styleName: 'Stay Curious',
    seriesName: 'Live the Ordinary',
    imageUrl: null,
    imageAssetId: null,
    date: dayDate('2026-11-12'),
    source: 'official',
    channel: null,
    note: null,
    quantity: 1,
    statsQty: 1,
    statsCents: 6900,
    ...overrides,
  };
}

const TODAY = '2026-11-12'; // 周四
const MONDAY = '2026-11-09';

describe('firstRecordYear', () => {
  it('returns the earliest year with a dated record', () => {
    const records = [
      record({ date: dayDate('2024-01-01') }),
      record({ date: monthDate('2023-06') }),
      record({ date: unknownDate() }),
    ];
    expect(firstRecordYear(records)).toBe(2023);
  });

  it('returns null when only unknown dates exist', () => {
    expect(firstRecordYear([record({ date: unknownDate() })])).toBeNull();
  });
});

describe('period ranges', () => {
  it('week adapts to today (周一仅一天)', () => {
    expect(periodRange({ kind: 'week', anchor: TODAY }, TODAY, null)).toEqual({
      start: '2026-11-09',
      end: '2026-11-12',
    });
    expect(periodRange({ kind: 'week', anchor: MONDAY }, MONDAY, null)).toEqual({
      start: '2026-11-09',
      end: '2026-11-09',
    });
  });

  it('month is a whole year, year spans firstYear..currentYear', () => {
    expect(periodRange({ kind: 'month', anchor: TODAY }, TODAY, null)).toEqual({
      start: '2026-01-01',
      end: '2026-12-31',
    });
    expect(periodRange({ kind: 'year', anchor: TODAY }, TODAY, 2024)).toEqual({
      start: '2024-01-01',
      end: '2026-12-31',
    });
  });

  it('shifts one unit per step (day/month/year)', () => {
    expect(shiftPeriod({ kind: 'month', anchor: '2026-01-15' }, -1)).toEqual({
      kind: 'month',
      anchor: '2025-12-01',
    });
    expect(shiftPeriod({ kind: 'week', anchor: '2025-12-29' }, 1)).toEqual({
      kind: 'week',
      anchor: '2025-12-30',
    });
    expect(shiftPeriod({ kind: 'year', anchor: '2026-11-12' }, -1)).toEqual({
      kind: 'year',
      anchor: '2025-01-01',
    });
  });

  it('labels the selected unit', () => {
    expect(periodLabel({ kind: 'month', anchor: TODAY })).toBe('2026年11月');
    expect(periodLabel({ kind: 'year', anchor: TODAY })).toBe('2026年');
    expect(periodLabel({ kind: 'week', anchor: TODAY })).toBe('2026年11月12日');
  });

  it('canShiftForward only before the current week/month', () => {
    expect(canShiftForward({ kind: 'week', anchor: TODAY }, TODAY)).toBe(false);
    expect(canShiftForward({ kind: 'week', anchor: '2026-11-02' }, TODAY)).toBe(true);
    expect(canShiftForward({ kind: 'month', anchor: TODAY }, TODAY)).toBe(false);
    expect(canShiftForward({ kind: 'month', anchor: '2025-01-01' }, TODAY)).toBe(true);
    expect(canShiftForward({ kind: 'year', anchor: TODAY }, TODAY)).toBe(false);
  });
});

describe('aggregatePeriod', () => {
  it('week shows only elapsed days up to today and ignores month/unknown', () => {
    const records = [
      record({ date: dayDate('2026-11-12'), statsCents: 6900 }),
      record({ date: monthDate('2026-11'), statsCents: 9900 }),
      record({ date: unknownDate(), statsCents: 5000 }),
    ];
    const result = aggregatePeriod(records, { kind: 'week', anchor: TODAY }, TODAY, null);
    expect(result.buckets.map((bucket) => bucket.key)).toEqual([
      '2026-11-09',
      '2026-11-10',
      '2026-11-11',
      '2026-11-12',
    ]);
    expect(result.totalCents).toBe(6900);
    expect(result.totalQty).toBe(1);
  });

  it('month aggregates by year-month across day and month precision', () => {
    const records = [
      record({ date: dayDate('2026-11-05'), statsCents: 6900 }),
      record({ date: monthDate('2026-11'), statsCents: 9900, statsQty: 1 }),
    ];
    const result = aggregatePeriod(records, { kind: 'month', anchor: TODAY }, TODAY, null);
    expect(result.buckets).toHaveLength(11);
    const november = result.buckets.find((bucket) => bucket.key === '2026-11');
    expect(november?.cents).toBe(16800);
    expect(november?.qty).toBe(2);
    expect(result.totalCents).toBe(16800);
  });

  it('early year month view only shows elapsed natural months', () => {
    const earlyToday = '2026-02-15';
    const result = aggregatePeriod(
      [record({ date: dayDate('2026-02-15'), statsCents: 6900 })],
      { kind: 'month', anchor: earlyToday },
      earlyToday,
      null,
    );
    expect(result.buckets.map((bucket) => bucket.key)).toEqual(['2026-01', '2026-02']);
  });

  it('year view spans first record year to current year', () => {
    const records = [
      record({ date: monthDate('2024-03'), statsCents: 6900 }),
      record({ date: dayDate('2026-08-09'), statsCents: 9900 }),
    ];
    const result = aggregatePeriod(records, { kind: 'year', anchor: TODAY }, TODAY, 2024);
    expect(result.buckets.map((bucket) => bucket.key)).toEqual(['2024', '2025', '2026']);
    expect(result.buckets[0]?.cents).toBe(6900);
    expect(result.buckets[2]?.cents).toBe(9900);
    expect(result.totalCents).toBe(16800);
  });

  it('unknown dates never enter a period', () => {
    const result = aggregatePeriod(
      [record({ date: unknownDate(), statsCents: 5900 })],
      { kind: 'month', anchor: TODAY },
      TODAY,
      null,
    );
    expect(result.totalCents).toBe(0);
    expect(result.totalQty).toBe(0);
  });
});

describe('firstBoundary / canShiftBackward', () => {
  it('firstBoundary returns the earliest day or month', () => {
    const records = [
      record({ date: dayDate('2026-08-09') }),
      record({ date: monthDate('2026-03') }),
      record({ date: unknownDate() }),
    ];
    expect(firstBoundary(records)).toBe('2026-03-01');
  });

  it('canShiftBackward stops at the first boundary', () => {
    const boundary = '2026-03-01';
    expect(canShiftBackward({ kind: 'month', anchor: '2026-04-01' }, boundary)).toBe(true);
    expect(canShiftBackward({ kind: 'month', anchor: '2026-03-01' }, boundary)).toBe(false);
    expect(canShiftBackward({ kind: 'month', anchor: '2026-02-01' }, boundary)).toBe(false);
    expect(canShiftBackward({ kind: 'year', anchor: '2027-01-01' }, boundary)).toBe(true);
    expect(canShiftBackward({ kind: 'week', anchor: '2026-03-02' }, boundary)).toBe(true);
    expect(canShiftBackward({ kind: 'week', anchor: '2026-03-01' }, boundary)).toBe(false);
  });
});

describe('defaultBucketKey', () => {
  it('defaults to today / current month / current year', () => {
    expect(defaultBucketKey({ kind: 'week', anchor: TODAY }, TODAY)).toBe(TODAY);
    expect(defaultBucketKey({ kind: 'month', anchor: TODAY }, TODAY)).toBe('2026-11');
    expect(defaultBucketKey({ kind: 'year', anchor: TODAY }, TODAY)).toBe('2026');
  });
});

describe('cumulative', () => {
  it('includes unknown dates', () => {
    const records = [
      record({ date: dayDate('2024-01-01'), statsCents: 6900 }),
      record({ date: monthDate('2023-06'), statsCents: 9900 }),
      record({ date: unknownDate(), statsCents: 5000 }),
    ];
    expect(cumulative(records)).toEqual({ cents: 21800, qty: 3 });
  });
});

describe('IP filtering', () => {
  it('keeps only matching IPs', () => {
    const records = [record({ ipId: 'ip-a' }), record({ ipId: 'ip-b' })];
    expect(recordsByIp(records, 'ip-a')).toHaveLength(1);
    expect(recordsByIp(records, 'all')).toHaveLength(2);
  });
});

describe('groupEntries', () => {
  it('groups by day, month and unknown, newest first with unknown last', () => {
    const records = [
      record({ date: dayDate('2026-11-12') }),
      record({ date: dayDate('2026-11-12') }),
      record({ date: monthDate('2026-10') }),
      record({ date: unknownDate() }),
    ];
    const groups = groupEntries(records);
    expect(groups.map((group) => group.dateKey)).toEqual(['2026-11-12', '2026-10', 'unknown']);
    expect(groups[0]?.records).toHaveLength(2);
    expect(groups[0]?.cents).toBe(13800);
    expect(groups[2]?.label).toBe('日期不详');
  });
});
