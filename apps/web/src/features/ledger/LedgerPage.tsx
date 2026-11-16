import { useEffect, useMemo, useRef, useState } from 'react';
import {
  formatCny,
  parseCents,
  toLocalCalendarDay,
  type Cents,
} from '@my-popmart/contracts';
import { useRuntime } from '../../app/RuntimeProvider.js';
import { setBudget } from '../../db/commands.js';
import { getBudgetLimits, loadLedgerData, monthUsage, type BudgetLimits } from '../../db/ledgerData.js';
import { budgetLevel, type BudgetLevel } from '../../domain/budget.js';
import {
  aggregatePeriod,
  anchorToKey,
  canShiftBackward,
  firstBoundary,
  canShiftForward,
  cumulative,
  filterRecordsInPeriod,
  firstRecordYear,
  keyToAnchor,
  periodLabel,
  recordsByIp,
  shiftPeriod,
  type LedgerRecord,
  type PeriodFilter,
  type PeriodKind,
} from '../../domain/ledger.js';
import { Sheet } from '../../components/Sheet.js';
import { AcquisitionSheet } from './AcquisitionSheet.js';
import { StyleImage } from '../../components/StyleImage.js';

const METRIC_LABEL = { cents: '金额', qty: '数量' } as const;
type Metric = keyof typeof METRIC_LABEL;

const SOURCE_LABEL: Record<string, string> = {
  official: '官方',
  secondhand: '二手',
  gift: '赠送',
};

const BUDGET_COPY: Record<BudgetLevel, { amount: string; qty: string }> = {
  ample: { amount: '钱包目前情绪稳定', qty: '慢慢挑，买最喜欢的' },
  warning: { amount: '钱包开始捂紧自己了', qty: '悠着点儿买，快到上限啦' },
  reached: { amount: '没钱了没钱了', qty: '这个月的宝宝够多啦' },
  exceeded: { amount: '钱包：说好的预算呢？', qty: '收纳架：先让我缓缓' },
};

