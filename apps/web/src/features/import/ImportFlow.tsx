import { useState } from 'react';
import type { SeriesCandidate, SeriesPreview } from '@my-popmart/contracts';
import { parseCents } from '@my-popmart/contracts';
import { fetchPreview, resolveLink, searchSeries } from '../../api/import.js';
import { Sheet } from '../../components/Sheet.js';
import { useRuntime } from '../../app/RuntimeProvider.js';
import { commitSeriesImport } from '../../db/commands.js';
import { describeError } from '../../db/errors.js';

type Step = 'input' | 'candidates' | 'preview';

export function ImportFlow({ onClose, onImported }: { onClose: () => void; onImported: (seriesId: string) => void }) {
  const { db, datasetId } = useRuntime();
  const [step, setStep] = useState<Step>('input');
  const [input, setInput] = useState('');
  const [candidates, setCandidates] = useState<SeriesCandidate[]>([]);
  const [preview, setPreview] = useState<SeriesPreview | null>(null);
  const [priceText, setPriceText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hint, setHint] = useState<string | null>(null);

  async function runResolve() {
    setBusy(true);
    setError(null);
    setHint(null);
    try {
      const result = await resolveLink(input.trim());
      if (result === 'needs_name') {
        setHint('小程序分享码无法直接解析，请改用系列名称搜索。');
        return;
      }
      if (result.length === 0) {
        setHint('没有找到候选，请换个链接或名称。');
        return;
      }
      setCandidates(result);
      setStep('candidates');
    } catch (reason) {
      setError(describeError(reason, '解析失败'));
    } finally {
      setBusy(false);
    }
  }

  async function runSearch() {
    setBusy(true);
    setError(null);
    setHint(null);
    try {
      const result = await searchSeries(input.trim());
      setCandidates(result);
      setStep('candidates');
    } catch (reason) {
      setError(describeError(reason, '搜索失败'));
    } finally {
      setBusy(false);
    }
  }

  async function choose(candidate: SeriesCandidate) {
    setBusy(true);
    setError(null);
    try {
      const value = await fetchPreview(candidate.candidateId);
      setPreview(value);
      setStep('preview');
    } catch (reason) {
      setError(describeError(reason, '读取预览失败'));
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    if (!preview) return;
    let cents: number | null = null;
    if (priceText.trim() !== '') {
      try {
        cents = parseCents(priceText);
      } catch {
        setError('价格请填写数字，最多两位小数');
        return;
      }
    }

    setBusy(true);
    setError(null);
    try {
      const result = await commitSeriesImport(db, {
        commandId: crypto.randomUUID(),
        datasetId,
        preview,
        seriesReferenceUnitCents: cents,
        priceProvenance: cents !== null ? 'user_confirmed' : null,
      });
      onImported(result.seriesId);
    } catch (reason) {
      setError(describeError(reason, '保存失败'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet title="导入新系列" onClose={onClose}>
      {step === 'input' ? (
        <div className="stack">
          <label className="field">
            <span className="field__label">官方商品链接或系列名称</span>
            <textarea
              className="field__input"
              rows={3}
              value={input}
              placeholder="https://www.popmart.com/... 或 “好好生活”"
              onChange={(event) => setInput(event.target.value)}
            />
          </label>
          <div className="row">
            <button type="button" className="button" disabled={busy || input.trim() === ''} onClick={runResolve}>
              解析链接
            </button>
            <button
              type="button"
              className="button button--ghost"
              disabled={busy || input.trim() === ''}
              onClick={runSearch}
            >
              按名称搜索
            </button>
          </div>
          {hint ? <p className="notice">{hint}</p> : null}
          {error ? <p className="notice notice--error">{error}</p> : null}
        </div>
      ) : null}

      {step === 'candidates' ? (
        <div className="stack">
          <ul className="list">
            {candidates.map((candidate) => (
              <li key={candidate.candidateId} className="list__item">
                <button type="button" className="list__button" onClick={() => choose(candidate)}>
                  <span className="list__title">{candidate.title}</span>
                  <span className="list__meta">
                    {candidate.ipName ?? '未知 IP'} · {candidate.region.toUpperCase()}
                  </span>
                </button>
              </li>
            ))}
          </ul>
          <button type="button" className="button button--ghost" onClick={() => setStep('input')}>
            返回
          </button>
          {error ? <p className="notice notice--error">{error}</p> : null}
        </div>
      ) : null}

      {step === 'preview' && preview ? (
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
            <button type="button" className="button" disabled={busy} onClick={save}>
              {busy ? '保存中…' : '保存到图库'}
            </button>
            <button type="button" className="button button--ghost" onClick={() => setStep('candidates')}>
              返回
            </button>
          </div>
          {error ? <p className="notice notice--error">{error}</p> : null}
        </div>
      ) : null}
    </Sheet>
  );
}

