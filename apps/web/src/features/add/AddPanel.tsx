import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  dayDate,
  formatCents,
  parseCents,
  toLocalCalendarDay,
  type AcquisitionDate,
  type Cents,
  type SeriesCandidate,
  type SeriesPreview,
} from '@my-popmart/contracts';
import { Sheet } from '../../components/Sheet.js';
import { StyleImage } from '../../components/StyleImage.js';
import { useRuntime } from '../../app/RuntimeProvider.js';
import { commitSeriesImport, createAcquisition } from '../../db/commands.js';
import { describeError } from '../../db/errors.js';
import { getSeriesViews, type SeriesView, type StyleWithHeld } from '../../db/queries.js';
import type { SeriesRow } from '../../db/rows.js';
import { resolveReferenceUnitCents } from '../../domain/price.js';
import { fetchPreview, resolveLink, searchSeries } from '../../api/import.js';
import { cacheStyleImages } from '../../media/cache.js';

type Source = 'official' | 'secondhand' | 'gift';
type ImportStep = 'idle' | 'candidates' | 'preview';

interface PickedItem {
  readonly entry: StyleWithHeld;
  readonly quantity: number;
  readonly series: SeriesRow;
}

export function AddPanel({
  onClose,
  onSaved,
  onToast,
  initialSeriesId,
  refreshKey = 0,
}: {
  onClose: () => void;
  onSaved: (message: string) => void;
  onToast: (message: string) => void;
  initialSeriesId?: string | null;
  refreshKey?: number;
}) {
  const { db, datasetId, sharedVersion } = useRuntime();
  const [views, setViews] = useState<SeriesView[] | null>(null);
  const [activeSeriesId, setActiveSeriesId] = useState<string | null>(initialSeriesId ?? null);
  const [picked, setPicked] = useState<Map<string, number>>(new Map());
  const [orderOpen, setOrderOpen] = useState(false);
  const styleRowRef = useRef<HTMLDivElement | null>(null);
  const [styleHint, setStyleHint] = useState(false);
  const [seriesOpen, setSeriesOpen] = useState(false);

  // 内联导入状态
  const [importStep, setImportStep] = useState<ImportStep>('idle');
  const [importInput, setImportInput] = useState('');
  const [candidates, setCandidates] = useState<SeriesCandidate[]>([]);
  const [preview, setPreview] = useState<SeriesPreview | null>(null);
  const [priceText, setPriceText] = useState('');
  const [importBusy, setImportBusy] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [importHint, setImportHint] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const next = await getSeriesViews(db, datasetId);
    setViews(next);
    setActiveSeriesId((current) => {
      if (current && next.some((view) => view.series.id === current)) return current;
      return next[0]?.series.id ?? null;
    });
  }, [db, datasetId, sharedVersion]);

  useEffect(() => {
    void reload();
  }, [reload, refreshKey]);

  const activeSeries = useMemo(
    () => views?.find((view) => view.series.id === activeSeriesId) ?? null,
    [views, activeSeriesId],
  );

  const styleIndex = useMemo(() => {
    const map = new Map<string, { entry: StyleWithHeld; series: SeriesRow }>();
    for (const view of views ?? []) {
      for (const entry of view.styles) {
        map.set(entry.style.id, { entry, series: view.series });
      }
    }
    return map;
  }, [views]);

  const pickedItems: PickedItem[] = useMemo(() => {
    return [...picked.entries()].flatMap(([styleId, quantity]) => {
      const found = styleIndex.get(styleId);
      return found ? [{ entry: found.entry, quantity, series: found.series }] : [];
    });
  }, [styleIndex, picked]);

  const pickedTotal = pickedItems.reduce((total, item) => total + item.quantity, 0);

  function updateStyleHint() {
    const el = styleRowRef.current;
    if (!el) return;
    setStyleHint(el.scrollWidth - el.scrollLeft - el.clientWidth > 8);
  }

  useEffect(() => {
    const el = styleRowRef.current;
    if (el) el.scrollLeft = 0;
    const tick = window.setTimeout(updateStyleHint, 0);
    return () => window.clearTimeout(tick);
  }, [activeSeriesId]);

  function selectSeries(seriesId: string) {
    setActiveSeriesId(seriesId);
    setOrderOpen(false);
  }

  function togglePick(entry: StyleWithHeld) {
    const styleId = entry.style.id;
    setPicked((current) => {
      const next = new Map(current);
      if (next.has(styleId)) next.delete(styleId);
      else next.set(styleId, 1);
      return next;
    });
  }

  function changePickedQuantity(styleId: string, delta: number) {
    setPicked((current) => {
      const next = new Map(current);
      const value = Math.max(1, Math.min(99, (next.get(styleId) ?? 1) + delta));
      next.set(styleId, value);
      return next;
    });
  }

  async function runImportSearch() {
    const query = importInput.trim();
    if (!query) return;
    setImportBusy(true);
    setImportError(null);
    setImportHint(null);
    try {
      const looksUrl = /^https?:\/\//i.test(query) || /popmart\.com/i.test(query);
      const result = looksUrl ? await resolveLink(query) : await searchSeries(query);
      if (result === 'needs_name') {
        setImportHint('小程序分享码无法直接解析，请改用系列名称搜索。');
        onToast('换个英文输入吧～');
        return;
      }
      if (result.length === 0) {
        setImportHint('没有找到候选，请换个链接或名称。');
        onToast('换个英文输入吧～');
        return;
      }
      setCandidates(result);
      setImportStep('candidates');
    } catch (reason) {
      setImportError(describeError(reason, '解析失败'));
      onToast('换个英文输入吧～');
    } finally {
      setImportBusy(false);
    }
  }

  async function chooseCandidate(candidate: SeriesCandidate) {
    setImportBusy(true);
    setImportError(null);
    try {
      const value = await fetchPreview(candidate.candidateId);
      setPreview(value);
      setImportStep('preview');
    } catch (reason) {
      setImportError(describeError(reason, '读取预览失败'));
      onToast('换个英文输入吧～');
    } finally {
      setImportBusy(false);
    }
  }

  async function saveImport() {
    if (!preview) return;
    let cents: number | null = null;
    if (priceText.trim() !== '') {
      try {
        cents = parseCents(priceText);
      } catch {
        setImportError('价格请填写数字，最多两位小数');
        return;
      }
    }

    setImportBusy(true);
    setImportError(null);
    try {
      const result = await commitSeriesImport(db, {
        commandId: crypto.randomUUID(),
        datasetId,
        preview,
        seriesReferenceUnitCents: cents,
        priceProvenance: cents !== null ? 'user_confirmed' : null,
      });
      void cacheStyleImages(db, datasetId, Object.values(result.styleIds), { concurrency: 2 });
      const next = await getSeriesViews(db, datasetId);
      setViews(next);
      setActiveSeriesId(result.seriesId);
      setImportStep('idle');
      setImportInput('');
      setPriceText('');
      setPreview(null);
      onSaved('系列导入成功～');
    } catch (reason) {
      setImportError(describeError(reason, '保存失败'));
      onToast('换个英文输入吧～');
    } finally {
      setImportBusy(false);
    }
  }

  return (
    <Sheet title="欢迎新宝宝" onClose={onClose}>
      {!orderOpen ? (
        <div className="import-search">
          <input
            className="field__input"
            value={importInput}
            placeholder="输入系列名称（英文）或粘贴链接"
            inputMode="search"
            onChange={(event) => setImportInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') void runImportSearch();
            }}
          />
          <button
            type="button"
            className="button"
            disabled={importBusy || importInput.trim() === ''}
            onClick={() => void runImportSearch()}
          >
            {importBusy ? '导入中…' : '导入'}
          </button>
        </div>
      ) : null}

      {importStep === 'candidates' ? (
        <div className="stack">
          <ul className="list">
            {candidates.map((candidate) => (
              <li key={candidate.candidateId} className="list__item">
                <button type="button" className="list__button" onClick={() => void chooseCandidate(candidate)}>
                  <span className="list__title">{candidate.title}</span>
                  <span className="list__meta">
                    {candidate.ipName ?? '未知 IP'} · {candidate.region.toUpperCase()}
                  </span>
                </button>
              </li>
            ))}
          </ul>
          <button type="button" className="button button--ghost" onClick={() => setImportStep('idle')}>
            返回
          </button>
          {importError ? <p className="notice notice--error">{importError}</p> : null}
        </div>
      ) : null}

      {importStep === 'preview' && preview ? (
        <div className="stack">
          <div className="preview">
            <p className="preview__title">{preview.name}</p>
            <p className="list__meta">
              {preview.ip.name} · {preview.productKind} · 共 {preview.styles.length} 款
            </p>
          </div>

          <label className="field">
            <span className="field__label">该系列单盒人民币价（可留空）</span>
            <input
              className="field__input"
              inputMode="decimal"
              value={priceText}
              placeholder="例如 69"
              onChange={(event) => setPriceText(event.target.value)}
            />
            <span className="field__hint">填写后，新增购买会默认按此价填入实付。</span>
          </label>

          {preview.warnings.includes('CNY_PRICE_UNAVAILABLE') ? (
            <p className="notice">官方页面不提供人民币价，请自行确认；留空也不影响导入。</p>
          ) : null}

          <div className="row">
            <button type="button" className="button" disabled={importBusy} onClick={() => void saveImport()}>
              {importBusy ? '保存中…' : '保存到图库'}
            </button>
            <button type="button" className="button button--ghost" onClick={() => setImportStep('candidates')}>
              返回
            </button>
          </div>
          {importError ? <p className="notice notice--error">{importError}</p> : null}
        </div>
      ) : null}

      {importStep === 'idle' ? (
        views === null ? (
          <p className="page__hint">正在读取图库…</p>
        ) : views.length === 0 ? (
          <p className="page__hint">图库还是空的，用上方搜索框导入第一个系列。</p>
        ) : (
          <div className="stack">
            {!orderOpen ? (
              <>
                <h3 className="add-section-title">已有系列</h3>
                <div className="series-picker">
                  <button
                    type="button"
                    className="series-picker__trigger"
                    aria-expanded={seriesOpen}
                    onClick={() => setSeriesOpen((open) => !open)}
                  >
                    <span className="series-picker__name">{activeSeries?.series.displayName ?? '选择系列'}</span>
                    {activeSeries && activeSeries.heldTotal > 0 ? (
                      <span className="series-picker__badge">{activeSeries.heldTotal}</span>
                    ) : null}
                    <span className="series-picker__chevron" aria-hidden="true">
                      ▾
                    </span>
                  </button>
                  {seriesOpen ? (
                    <ul className="series-picker__list">
                      {views.map((view) => (
                        <li key={view.series.id}>
                          <button
                            type="button"
                            className={`series-picker__item${
                              view.series.id === activeSeriesId ? ' series-picker__item--active' : ''
                            }`}
                            onClick={() => {
                              selectSeries(view.series.id);
                              setSeriesOpen(false);
                            }}
                          >
                            <span className="series-picker__name">{view.series.displayName}</span>
                            {view.heldTotal > 0 ? (
                              <span className="series-picker__badge">{view.heldTotal}</span>
                            ) : null}
                          </button>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              </>
            ) : null}

            {activeSeries && !orderOpen ? (
              <div className="style-scroll">
                <div className="style-row" ref={styleRowRef} onScroll={updateStyleHint}>
                  {activeSeries.styles.map((entry) => {
                    const isPicked = picked.has(entry.style.id);
                    return (
                      <button
                        key={entry.style.id}
                        type="button"
                        className={`style-card${isPicked ? ' style-card--active' : ''}`}
                        aria-pressed={isPicked}
                        onClick={() => togglePick(entry)}
                      >
                        <div className="style-card__media">
                          <StyleImage
                            url={entry.style.imageUrl}
                            assetId={entry.style.imageAssetId}
                            alt={entry.style.displayName}
                          />
                          {entry.style.isSecret ? <span className="style-card__tag">隐藏</span> : null}
                          {entry.held > 0 ? <span className="style-card__held">×{entry.held}</span> : null}
                          {isPicked ? <span className="style-card__check">✓</span> : null}
                        </div>
                        <span className="style-card__name">{entry.style.displayName}</span>
                      </button>
                    );
                  })}
                </div>
                {styleHint ? (
                  <span className="style-scroll__hint" aria-hidden="true">
                    ›
                  </span>
                ) : null}
              </div>
            ) : null}

            {pickedItems.length > 0 && !orderOpen ? (
              <section className="picked" aria-label="已选款式">
                <header className="picked__header">
                  <strong>
                    已选 {pickedItems.length} 款 · 共 {pickedTotal} 件
                  </strong>
                </header>
                <ul className="picked__list">
                  {pickedItems.map(({ entry, quantity }) => (
                    <li key={entry.style.id} className="picked__row">
                      <span className="picked__name">{entry.style.displayName}</span>
                      <div className="stepper stepper--small">
                        <button
                          type="button"
                          aria-label={`减少 ${entry.style.displayName}`}
                          onClick={() => changePickedQuantity(entry.style.id, -1)}
                        >
                          −
                        </button>
                        <output>{quantity}</output>
                        <button
                          type="button"
                          aria-label={`增加 ${entry.style.displayName}`}
                          onClick={() => changePickedQuantity(entry.style.id, 1)}
                        >
                          ＋
                        </button>
                      </div>
                      <button
                        type="button"
                        className="icon-button"
                        aria-label={`移除 ${entry.style.displayName}`}
                        onClick={() => togglePick(entry)}
                      >
                        ✕
                      </button>
                    </li>
                  ))}
                </ul>
                <button type="button" className="button" onClick={() => setOrderOpen(true)}>
                  下一步：填写订单
                </button>
              </section>
            ) : null}

            {orderOpen && pickedItems.length > 0 ? (
              <OrderForm
                entries={pickedItems}
                onCancel={() => setOrderOpen(false)}
                onSaved={async (message) => {
                  setOrderOpen(false);
                  setPicked(new Map());
                  await reload();
                  onSaved(message);
                  onClose();
                }}
              />
            ) : null}
          </div>
        )
      ) : null}

    </Sheet>
  );
}

function OrderForm({
  entries,
  onCancel,
  onSaved,
}: {
  entries: readonly PickedItem[];
  onCancel: () => void;
  onSaved: (message: string) => void;
}) {
  const { db, datasetId } = useRuntime();

  const unitFor = (item: PickedItem) => resolveReferenceUnitCents(item.entry.style, item.series);
  const entryByStyle = useMemo(
    () => new Map(entries.map((item) => [item.entry.style.id, item] as const)),
    [entries],
  );

  type LineDraft = {
    styleId: string;
    quantity: number;
    source: Source;
    day: string;
    amountText: string;
  };

  const [lines, setLines] = useState<LineDraft[]>(() =>
    entries.map((item) => {
      const unit = unitFor(item);
      return {
        styleId: item.entry.style.id,
        quantity: item.quantity,
        source: 'official' as Source,
        day: toLocalCalendarDay(new Date()),
        amountText: unit === null ? '' : formatCents(unit * item.quantity),
      };
    }),
  );
  const [channel, setChannel] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function patchLine(styleId: string, patch: Partial<Omit<LineDraft, 'styleId'>>) {
    setLines((current) => current.map((line) => (line.styleId === styleId ? { ...line, ...patch } : line)));
  }

  function changeQuantity(styleId: string, delta: number) {
    setLines((current) =>
      current.map((line) => {
        if (line.styleId !== styleId) return line;
        const next = Math.max(1, Math.min(99, line.quantity + delta));
        const item = entryByStyle.get(styleId);
        const unit = item ? unitFor(item) : null;
        const wasAuto =
          unit !== null && (line.amountText === '' || line.amountText === formatCents(unit * line.quantity));
        return { ...line, quantity: next, amountText: wasAuto && unit !== null ? formatCents(unit * next) : line.amountText };
      }),
    );
  }

  function changeSource(styleId: string, source: Source) {
    setLines((current) =>
      current.map((line) => {
        if (line.styleId !== styleId) return line;
        if (source === 'gift') return { ...line, source };
        const item = entryByStyle.get(styleId);
        const unit = item ? unitFor(item) : null;
        const amountText =
          line.amountText.trim() === '' && unit !== null ? formatCents(unit * line.quantity) : line.amountText;
        return { ...line, source, amountText };
      }),
    );
  }

  async function submit() {
    setError(null);

    const parsed: Array<{ line: LineDraft; date: AcquisitionDate; paid: Cents | null; unit: Cents | null }> = [];
    for (const line of lines) {
      let date: AcquisitionDate;
      try {
        date = dayDate(line.day);
      } catch {
        setError('请为每个款式选择有效的购买日期');
        return;
      }
      const item = entryByStyle.get(line.styleId);
      const unit = item ? unitFor(item) : null;
      let paid: Cents | null = null;
      if (line.source !== 'gift') {
        if (line.amountText.trim() === '') {
          setError(`「${item?.entry.style.displayName ?? ''}」请填写实付金额`);
          return;
        }
        try {
          paid = parseCents(line.amountText);
        } catch {
          setError(`「${item?.entry.style.displayName ?? ''}」金额格式不对`);
          return;
        }
      }
      parsed.push({ line, date, paid, unit });
    }

    setBusy(true);
    try {
      for (const { line, date, paid, unit } of parsed) {
        await createAcquisition(db, {
          commandId: crypto.randomUUID(),
          datasetId,
          source: line.source,
          date,
          paidTotalCents: paid,
          channel: channel.trim() === '' ? null : channel.trim(),
          note: note.trim() === '' ? null : note.trim(),
          lines: [
            {
              styleId: line.styleId,
              quantity: line.quantity,
              allocatedCents: paid,
              referenceUnitCentsSnapshot: line.source === 'gift' ? null : unit,
            },
          ],
        });
      }
      const total = lines.reduce((sum, line) => sum + line.quantity, 0);
      onSaved(`共 ${total} 个宝宝已入住 ✨`);
    } catch (reason) {
      setError(describeError(reason, '保存失败，请重试'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="purchase" aria-label="购买信息">
      <header className="purchase__header">
        <button type="button" className="link-button" onClick={onCancel}>
          ← 返回选款
        </button>
        <h3 className="purchase__title">购买信息</h3>
        <button type="button" className="icon-button" onClick={onCancel} aria-label="关闭">
          ✕
        </button>
      </header>

      {lines.map((line) => {
        const item = entryByStyle.get(line.styleId);
        if (!item) return null;
        const unit = unitFor(item);
        return (
          <div className="order-item" key={line.styleId}>
            <div className="order-item__header">
              <strong className="order-item__name">{item.entry.style.displayName}</strong>
              <div className="stepper stepper--small">
                <button
                  type="button"
                  aria-label={`减少 ${item.entry.style.displayName}`}
                  onClick={() => changeQuantity(line.styleId, -1)}
                >
                  −
                </button>
                <output>{line.quantity}</output>
                <button
                  type="button"
                  aria-label={`增加 ${item.entry.style.displayName}`}
                  onClick={() => changeQuantity(line.styleId, 1)}
                >
                  ＋
                </button>
              </div>
            </div>

            <div className="segmented" role="group" aria-label={`${item.entry.style.displayName} 购入来源`}>
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
                  className={`segmented__item${line.source === value ? ' segmented__item--active' : ''}`}
                  onClick={() => changeSource(line.styleId, value)}
                >
                  {label}
                </button>
              ))}
            </div>

            <label className="field">
              <span className="field__label">购买日期</span>
              <input
                className="field__input"
                type="date"
                value={line.day}
                onChange={(event) => patchLine(line.styleId, { day: event.target.value })}
              />
            </label>

            {line.source !== 'gift' ? (
              <label className="field">
                <span className="field__label">实付金额</span>
                <input
                  className="field__input"
                  inputMode="decimal"
                  value={line.amountText}
                  placeholder="例如 69"
                  onChange={(event) => patchLine(line.styleId, { amountText: event.target.value })}
                />
                <span className="field__hint">
                  {unit === null ? '该系列没有参考价，请手动填写。' : `参考价 ¥${formatCents(unit)} / 个`}
                </span>
              </label>
            ) : (
              <p className="field__hint">礼物不记录金额。</p>
            )}
          </div>
        );
      })}

      <details className="more">
        <summary>更多信息</summary>
        <label className="field">
          <span className="field__label">具体渠道（可选）</span>
          <input
            className="field__input"
            value={channel}
            onChange={(event) => setChannel(event.target.value)}
          />
        </label>
        <label className="field">
          <span className="field__label">备注（可选）</span>
          <input
            className="field__input"
            value={note}
            onChange={(event) => setNote(event.target.value)}
          />
        </label>
      </details>

      {error ? <p className="notice notice--error">{error}</p> : null}

      <button type="button" className="button" disabled={busy} onClick={() => void submit()}>
        {busy ? '保存中…' : '保存'}
      </button>
    </section>
  );
}
