import { useState } from 'react';
import { Sheet } from '../../components/Sheet.js';
import { anchorToKey, keyToAnchor, type PeriodFilter } from '../../domain/ledger.js';

function choices(first: number, last: number) {
  return Array.from({ length: last - first + 1 }, (_, i) => first + i);
}

export function PeriodPicker({ filter, first, today, onPick, onClose }: {
  filter: PeriodFilter;
  first: string;
  today: string;
  onPick: (filter: PeriodFilter) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState(filter.anchor < first ? first : filter.anchor > today ? today : filter.anchor);
  const [firstYear, firstMonth, firstDay] = first.split('-').map(Number) as [number, number, number];
  const [lastYear, lastMonth, lastDay] = today.split('-').map(Number) as [number, number, number];
  const [year, draftMonth, draftDay] = draft.split('-').map(Number) as [number, number, number];
  const months = choices(year === firstYear ? firstMonth : 1, year === lastYear ? lastMonth : 12);
  const month = Math.max(months[0]!, Math.min(draftMonth, months[months.length - 1]!));
  const days = choices(year === firstYear && month === firstMonth ? firstDay : 1,
    year === lastYear && month === lastMonth ? lastDay : new Date(year, month, 0).getDate());
  const day = Math.max(days[0]!, Math.min(draftDay, days[days.length - 1]!));
  const date = (y: number, m: number, d: number) =>
    [String(y).padStart(4, '0'), String(m).padStart(2, '0'), String(d).padStart(2, '0')].join('-');
  const pick = (value: string) => onPick({ kind: filter.kind, anchor: keyToAnchor(filter.kind, anchorToKey(filter.kind, value)) });

  return (
    <Sheet title="快捷选择时段" onClose={onClose}>
      <div className="stack">
        <div className="period-picker__fields">
          <label className="field">
            <span className="field__label">年份</span>
            <select className="field__input" value={year} onChange={e => setDraft(date(Number(e.target.value), month, day))}>
              {choices(firstYear, lastYear).reverse().map(y => <option key={y} value={y}>{y}年</option>)}
            </select>
          </label>
          {filter.kind !== 'year' && <label className="field">
            <span className="field__label">月份</span>
            <select className="field__input" value={month} onChange={e => setDraft(date(year, Number(e.target.value), day))}>
              {months.map(m => <option key={m} value={m}>{m}月</option>)}
            </select>
          </label>}
          {filter.kind === 'week' && <label className="field">
            <span className="field__label">周内日期</span>
            <select className="field__input" value={day} onChange={e => setDraft(date(year, month, Number(e.target.value)))}>
              {days.map(d => <option key={d} value={d}>{d}日</option>)}
            </select>
          </label>}
        </div>
        <button type="button" className="button" onClick={() => pick(date(year, month, day))}>查看统计</button>
        <button type="button" className="link-button" onClick={() => pick(today)}>
          {filter.kind === 'week' ? '回到本周' : filter.kind === 'month' ? '回到本月' : '回到今年'}
        </button>
      </div>
    </Sheet>
  );
}