export function LedgerPage({ refreshKey }: { refreshKey: number }) {
  const { db, datasetId } = useRuntime();
  const today = toLocalCalendarDay(new Date());
  const [records, setRecords] = useState<LedgerRecord[] | null>(null);
  const [ips, setIps] = useState<Array<{ id: string; name: string }>>([]);
  const [filter, setFilter] = useState<PeriodFilter>(() => ({ kind: 'month', anchor: `${today.slice(0, 7)}-01` }));
  const [ipId, setIpId] = useState<string>('all');
  const [metric, setMetric] = useState<Metric>('cents');
  const [budget, setBudgetLimitsState] = useState<BudgetLimits | null>(null);
  const [budgetOpen, setBudgetOpen] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const [expandedYears, setExpandedYears] = useState<Set<string>>(new Set());
  const [expandedMonths, setExpandedMonths] = useState<Set<string>>(new Set());

  const currentMonth = today.slice(0, 7);

  useEffect(() => {
    let cancelled = false;
    loadLedgerData(db, datasetId).then((data) => {
      if (cancelled) return;
      setRecords([...data.records]);
      setIps([...data.ips]);
    });
    return () => {
      cancelled = true;
    };
  }, [db, datasetId, refreshKey, version]);

  useEffect(() => {
    let cancelled = false;
    getBudgetLimits(db, datasetId, currentMonth).then((limits) => {
      if (!cancelled) setBudgetLimitsState(limits);
    });
    return () => {
      cancelled = true;
    };
  }, [db, datasetId, currentMonth, refreshKey]);

  const firstYear = useMemo(() => firstRecordYear(records ?? []), [records]);
  const firstBoundaryDay = useMemo(() => firstBoundary(records ?? []), [records]);

  const filtered = useMemo(() => recordsByIp(records ?? [], ipId), [records, ipId]);
  const summary = useMemo(() => aggregatePeriod(filtered, filter, today, firstYear), [filtered, filter, today, firstYear]);
  const cumulativeTotals = useMemo(() => cumulative(filtered), [filtered]);
  const entries = useMemo(
    () => filterRecordsInPeriod(filtered, filter, today, firstYear),
    [filtered, filter, today, firstYear],
  );
  const hierarchy = useMemo(() => {
    const yearMap = new Map<string, Map<string, LedgerRecord[]>>();
    for (const record of entries) {
      const monthKey =
        record.date.precision === 'day'
          ? record.date.day.slice(0, 7)
          : record.date.precision === 'month'
            ? record.date.month
            : null;
      if (monthKey === null) continue;
      const year = monthKey.slice(0, 4);
      let months = yearMap.get(year);
      if (!months) {
        months = new Map();
        yearMap.set(year, months);
      }
      const list = months.get(monthKey);
      if (list) list.push(record);
      else months.set(monthKey, [record]);
    }
    const orderKey = (record: LedgerRecord) =>
      record.date.precision === 'day'
        ? record.date.day
        : record.date.precision === 'month'
          ? `${record.date.month}-00`
          : '9999-99';
    return [...yearMap.entries()]
      .map(([year, months]) => ({
        year,
        months: [...months.entries()]
          .map(([month, records]) => ({
            month,
            records: [...records].sort((a, b) => orderKey(b).localeCompare(orderKey(a))),
          }))
          .sort((a, b) => b.month.localeCompare(a.month)),
      }))
      .sort((a, b) => b.year.localeCompare(a.year));
  }, [entries]);
  const usage = useMemo(() => monthUsage(records ?? [], currentMonth), [records, currentMonth]);

  const maxBucket = Math.max(1, ...summary.buckets.map((bucket) => (metric === 'cents' ? bucket.cents : bucket.qty)));
  const selectedKey = anchorToKey(filter.kind, filter.anchor);
  const selectedBucket = summary.buckets.find((bucket) => bucket.key === selectedKey) ?? null;

  function switchKind(kind: PeriodKind) {
    const anchor =
      kind === 'week' ? today : kind === 'month' ? `${today.slice(0, 7)}-01` : `${today.slice(0, 4)}-01-01`;
    setFilter({ kind, anchor });
  }

  function shift(delta: number) {
    setFilter((current) => shiftPeriod(current, delta));
  }

  function toggleYear(year: string) {
    setExpandedYears((current) => {
      const next = new Set(current);
      if (next.has(year)) next.delete(year);
      else next.add(year);
      return next;
    });
  }

  function toggleMonth(month: string) {
    setExpandedMonths((current) => {
      const next = new Set(current);
      if (next.has(month)) next.delete(month);
      else next.add(month);
      return next;
    });
  }

  function jumpToDetail() {
    const year = selectedKey.slice(0, 4);
    const month = filter.kind === 'year' ? null : selectedKey.slice(0, 7);
    setExpandedYears((current) => new Set(current).add(year));
    if (month) setExpandedMonths((current) => new Set(current).add(month));
    requestAnimationFrame(() => {
      const target = month
        ? document.getElementById(`entry-month-${month}`)
        : document.getElementById(`entry-year-${year}`);
      target?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }

  return (
    <main className="page">
      <h1 className="page__title ledger-title">捂一下钱包？</h1>

      <div className="ip-tabs" role="tablist" aria-label="IP 筛选">
        <button
          type="button"
          className={`ip-tabs__item${ipId === 'all' ? ' ip-tabs__item--active' : ''}`}
          onClick={() => setIpId('all')}
        >
          全部
        </button>
        {ips.map((ip) => (
          <button
            key={ip.id}
            type="button"
            className={`ip-tabs__item${ipId === ip.id ? ' ip-tabs__item--active' : ''}`}
            onClick={() => setIpId(ip.id)}
          >
            {ip.name}
          </button>
        ))}
      </div>

      <section className="ledger-totals" aria-label="累计">
        <div className="summary__cell">
          <span className="summary__label">累计消费</span>
          <strong className="summary__value">{formatCny(cumulativeTotals.cents)}</strong>
        </div>
        <div className="summary__cell">
          <span className="summary__label">累计购买</span>
          <strong className="summary__value">{cumulativeTotals.qty} 只</strong>
        </div>
      </section>

      <section className="ledger-period" aria-label="时段统计">
        <div className="period-tabs" role="group" aria-label="时间范围">
          {(['week', 'month', 'year'] as PeriodKind[]).map((kind) => (
            <button
              key={kind}
              type="button"
              className={`period-tabs__item${filter.kind === kind ? ' period-tabs__item--active' : ''}`}
              onClick={() => switchKind(kind)}
            >
              {kind === 'week' ? '周' : kind === 'month' ? '月' : '年'}
            </button>
          ))}
        </div>

        {summary.buckets.length > 1 ? (
          <div className="period-nav">
            <button
              type="button"
              className="fan__nav"
              aria-label="上一个"
              disabled={!canShiftBackward(filter, firstBoundaryDay)}
              onClick={() => shift(-1)}
            >
              ‹
            </button>
            <span className="period-nav__label">{periodLabel(filter)}</span>
            <button
              type="button"
              className="fan__nav"
              aria-label="下一个"
              disabled={!canShiftForward(filter, today)}
              onClick={() => shift(1)}
            >
              ›
            </button>
          </div>
        ) : (
          <div className="period-nav">
            <span className="period-nav__label">{periodLabel(filter)}</span>
          </div>
        )}

        <div className="period-figures">
          <button type="button" className="period-figure" onClick={jumpToDetail}>
            <span className="period-figure__label">这阵儿买了</span>
            <strong className="period-figure__value">{formatCny(selectedBucket?.cents ?? 0)}</strong>
          </button>
          <button type="button" className="period-figure" onClick={jumpToDetail}>
            <span className="period-figure__label">新宝宝</span>
            <strong className="period-figure__value">{selectedBucket?.qty ?? 0} 只</strong>
          </button>
        </div>

        <div className="period-tabs period-tabs--small" role="group" aria-label="指标">
          {(['cents', 'qty'] as Metric[]).map((value) => (
            <button
              key={value}
              type="button"
              className={`period-tabs__item${metric === value ? ' period-tabs__item--active' : ''}`}
              onClick={() => setMetric(value)}
            >
              {METRIC_LABEL[value]}
            </button>
          ))}
        </div>

        <BarChart
          buckets={summary.buckets}
          metric={metric}
          max={maxBucket}
          selected={selectedKey}
          slotsPerScreen={filter.kind === 'week' ? 7 : 6}
          onSelect={(key) => setFilter((current) => ({ kind: current.kind, anchor: keyToAnchor(current.kind, key) }))}
        />

        {summary.unassignedCents > 0 || summary.unassignedQty > 0 ? (
          <p className="notice">
            另有 {formatCny(summary.unassignedCents)} · {summary.unassignedQty} 只未分配到具体日期（仅月份记录）。
          </p>
        ) : null}
      </section>

      <section className="budget" aria-label="悠着点儿买">
        <header className="budget__header">
          <h2 className="budget__title">悠着点儿买</h2>
          <button type="button" className="link-button" onClick={() => setBudgetOpen(true)}>
            {budget && (budget.amountLimitCents !== null || budget.quantityLimit !== null) ? '调整' : '设置'}
          </button>
        </header>

        {!budget || (budget.amountLimitCents === null && budget.quantityLimit === null) ? (
          <p className="page__hint">本月还没有设置限度。上限只是提醒，不影响记录。</p>
        ) : (
          <div className="budget__rows">
            {budget.amountLimitCents !== null ? (
              <BudgetRow
                label="金额"
                used={usage.cents}
                limit={budget.amountLimitCents}
                format={(value) => formatCny(value)}
                copy={BUDGET_COPY}
              />
            ) : null}
            {budget.quantityLimit !== null ? (
              <BudgetRow
                label="数量"
                used={usage.qty}
                limit={budget.quantityLimit}
                format={(value) => `${value} 只`}
                copy={BUDGET_COPY}
              />
            ) : null}
            <p className="field__hint">按本月全部 IP 计算，IP 筛选不影响额度。</p>
          </div>
        )}
      </section>

      <section className="entries" aria-label="购买明细">
        {hierarchy.length === 0 ? (
          <p className="page__hint">这个时段还没有记录。</p>
        ) : (
          <ul className="entry-years">
            {hierarchy.map((yearGroup) => {
              const yearCents = yearGroup.months.reduce(
                (sum, monthGroup) => sum + monthGroup.records.reduce((x, record) => x + record.statsCents, 0),
                0,
              );
              const yearQty = yearGroup.months.reduce(
                (sum, monthGroup) => sum + monthGroup.records.reduce((x, record) => x + record.statsQty, 0),
                0,
              );
              return (
                <li key={yearGroup.year} className="entry-year" id={`entry-year-${yearGroup.year}`}>
                  <button
                    type="button"
                    className="entry-year__head"
                    aria-expanded={expandedYears.has(yearGroup.year)}
                    onClick={() => toggleYear(yearGroup.year)}
                  >
                    <span className="entry-year__title">{yearGroup.year} 年</span>
                    <span className="entry-year__total">
                      {formatCny(yearCents)} · {yearQty} 只
                    </span>
                    <span className="entry-year__chevron">{expandedYears.has(yearGroup.year) ? '▾' : '▸'}</span>
                  </button>
                  {expandedYears.has(yearGroup.year) ? (
                    <ul className="entry-months">
                      {yearGroup.months.map((monthGroup) => {
                        const monthCents = monthGroup.records.reduce((sum, record) => sum + record.statsCents, 0);
                        const monthQty = monthGroup.records.reduce((sum, record) => sum + record.statsQty, 0);
                        return (
                          <li key={monthGroup.month} className="entry-month" id={`entry-month-${monthGroup.month}`}>
                            <button
                              type="button"
                              className="entry-month__head"
                              aria-expanded={expandedMonths.has(monthGroup.month)}
                              onClick={() => toggleMonth(monthGroup.month)}
                            >
                              <span className="entry-month__title">{Number(monthGroup.month.slice(5, 7))} 月</span>
                              <span className="entry-month__total">
                                {formatCny(monthCents)} · {monthQty} 只
                              </span>
                              <span className="entry-month__chevron">{expandedMonths.has(monthGroup.month) ? '▾' : '▸'}</span>
                            </button>
                            {expandedMonths.has(monthGroup.month) ? (
                              <ul className="entry-list">
                                {monthGroup.records.map((record) => (
                                  <li
                                    key={record.lineId}
                                    className="entry-row entry-row--button"
                                    role="button"
                                    tabIndex={0}
                                    onClick={() => setDetailId(record.acquisitionId)}
                                    onKeyDown={(event) => {
                                      if (event.key === 'Enter' || event.key === ' ') setDetailId(record.acquisitionId);
                                    }}
                                  >
                                    <div className="entry-row__thumb">
                                      <StyleImage
                                        url={record.imageUrl}
                                        assetId={record.imageAssetId}
                                        alt=""
                                        placeholder=""
                                      />
                                    </div>
                                    <div className="entry-row__body">
                                      <span className="entry-row__name">{record.styleName}</span>
                                      <span className="list__meta">
                                        {record.seriesName} · {SOURCE_LABEL[record.source] ?? record.source}
                                      </span>
                                      <span className="entry-row__date">
                                        {record.date.precision === 'day'
                                          ? `${Number(record.date.day.slice(5, 7))}月${Number(record.date.day.slice(8, 10))}日`
                                          : '仅月份'}
                                      </span>
                                    </div>
                                    <div className="entry-row__amount">
                                      <strong>{record.source === 'gift' ? '赠送／未支出' : formatCny(record.statsCents)}</strong>
                                      <span className="list__meta">×{record.quantity}</span>
                                    </div>
                                  </li>
                                ))}
                              </ul>
                            ) : null}
                          </li>
                        );
                      })}
                    </ul>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {detailId ? (
        <AcquisitionSheet
          acquisitionId={detailId}
          onClose={() => setDetailId(null)}
          onChanged={() => setVersion((value) => value + 1)}
        />
      ) : null}

      {budgetOpen ? (
        <BudgetSheet
          budget={budget}
          onClose={() => setBudgetOpen(false)}
          onSaved={(limits) => {
            setBudgetLimitsState(limits);
            setBudgetOpen(false);
          }}
        />
      ) : null}
    </main>
  );
}

function BarChart({
  buckets,
  metric,
  max,
  selected,
  onSelect,
  slotsPerScreen,
}: {
  buckets: readonly { key: string; label: string; cents: number; qty: number }[];
  metric: Metric;
  max: number;
  selected: string;
  onSelect: (key: string) => void;
  slotsPerScreen: number;
}) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [containerWidth, setContainerWidth] = useState(320);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const update = () => setContainerWidth(el.clientWidth || 320);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const height = 190;
  const gap = 6;
  const slotWidth = containerWidth / slotsPerScreen;
  const barWidth = Math.max(8, slotWidth - gap);
  const width = Math.max(containerWidth, buckets.length * slotWidth);
  const offsetX = (width - buckets.length * slotWidth) / 2;

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const index = buckets.findIndex((bucket) => bucket.key === selected);
    if (index < 0) return;
    const barX = offsetX + index * slotWidth;
    el.scrollLeft = Math.max(0, barX - (containerWidth - slotWidth) / 2);
  }, [buckets, selected, slotWidth, containerWidth]);

  const selectedBucket = buckets.find((bucket) => bucket.key === selected) ?? null;

  return (
    <div className="chart">
      <div className="chart__scroll" ref={scrollRef}>
        <svg
          viewBox={`0 0 ${width} ${height + 18}`}
          width={width}
          height={height + 18}
          role="img"
          aria-label={`${metric === 'cents' ? '金额' : '数量'}柱状图`}
          className="chart__svg"
        >
        {buckets.map((bucket, index) => {
          const value = metric === 'cents' ? bucket.cents : bucket.qty;
          const barHeight = value === 0 ? 0 : Math.max(2, (value / max) * height);
          const x = offsetX + index * slotWidth;
          const isSelected = bucket.key === selected;
          return (
            <g key={bucket.key}>
              <rect
                x={x}
                y={height - barHeight}
                width={barWidth}
                height={barHeight}
                rx={Math.min(3, barWidth / 2)}
                className={`chart__bar${isSelected ? ' chart__bar--selected' : ''}`}
                onClick={() => onSelect(bucket.key)}
                role="button"
                tabIndex={0}
                aria-label={`${bucket.label} ${metric === 'cents' ? formatCny(bucket.cents) : `${bucket.qty} 只`}`}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') onSelect(bucket.key);
                }}
              />
              <text x={x + barWidth / 2} y={height + 13} className="chart__label" textAnchor="middle">
                {bucket.label}
              </text>
            </g>
          );
        })}
        </svg>
      </div>
      <ul className="sr-only" aria-label="柱状图数值列表">
        {buckets
          .filter((bucket) => (metric === 'cents' ? bucket.cents : bucket.qty) > 0)
          .map((bucket) => (
            <li key={bucket.key}>
              {bucket.label}：
              {metric === 'cents' ? formatCny(bucket.cents) : `${bucket.qty} 只`}
            </li>
          ))}
      </ul>
      <p className="chart__value" aria-live="polite">
        {selectedBucket
          ? `${selectedBucket.label} · ${metric === 'cents' ? formatCny(selectedBucket.cents) : `${selectedBucket.qty} 只`}`
          : '点击柱子查看当天数值'}
      </p>
    </div>
  );
}

function BudgetRow({
  label,
  used,
  limit,
  format,
  copy,
}: {
  label: string;
  used: number;
  limit: number;
  format: (value: number) => string;
  copy: Record<BudgetLevel, { amount: string; qty: string }>;
}) {
  const level = budgetLevel(used, limit);
  const percent = Math.min(100, Math.round((used / limit) * 100));
  const remaining = limit - used;
  const message = label === '金额' ? copy[level].amount : copy[level].qty;

  return (
    <div className={`budget-row budget-row--${level}`}>
      <div className="budget-row__head">
        <span className="budget-row__label">{label}上限</span>
        <span className="budget-row__numbers">
          {format(used)} / {format(limit)}
        </span>
      </div>
      <div className="budget-row__track">
        <div className="budget-row__fill" style={{ width: `${percent}%` }} />
      </div>
      <p className="budget-row__message">
        {message} ·{' '}
        {remaining >= 0 ? `还剩 ${format(remaining)}` : `已超出 ${format(-remaining)}`}
      </p>
    </div>
  );
}

function BudgetSheet({
  budget,
  onClose,
  onSaved,
}: {
  budget: BudgetLimits | null;
  onClose: () => void;
  onSaved: (limits: BudgetLimits) => void;
}) {
  const { db, datasetId } = useRuntime();
  const month = toLocalCalendarDay(new Date()).slice(0, 7);
  const [amountEnabled, setAmountEnabled] = useState((budget?.amountLimitCents ?? null) !== null);
  const [amountText, setAmountText] = useState(
    budget?.amountLimitCents !== null && budget?.amountLimitCents !== undefined
      ? (budget.amountLimitCents / 100).toFixed(2)
      : '',
  );
  const [qtyEnabled, setQtyEnabled] = useState((budget?.quantityLimit ?? null) !== null);
  const [qtyText, setQtyText] = useState(budget?.quantityLimit ? String(budget.quantityLimit) : '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setError(null);
    let cents: Cents | null = null;
    let qty: number | null = null;

    if (amountEnabled) {
      try {
        cents = parseCents(amountText);
      } catch {
        setError('金额请填写数字，最多两位小数');
        return;
      }
      if (cents <= 0) {
        setError('金额上限必须大于零');
        return;
      }
    }
    if (qtyEnabled) {
      const value = Number(qtyText.trim());
      if (!Number.isSafeInteger(value) || value <= 0) {
        setError('数量上限必须是正整数');
        return;
      }
      qty = value;
    }
    if (!amountEnabled && !qtyEnabled) {
      setError('至少启用一个限制');
      return;
    }

    setBusy(true);
    try {
      await setBudget(db, {
        commandId: crypto.randomUUID(),
        datasetId,
        month,
        amountLimitCents: cents,
        quantityLimit: qty,
      });
      onSaved({ amountLimitCents: cents, quantityLimit: qty, fromSnapshot: true });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '保存失败');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet title="悠着点儿买" onClose={onClose}>
      <div className="stack">
        <p className="page__hint">按自然月计算，未使用的额度不会结转到下个月。</p>

        <label className="toggle-row">
          <span>限制金额</span>
          <input type="checkbox" checked={amountEnabled} onChange={(event) => setAmountEnabled(event.target.checked)} />
        </label>
        {amountEnabled ? (
          <label className="field">
            <span className="field__label">每月最多花（元）</span>
            <input
              className="field__input"
              inputMode="decimal"
              value={amountText}
              placeholder="例如 300"
              onChange={(event) => setAmountText(event.target.value)}
            />
          </label>
        ) : null}

        <label className="toggle-row">
          <span>限制数量</span>
          <input type="checkbox" checked={qtyEnabled} onChange={(event) => setQtyEnabled(event.target.checked)} />
        </label>
        {qtyEnabled ? (
          <label className="field">
            <span className="field__label">每月最多买（只）</span>
            <input
              className="field__input"
              inputMode="numeric"
              value={qtyText}
              placeholder="例如 4"
              onChange={(event) => setQtyText(event.target.value)}
            />
          </label>
        ) : null}

        {error ? <p className="notice notice--error">{error}</p> : null}

        <button type="button" className="button" disabled={busy} onClick={save}>
          {busy ? '保存中…' : '保存'}
        </button>
      </div>
    </Sheet>
  );
}
