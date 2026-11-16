/**
 * 业务日期只用本地日历字符串，不用 UTC 时间戳代替购买日期。
 * 精度三分：精确到日 / 仅月份 / 日期不详。
 */

export type CalendarDay = string; // YYYY-MM-DD
export type YearMonth = string; // YYYY-MM

export type AcquisitionDate =
  | { readonly precision: 'day'; readonly day: CalendarDay; readonly month: YearMonth }
  | { readonly precision: 'month'; readonly month: YearMonth }
  | { readonly precision: 'unknown' };

export type DateErrorCode = 'INVALID_DAY' | 'INVALID_MONTH' | 'INVALID_DATE';

export class DateError extends Error {
  override readonly name = 'DateError';
  constructor(
    readonly code: DateErrorCode,
    message: string,
  ) {
    super(message);
  }
}

const DAY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const MONTH_RE = /^(\d{4})-(\d{2})$/;

const MIN_YEAR = 1900;
const MAX_YEAR = 2999;

export function isValidCalendarDay(value: string): boolean {
  const matched = DAY_RE.exec(value);
  if (!matched) return false;
  const year = Number(matched[1]);
  const month = Number(matched[2]);
  const day = Number(matched[3]);
  if (year < MIN_YEAR || year > MAX_YEAR || month < 1 || month > 12 || day < 1) {
    return false;
  }
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

export function isValidYearMonth(value: string): boolean {
  const matched = MONTH_RE.exec(value);
  if (!matched) return false;
  const year = Number(matched[1]);
  const month = Number(matched[2]);
  return year >= MIN_YEAR && year <= MAX_YEAR && month >= 1 && month <= 12;
}

export function dayDate(day: CalendarDay): AcquisitionDate {
  if (!isValidCalendarDay(day)) {
    throw new DateError('INVALID_DAY', `不是有效日期：${day}`);
  }
  return { precision: 'day', day, month: day.slice(0, 7) };
}

export function monthDate(month: YearMonth): AcquisitionDate {
  if (!isValidYearMonth(month)) {
    throw new DateError('INVALID_MONTH', `不是有效年月：${month}`);
  }
  return { precision: 'month', month };
}

export function unknownDate(): AcquisitionDate {
  return { precision: 'unknown' };
}

/** 用户本地的今天，不能用 toISOString 截取。 */
export function toLocalCalendarDay(now: Date): CalendarDay {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function occursOnDay(date: AcquisitionDate, day: CalendarDay): boolean {
  return date.precision === 'day' && date.day === day;
}

export function occursInMonth(date: AcquisitionDate, month: YearMonth): boolean {
  if (date.precision === 'unknown') return false;
  return date.month === month;
}

export function occursInYear(date: AcquisitionDate, year: number): boolean {
  if (date.precision === 'unknown') return false;
  return Number(date.month.slice(0, 4)) === year;
}

export function isDayPrecision(date: AcquisitionDate): boolean {
  return date.precision === 'day';
}

export function isMonthOnly(date: AcquisitionDate): boolean {
  return date.precision === 'month';
}

export function isUnknownDate(date: AcquisitionDate): boolean {
  return date.precision === 'unknown';
}

function toUtcMillis(day: CalendarDay): number {
  const matched = DAY_RE.exec(day);
  if (!matched) throw new DateError('INVALID_DAY', `不是有效日期：${day}`);
  return Date.UTC(Number(matched[1]), Number(matched[2]) - 1, Number(matched[3]));
}

function fromUtcMillis(millis: number): CalendarDay {
  const date = new Date(millis);
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

const DAY_MILLIS = 24 * 60 * 60 * 1000;

export function addDays(day: CalendarDay, amount: number): CalendarDay {
  return fromUtcMillis(toUtcMillis(day) + amount * DAY_MILLIS);
}

/** 周一为一周起点，跨月／跨年按实际日期返回。 */
export function weekRange(day: CalendarDay): { start: CalendarDay; end: CalendarDay } {
  const date = new Date(toUtcMillis(day));
  const weekday = date.getUTCDay(); // 0 = Sunday
  const offsetFromMonday = (weekday + 6) % 7;
  const start = addDays(day, -offsetFromMonday);
  const end = addDays(start, 6);
  return { start, end };
}

export function monthRange(month: YearMonth): { start: CalendarDay; end: CalendarDay } {
  if (!isValidYearMonth(month)) {
    throw new DateError('INVALID_MONTH', `不是有效年月：${month}`);
  }
  const matched = MONTH_RE.exec(month);
  const year = Number(matched?.[1]);
  const monthNumber = Number(matched?.[2]);
  const lastDay = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  return {
    start: `${month}-01`,
    end: `${month}-${String(lastDay).padStart(2, '0')}`,
  };
}

/**
 * 转出批次排序键。精确日期按日、仅月份按月；同一月份内两者并列，
 * 由调用方用 createdAt 打破平局；日期不详排后。
 */
export function compareAcquisitionDates(left: AcquisitionDate, right: AcquisitionDate): number {
  if (left.precision === 'unknown' && right.precision === 'unknown') return 0;
  if (left.precision === 'unknown') return 1;
  if (right.precision === 'unknown') return -1;

  if (left.precision === 'day' && right.precision === 'day') {
    return left.day < right.day ? -1 : left.day > right.day ? 1 : 0;
  }
  if (left.precision === 'month' && right.precision === 'month') {
    return left.month < right.month ? -1 : left.month > right.month ? 1 : 0;
  }

  const leftMonth = left.precision === 'day' ? left.month : left.month;
  const rightMonth = right.precision === 'day' ? right.month : right.month;
  if (leftMonth === rightMonth) return 0;
  return leftMonth < rightMonth ? -1 : 1;
}

/** 日期是否落在 [start, end] 内（闭区间），仅精确到日的记录参与。 */
export function dayWithin(date: AcquisitionDate, start: CalendarDay, end: CalendarDay): boolean {
  return date.precision === 'day' && date.day >= start && date.day <= end;
}
