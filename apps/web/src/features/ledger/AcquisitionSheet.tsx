import { useEffect, useState } from 'react';
import {
  allocateByWeight,
  dayDate,
  formatCents,
  monthDate,
  parseCents,
  unknownDate,
  type AcquisitionDate,
} from '@my-popmart/contracts';
import { Sheet } from '../../components/Sheet.js';
import { useRuntime } from '../../app/RuntimeProvider.js';
import { createRefund, deleteAcquisition, updateAcquisition } from '../../db/commands.js';
import { getAcquisitionDetail, type AcquisitionDetail } from '../../db/ledgerData.js';
import { describeError } from '../../db/errors.js';

const SOURCE_LABEL: Record<string, string> = {
  official: '官方购买',
  secondhand: '二手购入',
  gift: '别人赠送',
};

function dateLabel(date: AcquisitionDate): string {
  if (date.precision === 'day') return date.day;
  if (date.precision === 'month') return `${date.month}（仅月份）`;
  return '日期不详';
}

function dateToInput(date: AcquisitionDate): string {
  if (date.precision === 'day') return date.day;
  if (date.precision === 'month') return `${date.month}-01`;
  const today = new Date();
  const month = String(today.getMonth() + 1).padStart(2, '0');
  const day = String(today.getDate()).padStart(2, '0');
  return `${today.getFullYear()}-${month}-${day}`;
}

