import {
  addDays,
  weekRange,
  type AcquisitionDate,
  type CalendarDay,
  type YearMonth,
} from '@my-popmart/contracts';

export type PeriodKind = 'week' | 'month' | 'year';

export interface PeriodFilter {
  readonly kind: PeriodKind;
  /** 当前选中的“单位”：周=某一天，月=某个月（取当月 1 日），年=某年（取 1 月 1 日）。 */
  readonly anchor: CalendarDay;
}

export interface LedgerRecord {
  readonly lineId: string;
  readonly acquisitionId: string;
  readonly styleId: string;
  readonly ipId: string;
  readonly ipName: string;
  readonly styleName: string;
  readonly seriesName: string;
  readonly imageUrl: string | null;
  readonly imageAssetId: string | null;
  readonly date: AcquisitionDate;
  readonly source: string;
  readonly channel: string | null;
  readonly note: string | null;
  readonly quantity: number;
  readonly statsQty: number;
  readonly statsCents: number;
}

export interface LedgerBucket {
  readonly key: string;
  readonly label: string;
  readonly cents: number;
  readonly qty: number;
}

export interface PeriodAggregate {
  readonly buckets: readonly LedgerBucket[];
  readonly unassignedCents: number;
  readonly unassignedQty: number;
  readonly totalCents: number;
  readonly totalQty: number;
}

export function firstBoundary(records: readonly LedgerRecord[]): CalendarDay | null {
  let first: string | null = null;
  for (const record of records) {
    if (record.date.precision === 'unknown') continue;
    const day = record.date.precision === 'day' ? record.date.day : `${record.date.month}-01`;
    if (first === null || day < first) first = day;
  }
  return first;
}

export function firstRecordYear(records: readonly LedgerRecord[]): number | null {
  let first: number | null = null;
  for (const record of records) {
    if (record.date.precision === 'unknown') continue;
    const year = Number(record.date.month.slice(0, 4));
    if (first === null || year < first) first = year;
  }
  return first;
}

function currentYear(today: CalendarDay): number {
  return Number(today.slice(0, 4));
}

export function bucketDefinitions(
  filter: PeriodFilter,
  today: CalendarDay,
  firstYear: number | null,
): Array<{ key: string; label: string }> {
  if (filter.kind === 'week') {
    const { start, end } = weekRange(filter.anchor);
    if (today < start) return [];
    const last = today <= end ? today : end;
    const buckets: Array<{ key: string; label: string }> = [];
    for (let day = start; day <= last; day = addDays(day, 1)) {
      buckets.push({
        key: day,
        label: `${Number(day.slice(5, 7))}/${Number(day.slice(8, 10))}`,
      });
    }
    return buckets;
  }

  if (filter.kind === 'month') {
    const year = filter.anchor.slice(0, 4);
    const curYear = String(currentYear(today));
    if (year > curYear) return [];
    const currentMonth = Number(today.slice(5, 7));
    const lastMonth = year === curYear ? currentMonth : 12;
    return Array.from({ length: lastMonth }, (_, index) => {
      const month = `${year}-${String(index + 1).padStart(2, '0')}`;
      return { key: month, label: `${index + 1}月` };
    });
  }

  const startYear = firstYear ?? currentYear(today);
  const endYear = currentYear(today);
  return Array.from({ length: endYear - startYear + 1 }, (_, index) => {
    const year = startYear + index;
    return { key: String(year), label: `${year}年` };
  });
}

function bucketKeyFor(date: AcquisitionDate, kind: PeriodKind): string | null {
  if (date.precision === 'day') {
    if (kind === 'week') return date.day;
    if (kind === 'month') return date.month;
    return date.month.slice(0, 4);
  }
  if (date.precision === 'month') {
    if (kind === 'week') return null;
    if (kind === 'month') return date.month;
    return date.month.slice(0, 4);
  }
  return null;
}

export function aggregatePeriod(
  records: readonly LedgerRecord[],
  filter: PeriodFilter,
  today: CalendarDay,
  firstYear: number | null,
): PeriodAggregate {
  const definitions = bucketDefinitions(filter, today, firstYear);
  const totals = new Map<string, { cents: number; qty: number }>(
    definitions.map((definition) => [definition.key, { cents: 0, qty: 0 }]),
  );

  for (const record of records) {
    if (record.statsCents === 0 && record.statsQty === 0) continue;
    const key = bucketKeyFor(record.date, filter.kind);
    if (key === null) continue;
    const bucket = totals.get(key);
    if (!bucket) continue;
    bucket.cents += record.statsCents;
    bucket.qty += record.statsQty;
  }

  const buckets = definitions.map((definition) => {
    const value = totals.get(definition.key) ?? { cents: 0, qty: 0 };
    return { key: definition.key, label: definition.label, cents: value.cents, qty: value.qty };
  });

  const totalCents = buckets.reduce((total, bucket) => total + bucket.cents, 0);
  const totalQty = buckets.reduce((total, bucket) => total + bucket.qty, 0);

  return { buckets, unassignedCents: 0, unassignedQty: 0, totalCents, totalQty };
}

export function cumulative(records: readonly LedgerRecord[]): { cents: number; qty: number } {
  let cents = 0;
  let qty = 0;
  for (const record of records) {
    cents += record.statsCents;
    qty += record.statsQty;
  }
  return { cents, qty };
}

