import { describe, expect, it } from 'vitest';
import {
  addDays,
  compareAcquisitionDates,
  DateError,
  dayDate,
  dayWithin,
  isValidCalendarDay,
  isValidYearMonth,
  monthDate,
  monthRange,
  occursInMonth,
  occursInYear,
  toLocalCalendarDay,
  unknownDate,
  weekRange,
} from './date.js';

describe('calendar validation', () => {
  it('accepts real dates including leap day', () => {
    expect(isValidCalendarDay('2024-02-29')).toBe(true);
    expect(isValidCalendarDay('2026-11-12')).toBe(true);
    expect(isValidCalendarDay('2000-02-29')).toBe(true);
  });

  it('rejects impossible dates and formats', () => {
    expect(isValidCalendarDay('2023-02-29')).toBe(false);
    expect(isValidCalendarDay('2024-02-30')).toBe(false);
    expect(isValidCalendarDay('2024-13-01')).toBe(false);
    expect(isValidCalendarDay('2024-1-1')).toBe(false);
    expect(isValidCalendarDay('1899-01-01')).toBe(false);
  });

  it('validates year-month', () => {
    expect(isValidYearMonth('2024-12')).toBe(true);
    expect(isValidYearMonth('2024-13')).toBe(false);
    expect(isValidYearMonth('2024-1')).toBe(false);
  });
});

describe('date precision', () => {
  const day = dayDate('2026-03-15');
  const month = monthDate('2026-03');
  const unknown = unknownDate();

  it('day precision participates everywhere', () => {
    expect(occursInMonth(day, '2026-03')).toBe(true);
    expect(occursInYear(day, 2026)).toBe(true);
    expect(dayWithin(day, '2026-03-01', '2026-03-31')).toBe(true);
  });

  it('month precision only reaches month/year', () => {
    expect(occursInMonth(month, '2026-03')).toBe(true);
    expect(occursInYear(month, 2026)).toBe(true);
    expect(dayWithin(month, '2026-03-01', '2026-03-31')).toBe(false);
  });

  it('unknown precision is excluded from month/year', () => {
    expect(occursInMonth(unknown, '2026-03')).toBe(false);
    expect(occursInYear(unknown, 2026)).toBe(false);
  });

  it('throws on invalid construction', () => {
    expect(() => dayDate('2026-02-30')).toThrow(DateError);
    expect(() => monthDate('2026-00')).toThrow(DateError);
  });
});

describe('ranges', () => {
  it('week starts on Monday and crosses year', () => {
    expect(weekRange('2026-01-01')).toEqual({ start: '2025-12-29', end: '2026-01-04' });
    expect(weekRange('2024-12-31')).toEqual({ start: '2024-12-30', end: '2025-01-05' });
    expect(weekRange('2026-11-12')).toEqual({ start: '2026-11-09', end: '2026-11-15' });
  });

  it('month range handles leap year', () => {
    expect(monthRange('2024-02')).toEqual({ start: '2024-02-01', end: '2024-02-29' });
    expect(monthRange('2026-02')).toEqual({ start: '2026-02-01', end: '2026-02-28' });
  });

  it('adds days across boundaries', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2024-02-28', 1)).toBe('2024-02-29');
  });
});

describe('local today', () => {
  it('uses local calendar fields, not UTC', () => {
    expect(toLocalCalendarDay(new Date(2026, 0, 5, 23, 30))).toBe('2026-01-05');
  });
});

describe('acquisition date ordering', () => {
  it('orders day < month < unknown, with same-month tie', () => {
    const earlyDay = dayDate('2026-03-02');
    const laterDay = dayDate('2026-03-20');
    const month = monthDate('2026-03');
    const nextMonth = monthDate('2026-04');
    const unknown = unknownDate();

    expect(compareAcquisitionDates(earlyDay, laterDay)).toBe(-1);
    expect(compareAcquisitionDates(laterDay, earlyDay)).toBe(1);
    expect(compareAcquisitionDates(earlyDay, month)).toBe(0);
    expect(compareAcquisitionDates(month, earlyDay)).toBe(0);
    expect(compareAcquisitionDates(month, nextMonth)).toBe(-1);
    expect(compareAcquisitionDates(unknown, laterDay)).toBe(1);
    expect(compareAcquisitionDates(laterDay, unknown)).toBe(-1);
  });
});
