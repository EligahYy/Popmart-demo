import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { AcquisitionDate } from '@my-popmart/contracts';
import { useRuntime } from '../../app/RuntimeProvider.js';
import { getIdentityCard, type IdentityCardData } from '../../db/queries.js';
import { getTransferableLines, type TransferableLine } from '../../db/ledgerData.js';
import { createTransfer, updateCollectionProfile } from '../../db/commands.js';
import { StyleImage } from '../../components/StyleImage.js';
import { toLocalCalendarDay } from '@my-popmart/contracts';

const SOURCE_LABEL: Record<string, string> = {
  official: '官方购买',
  secondhand: '二手购入',
  gift: '别人赠送',
};

function formatRecordDate(date: AcquisitionDate): string {
  if (date.precision === 'day') return date.day;
  if (date.precision === 'month') return `${date.month} · 具体日期不详`;
  return '日期不详';
}

export function IdentityCard({
  styleId,
  originRect,
  onClose,
  onTransferred,
}: {
  styleId: string;
  originRect?: DOMRect | null;
  onClose: () => void;
  onTransferred?: () => void;
}) {
  const { db, datasetId } = useRuntime();
  const cardRef = useRef<HTMLElement | null>(null);
  const [data, setData] = useState<IdentityCardData | null>(null);
  const [flipped, setFlipped] = useState(false);
  const [transferOpen, setTransferOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [nicknameText, setNicknameText] = useState('');
  const [storyText, setStoryText] = useState('');
  const [savingProfile, setSavingProfile] = useState(false);
  const [profileError, setProfileError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getIdentityCard(db, datasetId, styleId).then((value) => {
      if (!cancelled) setData(value);
    });
    return () => {
      cancelled = true;
    };
  }, [db, datasetId, styleId]);

  useLayoutEffect(() => {
    const el = cardRef.current;
    if (!el || !originRect) return;
    const target = el.getBoundingClientRect();
    const dx = originRect.left + originRect.width / 2 - (target.left + target.width / 2);
    const dy = originRect.top + originRect.height / 2 - (target.top + target.height / 2);
    const scale = Math.max(0.18, Math.min(1, originRect.width / Math.max(target.width, 1)));
    const animation = el.animate(
      [
        { transform: `translate(${dx}px, ${dy}px) scale(${scale}) rotateY(-85deg)`, opacity: 0.2 },
        { transform: 'translate(0px, 0px) scale(1) rotateY(0deg)', opacity: 1 },
      ],
      { duration: 430, easing: 'cubic-bezier(0.2, 0.7, 0.3, 1)' },
    );
    return () => animation.cancel();
  }, [originRect]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKeyDown);
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previous;
    };
  }, [onClose]);

  return (
    <div className="card-backdrop" role="presentation" onClick={onClose}>
      <section
        ref={cardRef}
        className="identity"
        role="dialog"
        aria-modal="true"
        aria-label={data ? `${data.style.displayName} 身份卡` : '身份卡'}
        onClick={(event) => event.stopPropagation()}
      >
        <header className="identity__header">
          <span className="identity__no">{data?.profile?.collectionNo ?? '—'}</span>
          <button type="button" className="icon-button" onClick={onClose} aria-label="关闭身份卡">
            ✕
          </button>
        </header>

        {!data ? (
          <p className="page__hint">正在打开身份卡…</p>
        ) : (
          <>
            <div
              className={`identity-flip${flipped ? ' identity-flip--flipped' : ''}`}
              role="button"
              tabIndex={0}
              aria-label={flipped ? '查看正面' : '查看背面'}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  setFlipped((value) => !value);
                }
              }}
            >
              <div className="identity__face identity__face--front" onClick={() => setFlipped(true)}>
                <div className="identity__media">
                  <StyleImage
                    url={data.style.imageUrl}
                    assetId={data.style.imageAssetId}
                    alt={data.style.displayName}
                    loading="eager"
                  />
                </div>
                <h3 className="identity__name">{data.style.displayName}</h3>
                {data.profile?.nickname ? (
                  <p className="identity__nickname">小名：{data.profile.nickname}</p>
                ) : null}
                <p className="identity__series">
                  {data.series.displayName} · <span className="nowrap">当前 {data.held} 只</span>
                </p>
              </div>

              <div className="identity__face identity__face--back" onClick={() => setFlipped(false)}>
                <h3 className="identity__name">{data.style.displayName}</h3>
                <dl className="identity__facts">
                  <div>
                    <dt>IP</dt>
                    <dd>{data.ip?.displayName ?? '未知'}</dd>
                  </div>
                  <div>
                    <dt>系列</dt>
                    <dd>{data.series.displayName}</dd>
                  </div>
                  <div>
                    <dt>当前拥有</dt>
                    <dd>{data.held} 只</dd>
                  </div>
                </dl>

                {editing ? (
                  <div className="stack" onClick={(event) => event.stopPropagation()}>
                    <label className="field">
                      <span className="field__label">小名</span>
                      <input
                        className="field__input"
                        value={nicknameText}
                        maxLength={30}
                        onChange={(event) => setNicknameText(event.target.value)}
                      />
                    </label>
                    <label className="field">
                      <span className="field__label">收藏故事</span>
                      <textarea
                        className="field__input"
                        rows={3}
                        maxLength={500}
                        value={storyText}
                        onChange={(event) => setStoryText(event.target.value)}
                      />
                    </label>
                    {profileError ? <p className="notice notice--error">{profileError}</p> : null}
                    <div className="row">
                      <button
                        type="button"
                        className="button"
                        disabled={savingProfile}
                        onClick={async () => {
                          setSavingProfile(true);
                          setProfileError(null);
                          try {
                            await updateCollectionProfile(db, {
                              commandId: crypto.randomUUID(),
                              datasetId,
                              styleId,
                              nickname: nicknameText.trim() === '' ? null : nicknameText.trim(),
                              story: storyText.trim() === '' ? null : storyText.trim(),
                            });
                            const next = await getIdentityCard(db, datasetId, styleId);
                            setData(next);
                            setEditing(false);
                          } catch (error) {
                            setProfileError(error instanceof Error ? error.message : '保存失败');
                          } finally {
                            setSavingProfile(false);
                          }
                        }}
                      >
                        {savingProfile ? '保存中…' : '保存'}
                      </button>
                      <button type="button" className="button button--ghost" onClick={() => setEditing(false)}>
                        取消
                      </button>
                    </div>
                  </div>
                ) : null}

                <h4 className="identity__section">获取记录</h4>
                {data.records.length === 0 ? (
                  <p className="list__meta">暂无记录</p>
                ) : (
                  <ul className="identity__records">
                    {data.records.map((record, index) => (
                      <li key={`${record.date.precision}-${index}`}>
                        <span>{formatRecordDate(record.date)}</span>
                        <span className="identity__record-meta">
                          {SOURCE_LABEL[record.source] ?? record.source}
                          {record.channel ? ` · ${record.channel}` : ''} · ×{record.quantity}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}

                {!editing && data.profile?.story ? (
                  <>
                    <h4 className="identity__section">收藏故事</h4>
                    <p className="identity__story">{data.profile.story}</p>
                  </>
                ) : null}

                {!editing ? (
                  <button
                    type="button"
                    className="link-button identity__edit"
                    onClick={(event) => {
                      event.stopPropagation();
                      setNicknameText(data.profile?.nickname ?? '');
                      setStoryText(data.profile?.story ?? '');
                      setProfileError(null);
                      setEditing(true);
                    }}
                  >
                    编辑小名与故事
                  </button>
                ) : null}
              </div>
            </div>

            <p className="identity__hint">{flipped ? '点击卡片查看正面' : '点击卡片查看背面'}</p>

            <footer className="identity__footer">
              <button type="button" className="button" onClick={() => setTransferOpen(true)}>
                送出／售出
              </button>
            </footer>
          </>
        )}

        {transferOpen ? (
          <TransferSheet
            styleId={styleId}
            onClose={() => setTransferOpen(false)}
            onDone={() => {
              setTransferOpen(false);
              onClose();
              onTransferred?.();
            }}
          />
        ) : null}
      </section>
    </div>
  );
}