export function recordsByIp(
  records: readonly LedgerRecord[],
  ipId: string | 'all',
): readonly LedgerRecord[] {
  return ipId === 'all' ? records : records.filter((record) => record.ipId === ipId);
}

export function periodRange(
  filter: PeriodFilter,
  today: CalendarDay,
  firstYear: number | null,
): { start: CalendarDay; end: CalendarDay } {
  if (filter.kind === 'week') {
    const { start, end } = weekRange(filter.anchor);
    const last = today <= end ? today : end;
    return { start, end: last < start ? start : last };
  }
  const year = filter.kind === 'month' ? filter.anchor.slice(0, 4) : String(firstYear ?? currentYear(today));
  const endYear = filter.kind === 'month' ? year : String(currentYear(today));
  return { start: `${year}-01-01`, end: `${endYear}-12-31` };
}

function shiftMonth(month: YearMonth, delta: number): YearMonth {
  const [yearText, monthText] = month.split('-');
  const date = new Date(Date.UTC(Number(yearText), Number(monthText) - 1 + delta, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

export function shiftPeriod(filter: PeriodFilter, delta: number): PeriodFilter {
  if (filter.kind === 'week') {
    return { kind: 'week', anchor: addDays(filter.anchor, delta) };
  }
  if (filter.kind === 'month') {
    const month = shiftMonth(filter.anchor.slice(0, 7), delta);
    return { kind: 'month', anchor: `${month}-01` };
  }
  const year = Number(filter.anchor.slice(0, 4)) + delta;
  return { kind: 'year', anchor: `${year}-01-01` };
}

export function periodLabel(filter: PeriodFilter): string {
  const [year, month, day] = filter.anchor.split('-');
  const y = Number(year);
  const m = Number(month);
  const d = Number(day);
  if (filter.kind === 'week') return `${y}年${m}月${d}日`;
  if (filter.kind === 'month') return `${y}年${m}月`;
  return `${y}年`;
}

export function anchorToKey(kind: PeriodKind, anchor: CalendarDay): string {
  if (kind === 'week') return anchor;
  if (kind === 'month') return anchor.slice(0, 7);
  return anchor.slice(0, 4);
}

export function keyToAnchor(kind: PeriodKind, key: string): CalendarDay {
  if (kind === 'week') return key;
  if (kind === 'month') return `${key}-01`;
  return `${key}-01-01`;
}

export function defaultBucketKey(filter: PeriodFilter, _today: CalendarDay): string {
  return anchorToKey(filter.kind, filter.anchor);
}

export function canShiftForward(filter: PeriodFilter, today: CalendarDay): boolean {
  if (filter.kind === 'week') return filter.anchor < today;
  if (filter.kind === 'month') return filter.anchor.slice(0, 7) < today.slice(0, 7);
  return filter.anchor.slice(0, 4) < String(currentYear(today));
}

export function canShiftBackward(filter: PeriodFilter, firstBoundaryDay: CalendarDay | null): boolean {
  if (firstBoundaryDay === null) return false;
  if (filter.kind === 'week') return filter.anchor > firstBoundaryDay;
  if (filter.kind === 'month') return filter.anchor.slice(0, 7) > firstBoundaryDay.slice(0, 7);
  return filter.anchor.slice(0, 4) > firstBoundaryDay.slice(0, 4);
}

export interface LedgerEntryGroup {
  readonly dateKey: string;
  readonly label: string;
  readonly records: readonly LedgerRecord[];
  readonly cents: number;
  readonly qty: number;
}

export function groupEntries(records: readonly LedgerRecord[]): LedgerEntryGroup[] {
  const groups = new Map<string, LedgerRecord[]>();
  for (const record of records) {
    const key =
      record.date.precision === 'day'
        ? record.date.day
        : record.date.precision === 'month'
          ? record.date.month
          : 'unknown';
    const bucket = groups.get(key);
    if (bucket) bucket.push(record);
    else groups.set(key, [record]);
  }

  return [...groups.entries()]
    .map(([dateKey, items]) => ({
      dateKey,
      label: dateKey === 'unknown' ? '日期不详' : dateKey,
      records: items,
      cents: items.reduce((total, item) => total + item.statsCents, 0),
      qty: items.reduce((total, item) => total + item.statsQty, 0),
    }))
    .sort((left, right) => {
      if (left.dateKey === 'unknown') return 1;
      if (right.dateKey === 'unknown') return -1;
      return right.dateKey.localeCompare(left.dateKey);
    });
}

export function filterRecordsInPeriod(
  records: readonly LedgerRecord[],
  filter: PeriodFilter,
  today: CalendarDay,
  firstYear: number | null,
): readonly LedgerRecord[] {
  const range = periodRange(filter, today, firstYear);
  return records.filter((record) => {
    if (record.date.precision === 'day') {
      return record.date.day >= range.start && record.date.day <= range.end;
    }
    if (record.date.precision === 'month') {
      if (filter.kind === 'week') return false;
      const year = record.date.month.slice(0, 4);
      return year >= range.start.slice(0, 4) && year <= range.end.slice(0, 4);
    }
    return false;
  });
}