export function AcquisitionSheet({
  acquisitionId,
  onClose,
  onChanged,
}: {
  acquisitionId: string;
  onClose: () => void;
  onChanged: () => void;
}) {
  const { db, datasetId, sharedVersion } = useRuntime();
  const [detail, setDetail] = useState<AcquisitionDetail | null>(null);
  const [mode, setMode] = useState<'view' | 'edit' | 'refund' | 'delete'>('view');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [dateText, setDateText] = useState('');
  const [monthText, setMonthText] = useState('');
  const [precision, setPrecision] = useState<'day' | 'month' | 'unknown'>('day');
  const [lineQty, setLineQty] = useState<Record<string, number>>({});
  const [source, setSource] = useState<'official' | 'secondhand' | 'gift'>('official');
  const [amountText, setAmountText] = useState('');
  const [channel, setChannel] = useState('');
  const [note, setNote] = useState('');

  const [refundKind, setRefundKind] = useState<'refund_only' | 'return'>('refund_only');
  const [refundSelected, setRefundSelected] = useState<string[]>([]);
  const [refundAlloc, setRefundAlloc] = useState<Record<string, string>>({});
  const [refundQty, setRefundQty] = useState<Record<string, string>>({});
  const [refundManual, setRefundManual] = useState(false);
  const [refundAmountText, setRefundAmountText] = useState('');

  async function reload() {
    const value = await getAcquisitionDetail(db, datasetId, acquisitionId);
    setDetail(value);
    return value;
  }

  useEffect(() => {
    // Refresh read-only details, but keep an edit's expected revision and draft.
    if (mode === 'view') void reload();
  }, [db, datasetId, sharedVersion, acquisitionId, mode]);

  function startEdit(value: AcquisitionDetail) {
    setMode('edit');
    setError(null);
    setNotice(null);
    const date = value.acquisition.date;
    setPrecision(date.precision);
    setDateText(dateToInput(date));
    setMonthText(date.precision === 'month' ? date.month : dateToInput(date).slice(0, 7));
    setLineQty(Object.fromEntries(value.lines.map((line) => [line.line.id, line.line.quantity])));
    setSource(value.acquisition.source);
    setAmountText(value.acquisition.paidTotalCents === null ? '' : formatCents(value.acquisition.paidTotalCents));
    setChannel(value.acquisition.channel ?? '');
    setNote(value.acquisition.note ?? '');
  }

  function startRefund(value: AcquisitionDetail) {
    setMode('refund');
    setError(null);
    setNotice(null);
    setRefundKind('refund_only');
    setRefundManual(false);
    setRefundSelected(value.lines.map((line) => line.line.id));
    setRefundAmountText(
      formatCents(value.lines.reduce((total, line) => total + line.netPaidCents, 0)),
    );
    setRefundAlloc(
      Object.fromEntries(value.lines.map((line) => [line.line.id, formatCents(line.netPaidCents)])),
    );
    setRefundQty(Object.fromEntries(value.lines.map((line) => [line.line.id, '0'])));
  }

  function distributeRefund(ids: readonly string[], total: number | null) {
    if (!detail || total === null) return;
    const selected = detail.lines.filter((line) => ids.includes(line.line.id));
    const weights = selected.map((line) => line.netPaidCents);
    if (weights.length === 0 || weights.every((weight) => weight === 0)) {
      setRefundManual(true);
      return;
    }
    const allocations = allocateByWeight(total, weights);
    setRefundAlloc(
      Object.fromEntries(selected.map((line, index) => [line.line.id, formatCents(allocations[index] ?? 0)])),
    );
  }

  function toggleRefundLine(lineId: string) {
    const next = refundSelected.includes(lineId)
      ? refundSelected.filter((id) => id !== lineId)
      : [...refundSelected, lineId];
    setRefundSelected(next);
    if (!refundManual) {
      try {
        distributeRefund(next, refundAmountText.trim() === '' ? null : parseCents(refundAmountText));
      } catch {
        // 输入暂不合法时保持原值
      }
    }
  }

  async function saveEdit() {
    if (!detail) return;
    setError(null);

    let date: AcquisitionDate;
    try {
      date =
        precision === 'day'
          ? dayDate(dateText)
          : precision === 'month'
            ? monthDate(monthText)
            : unknownDate();
    } catch {
      setError('请选择有效日期');
      return;
    }

    let paidTotalCents: number | null = null;
    if (source !== 'gift') {
      try {
        paidTotalCents = parseCents(amountText);
      } catch {
        setError('金额请填写数字，最多两位小数');
        return;
      }
    }

    setBusy(true);
    try {
      await updateAcquisition(db, {
        commandId: crypto.randomUUID(),
        datasetId,
        acquisitionId,
        expectedRevision: detail.acquisition.revision,
        patch: {
          date,
          source,
          paidTotalCents,
          channel: channel.trim() === '' ? null : channel.trim(),
          note: note.trim() === '' ? null : note.trim(),
          lines: detail.lines.map((line) => ({
            lineId: line.line.id,
            quantity: lineQty[line.line.id] ?? line.line.quantity,
          })),
        },
      });
      await reload();
      setMode('view');
      setNotice('已保存');
      onChanged();
    } catch (reason) {
      setError(describeError(reason, '保存失败'));
    } finally {
      setBusy(false);
    }
  }

  async function submitRefund() {
    if (!detail) return;
    setError(null);

    if (refundSelected.length === 0) {
      setError('请选择要处理的款式');
      return;
    }

    let totalCents: number;
    try {
      totalCents = parseCents(refundAmountText);
    } catch {
      setError('退款金额请填写数字');
      return;
    }
    if (totalCents <= 0) {
      setError('退款金额必须大于零');
      return;
    }

    const lines: Array<{ lineId: string; refundCents: number; returnedQuantity: number }> = [];
    let sum = 0;

    for (const lineId of refundSelected) {
      const line = detail.lines.find((entry) => entry.line.id === lineId);
      if (!line) continue;

      let cents: number;
      try {
        cents = parseCents(refundAlloc[lineId] ?? '');
      } catch {
        setError('每款分摊金额请填写数字');
        return;
      }
      if (cents < 0) {
        setError('退款金额不能为负');
        return;
      }
      if (cents > line.netPaidCents) {
        setError(`${line.style?.displayName ?? '款式'} 的退款超过剩余实付`);
        return;
      }

      const returned = refundKind === 'return' ? Number(refundQty[lineId] ?? '0') : 0;
      const maxReturn = line.line.quantity - line.returnedQty;
      if (
        refundKind === 'return' &&
        (!Number.isSafeInteger(returned) || returned < 0 || returned > maxReturn)
      ) {
        setError(`${line.style?.displayName ?? '款式'} 的退货数量需在 0–${maxReturn} 之间`);
        return;
      }

      sum += cents;
      lines.push({ lineId, refundCents: cents, returnedQuantity: returned });
    }

    if (sum !== totalCents) {
      setError('各款分摊合计必须等于本次退款金额');
      return;
    }

    setBusy(true);
    try {
      await createRefund(db, {
        commandId: crypto.randomUUID(),
        datasetId,
        acquisitionId,
        kind: refundKind,
        processedOn: dateText,
        totalCents,
        lines,
      });
      await reload();
      setMode('view');
      setNotice(refundKind === 'return' ? '已记录退货' : '已记录退款');
      onChanged();
    } catch (reason) {
      setError(describeError(reason, '保存失败'));
    } finally {
      setBusy(false);
    }
  }

  async function confirmDelete() {
    if (!detail) return;
    setBusy(true);
    try {
      await deleteAcquisition(db, {
        commandId: crypto.randomUUID(),
        datasetId,
        acquisitionId,
      });
      onChanged();
      onClose();
    } catch (reason) {
      setError(describeError(reason, '删除失败'));
    } finally {
      setBusy(false);
    }
  }

  const refundSelectedLines = detail?.lines.filter((line) => refundSelected.includes(line.line.id)) ?? [];
  const refundTotalCents = (() => {
    try {
      return refundAmountText.trim() === '' ? null : parseCents(refundAmountText);
    } catch {
      return null;
    }
  })();
  const refundAllocSum = refundSelectedLines.reduce((total, line) => {
    try {
      return total + parseCents(refundAlloc[line.line.id] ?? '0');
    } catch {
      return total;
    }
  }, 0);
  const refundGap = refundTotalCents === null ? null : refundTotalCents - refundAllocSum;

  return (
    <Sheet title="购买详情" onClose={onClose}>
      {!detail ? <p className="page__hint">正在读取…</p> : null}

      {detail ? (
        <div className="stack">
          <div className="preview">
            <p className="preview__title">
              {detail.lines.map((line) => line.style?.displayName ?? '未知款式').join('、')}
            </p>
            <p className="list__meta">
              {dateLabel(detail.acquisition.date)} · {SOURCE_LABEL[detail.acquisition.source] ?? detail.acquisition.source} ·{' '}
              {detail.acquisition.paidTotalCents === null ? '未支出' : `¥${formatCents(detail.acquisition.paidTotalCents)}`}
            </p>
          </div>

          <ul className="order-lines">
            {detail.lines.map((line) => (
              <li key={line.line.id} className="order-lines__row">
                <span className="order-lines__name">
                  {line.style?.displayName ?? '未知款式'} × {line.line.quantity}
                  {line.returnedQty > 0 ? `（已退 ${line.returnedQty}）` : ''}
                </span>
                <span className="order-lines__unit">
                  {line.line.allocatedCents === null ? '—' : `¥${formatCents(line.netPaidCents)}`}
                </span>
              </li>
            ))}
          </ul>

          {detail.refunds.length > 0 ? (
            <p className="field__hint">已记录 {detail.refunds.length} 次退款／退货。</p>
          ) : null}

          {notice ? <p className="notice">{notice}</p> : null}
          {error ? <p className="notice notice--error">{error}</p> : null}

          {mode === 'view' ? (
            <div className="row">
              <button type="button" className="button button--ghost" onClick={() => startEdit(detail)}>
                编辑
              </button>
              {detail.acquisition.source !== 'gift' ? (
                <button type="button" className="button button--ghost" onClick={() => startRefund(detail)}>
                  退款／退货
                </button>
              ) : null}
              <button type="button" className="button button--danger" onClick={() => setMode('delete')}>
                删除误录
              </button>
            </div>
          ) : null}

          {mode === 'edit' ? (
            <div className="stack">
              <div className="segmented" role="group" aria-label="日期精度">
                {(
                  [
                    ['day', '具体日期'],
                    ['month', '仅月份'],
                    ['unknown', '日期不详'],
                  ] as const
                ).map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    className={`segmented__item${precision === value ? ' segmented__item--active' : ''}`}
                    onClick={() => setPrecision(value)}
                  >
                    {label}
                  </button>
                ))}
              </div>

              {precision === 'day' ? (
                <label className="field">
                  <span className="field__label">购买日期</span>
                  <input
                    className="field__input"
                    type="date"
                    value={dateText}
                    onChange={(event) => setDateText(event.target.value)}
                  />
                </label>
              ) : null}

              {precision === 'month' ? (
                <label className="field">
                  <span className="field__label">购买月份</span>
                  <input
                    className="field__input"
                    type="month"
                    value={monthText}
                    onChange={(event) => setMonthText(event.target.value)}
                  />
                  <span className="field__hint">只计入该月与年度统计，不进日柱。</span>
                </label>
              ) : null}

              {precision === 'unknown' ? (
                <p className="notice">日期不详只计入累计，不参与周／月／年与额度。</p>
              ) : null}

              <div className="field">
                <span className="field__label">数量</span>
                <ul className="picked__list">
                  {detail.lines.map((line) => {
                    const min = line.returnedQty + line.transferredQty;
                    const current = lineQty[line.line.id] ?? line.line.quantity;
                    return (
                      <li key={line.line.id} className="picked__row">
                        <span className="picked__name">{line.style?.displayName ?? '未知款式'}</span>
                        <div className="stepper stepper--small">
                          <button
                            type="button"
                            aria-label={`减少 ${line.style?.displayName ?? ''}`}
                            onClick={() =>
                              setLineQty((previous) => ({
                                ...previous,
                                [line.line.id]: Math.max(min, (previous[line.line.id] ?? line.line.quantity) - 1),
                              }))
                            }
                          >
                            −
                          </button>
                          <output>{current}</output>
                          <button
                            type="button"
                            aria-label={`增加 ${line.style?.displayName ?? ''}`}
                            onClick={() =>
                              setLineQty((previous) => ({
                                ...previous,
                                [line.line.id]: Math.min(99, (previous[line.line.id] ?? line.line.quantity) + 1),
                              }))
                            }
                          >
                            ＋
                          </button>
                        </div>
                      </li>
                    );
                  })}
                </ul>
                <span className="field__hint">数量不能小于已退货与已转出之和。</span>
              </div>

              <div className="segmented" role="group" aria-label="购买来源">
                {(
                  [
                    ['official', '官方购买'],
                    ['secondhand', '二手购入'],
                    ['gift', '别人赠送'],
                  ] as const
                ).map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    className={`segmented__item${source === value ? ' segmented__item--active' : ''}`}
                    onClick={() => setSource(value)}
                  >
                    {label}
                  </button>
                ))}
              </div>

              {source !== 'gift' ? (
                <label className="field">
                  <span className="field__label">实付总额</span>
                  <input
                    className="field__input"
                    inputMode="decimal"
                    value={amountText}
                    onChange={(event) => setAmountText(event.target.value)}
                  />
                  <span className="field__hint">修改后会按参考价权重重算各款分摊。</span>
                </label>
              ) : null}

              <details className="more">
                <summary>更多信息</summary>
                <label className="field">
                  <span className="field__label">渠道</span>
                  <input className="field__input" value={channel} onChange={(event) => setChannel(event.target.value)} />
                </label>
                <label className="field">
                  <span className="field__label">备注</span>
                  <input className="field__input" value={note} onChange={(event) => setNote(event.target.value)} />
                </label>
              </details>

              <div className="row">
                <button type="button" className="button" disabled={busy} onClick={saveEdit}>
                  {busy ? '保存中…' : '保存修改'}
                </button>
                <button type="button" className="button button--ghost" onClick={() => setMode('view')}>
                  取消
                </button>
              </div>
            </div>
          ) : null}

          {mode === 'refund' ? (
            <div className="stack">
              <div className="field">
                <span className="field__label">处理哪些款式</span>
                <ul className="picked__list">
                  {detail.lines.map((line) => {
                    const checked = refundSelected.includes(line.line.id);
                    return (
                      <li key={line.line.id} className="picked__row">
                        <label className="refund-line">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggleRefundLine(line.line.id)}
                          />
                          <span>{line.style?.displayName ?? '未知款式'}</span>
                        </label>
                        <span className="list__meta">剩余 ¥{formatCents(line.netPaidCents)}</span>
                      </li>
                    );
                  })}
                </ul>
              </div>

              <div className="segmented" role="group" aria-label="处理方式">
                <button
                  type="button"
                  className={`segmented__item${refundKind === 'refund_only' ? ' segmented__item--active' : ''}`}
                  onClick={() => setRefundKind('refund_only')}
                >
                  仅退款
                </button>
                <button
                  type="button"
                  className={`segmented__item${refundKind === 'return' ? ' segmented__item--active' : ''}`}
                  onClick={() => setRefundKind('return')}
                >
                  退货退款
                </button>
              </div>

              <label className="field">
                <span className="field__label">实际退款金额</span>
                <input
                  className="field__input"
                  inputMode="decimal"
                  value={refundAmountText}
                  onChange={(event) => {
                    setRefundAmountText(event.target.value);
                    if (refundManual) return;
                    try {
                      distributeRefund(refundSelected, parseCents(event.target.value));
                    } catch {
                      // 输入过程中允许暂时不合法
                    }
                  }}
                />
                <span className="field__hint">统计会修正原购买月份，不计入处理当月收入。</span>
              </label>

              {refundSelectedLines.length > 1 ? (
                <div className="field">
                  <div className="field-row">
                    <span className="field__label">各款分摊</span>
                    <button
                      type="button"
                      className="link-button"
                      onClick={() => {
                        setRefundManual(false);
                        distributeRefund(refundSelected, refundTotalCents);
                      }}
                    >
                      按剩余实付重新分配
                    </button>
                  </div>
                  <ul className="alloc-list">
                    {refundSelectedLines.map((line) => (
                      <li key={line.line.id} className="alloc-list__row">
                        <span className="alloc-list__name">{line.style?.displayName ?? '未知款式'}</span>
                        <input
                          className="field__input alloc-list__input"
                          inputMode="decimal"
                          value={refundAlloc[line.line.id] ?? ''}
                          aria-label={`${line.style?.displayName ?? ''} 退款分摊`}
                          onChange={(event) => {
                            setRefundManual(true);
                            setRefundAlloc((previous) => ({
                              ...previous,
                              [line.line.id]: event.target.value,
                            }));
                          }}
                        />
                      </li>
                    ))}
                  </ul>
                  {refundGap !== null && refundGap !== 0 ? (
                    <p className="notice notice--error">
                      分摊合计与退款金额还差 ¥{formatCents(Math.abs(refundGap))}
                    </p>
                  ) : null}
                  {refundManual ? (
                    <p className="field__hint">已手动分配；改动金额后请重新核对。</p>
                  ) : null}
                </div>
              ) : null}

              {refundKind === 'return' ? (
                <div className="field">
                  <span className="field__label">退货数量</span>
                  <ul className="alloc-list">
                    {refundSelectedLines.map((line) => {
                      const maxReturn = line.line.quantity - line.returnedQty;
                      return (
                        <li key={line.line.id} className="alloc-list__row">
                          <span className="alloc-list__name">
                            {line.style?.displayName ?? '未知款式'}（最多 {maxReturn}）
                          </span>
                          <input
                            className="field__input alloc-list__input"
                            inputMode="numeric"
                            value={refundQty[line.line.id] ?? '0'}
                            aria-label={`${line.style?.displayName ?? ''} 退货数量`}
                            onChange={(event) =>
                              setRefundQty((previous) => ({
                                ...previous,
                                [line.line.id]: event.target.value,
                              }))
                            }
                          />
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ) : null}

              <div className="row">
                <button type="button" className="button" disabled={busy} onClick={submitRefund}>
                  {busy ? '保存中…' : '确认'}
                </button>
                <button type="button" className="button button--ghost" onClick={() => setMode('view')}>
                  取消
                </button>
              </div>
            </div>
          ) : null}

          {mode === 'delete' ? (
            <div className="stack">
              <p className="notice notice--error">
                将撤销这笔记录对应的收藏数量与消费，关联退款／转出也会一并撤销。确定删除误录？
              </p>
              <div className="row">
                <button type="button" className="button button--danger" disabled={busy} onClick={confirmDelete}>
                  {busy ? '处理中…' : '确认删除'}
                </button>
                <button type="button" className="button button--ghost" onClick={() => setMode('view')}>
                  取消
                </button>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </Sheet>
  );
}