function TransferSheet({
  styleId,
  onClose,
  onDone,
}: {
  styleId: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const { db, datasetId } = useRuntime();
  const [lines, setLines] = useState<TransferableLine[] | null>(null);
  const [lineId, setLineId] = useState('');
  const [kind, setKind] = useState<'give_away' | 'sold'>('give_away');
  const [quantity, setQuantity] = useState(1);
  const [day, setDay] = useState(() => toLocalCalendarDay(new Date()));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getTransferableLines(db, datasetId, styleId).then((rows) => {
      if (cancelled) return;
      setLines(rows);
      setLineId(rows[0]?.lineId ?? '');
    });
    return () => {
      cancelled = true;
    };
  }, [db, datasetId, styleId]);

  const selected = lines?.find((line) => line.lineId === lineId) ?? null;
  const held = selected?.held ?? 0;

  async function submit() {
    if (!selected) {
      setError('没有可转出的批次');
      return;
    }
    if (quantity < 1 || quantity > held) {
      setError(`数量需在 1–${held} 之间`);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await createTransfer(db, {
        commandId: crypto.randomUUID(),
        datasetId,
        kind,
        occurredOn: day,
        lines: [{ lineId: selected.lineId, quantity }],
      });
      onDone();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '保存失败');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card-backdrop" role="presentation" onClick={onClose}>
      <section
        className="identity identity--sheet"
        role="dialog"
        aria-modal="true"
        aria-label="送出或售出"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="identity__header">
          <h3 className="purchase__title">送出／售出</h3>
          <button type="button" className="icon-button" onClick={onClose} aria-label="关闭">
            ✕
          </button>
        </header>

        {!lines ? <p className="page__hint">正在读取批次…</p> : null}

        {lines && lines.length === 0 ? (
          <p className="page__hint">这款当前没有可转出的批次。</p>
        ) : null}

        {lines && lines.length > 0 ? (
          <div className="stack">
            <div className="segmented" role="group" aria-label="转出方式">
              <button
                type="button"
                className={`segmented__item${kind === 'give_away' ? ' segmented__item--active' : ''}`}
                onClick={() => setKind('give_away')}
              >
                送出
              </button>
              <button
                type="button"
                className={`segmented__item${kind === 'sold' ? ' segmented__item--active' : ''}`}
                onClick={() => setKind('sold')}
              >
                售出
              </button>
            </div>

            {lines.length > 1 ? (
              <label className="field">
                <span className="field__label">来源批次</span>
                <select
                  className="field__input"
                  value={lineId}
                  onChange={(event) => {
                    setLineId(event.target.value);
                    setQuantity(1);
                  }}
                >
                  {lines.map((line) => (
                    <option key={line.lineId} value={line.lineId}>
                      {line.date || '日期不详'} · 持有 {line.held}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}

            <div className="field-row">
              <span className="field__label">数量（最多 {held}）</span>
              <div className="stepper">
                <button type="button" aria-label="减少" onClick={() => setQuantity((value) => Math.max(1, value - 1))}>
                  −
                </button>
                <output>{quantity}</output>
                <button
                  type="button"
                  aria-label="增加"
                  onClick={() => setQuantity((value) => Math.min(held, value + 1))}
                >
                  ＋
                </button>
              </div>
            </div>

            <label className="field">
              <span className="field__label">日期</span>
              <input className="field__input" type="date" value={day} onChange={(event) => setDay(event.target.value)} />
            </label>

            <p className="field__hint">送出／售出不记录金额，只改变持有数量；历史购买记录保留。</p>
            {error ? <p className="notice notice--error">{error}</p> : null}
            <button type="button" className="button" disabled={busy} onClick={submit}>
              {busy ? '保存中…' : '确认'}
            </button>
          </div>
        ) : null}
      </section>
    </div>
  );
}
