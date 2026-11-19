import { useId, useRef, useState } from 'react';
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

  const [open, setOpen] = useState<string | null>(null);
  const optionsId = useId();
  const trigger = useRef<HTMLButtonElement | null>(null);
  const fields = [
    { label: '年份', unit: '年', value: year, options: choices(firstYear, lastYear).reverse(), change: (y: number) => date(y, month, day) },
    { label: '月份', unit: '月', value: month, options: months, change: (m: number) => date(year, m, day) },
    { label: '周内日期', unit: '日', value: day, options: days, change: (d: number) => date(year, month, d) },
  ].slice(0, filter.kind === 'week' ? 3 : filter.kind === 'month' ? 2 : 1);
  const current = fields.find(field => field.label === open);

  return (
    <Sheet title="快捷选择时段" onClose={onClose}>
      <div className="stack">
        <div className="period-picker__fields">
          {fields.map(field => (
            <div className="field" key={field.label}>
              <span className="field__label">{field.label}</span>
              <button type="button" className="field__input period-picker__trigger"
                aria-label={`${field.label}，${field.value}${field.unit}`} aria-expanded={open === field.label}
                aria-controls={open === field.label ? optionsId : undefined}
                onClick={event => {
                  trigger.current = event.currentTarget;
                  setOpen(open === field.label ? null : field.label);
                }}>
                {field.value}{field.unit}<span aria-hidden="true">▾</span>
              </button>
            </div>
          ))}
        </div>
        {current && (
          <div id={optionsId} className="period-picker__options" role="group" aria-label={`选择${current.label}`}>
            {current.options.map(value => (
              <button key={value} type="button" aria-pressed={value === current.value}
                onClick={() => {
                  setDraft(current.change(value));
                  setOpen(null);
                  trigger.current?.focus();
                }}>{value}{current.unit}</button>
            ))}
          </div>
        )}
        <button type="button" className="button" onClick={() => pick(date(year, month, day))}>查看统计</button>
        <button type="button" className="link-button" onClick={() => pick(today)}>
          {filter.kind === 'week' ? '回到本周' : filter.kind === 'month' ? '回到本月' : '回到今年'}
        </button>
      </div>
    </Sheet>
  );
}
