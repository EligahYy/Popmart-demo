import { useEffect, useState } from 'react';
import { useRuntime } from '../../app/RuntimeProvider.js';
import { cacheStyleImages } from '../../media/cache.js';
import { createBackup } from '../../backup/export.js';
import { inspectBackup, restoreBackup } from '../../backup/restore.js';
import type { BackupInspection } from '../../backup/format.js';
import { Sheet } from '../../components/Sheet.js';
import { getSpaceName } from '../../db/queries.js';
import { createGreetingPoster } from '../../media/greetingPoster.js';
import { setSpaceName } from '../../db/commands.js';
import { describeError } from '../../db/errors.js';
import {
  clearPersonalAssets,
  getPersonalAsset,
  readPersonalBlob,
  savePersonalAsset,
  type PersonalRole,
} from '../../media/personal.js';

export function SettingsPage() {
  const { db, datasetId, sharedVersion } = useRuntime();
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [pending, setPending] = useState<BackupInspection | null>(null);
  const [restoring, setRestoring] = useState(false);
  const [personalPreview, setPersonalPreview] = useState<{ url: string; kind: 'image' | 'video' } | null>(null);
  const [greetingPreview, setGreetingPreview] = useState<{ url: string; kind: 'image' | 'video' } | null>(null);
  const [posterPreview, setPosterPreview] = useState<{ url: string; kind: 'image' | 'video' } | null>(null);
  const [personalVersion, setPersonalVersion] = useState(0);
  const [spaceName, setSpaceNameText] = useState('红彤彤收纳');
  const [savingName, setSavingName] = useState(false);
  const [diagnostics, setDiagnostics] = useState<{
    styles: number;
    acquisitions: number;
    lines: number;
    media: number;
    usageMb: string;
    quotaMb: string;
    sw: string;
  } | null>(null);

  useEffect(() => {
    let cancelled = false;
    getSpaceName(db, datasetId).then((name) => {
      if (!cancelled) setSpaceNameText(name);
    });
    return () => {
      cancelled = true;
    };
  }, [db, datasetId, sharedVersion]);

  useEffect(() => {
    let cancelled = false;
    async function loadDiagnostics() {
      const [styles, acquisitions, lines, media] = await Promise.all([
        db.styles.where({ datasetId }).count(),
        db.acquisitions.where({ datasetId }).count(),
        db.acquisitionLines.where({ datasetId }).count(),
        db.mediaBlobs.where({ datasetId }).count(),
      ]);
      let usageMb = '未知';
      let quotaMb = '未知';
      try {
        const estimate = await navigator.storage.estimate();
        usageMb = ((estimate.usage ?? 0) / 1024 / 1024).toFixed(1);
        quotaMb = ((estimate.quota ?? 0) / 1024 / 1024).toFixed(0);
      } catch {
        /* 某些环境不支持 */
      }
      if (cancelled) return;
      setDiagnostics({
        styles,
        acquisitions,
        lines,
        media,
        usageMb,
        quotaMb,
        sw: navigator.serviceWorker?.controller ? '已接管' : '未接管',
      });
    }
    void loadDiagnostics();
    return () => {
      cancelled = true;
    };
  }, [db, datasetId, sharedVersion, personalVersion]);

  useEffect(() => {
    let cancelled = false;
    const urls: string[] = [];

    async function load(role: PersonalRole, setter: (value: { url: string; kind: 'image' | 'video' } | null) => void) {
      const asset = await getPersonalAsset(db, datasetId, role);
      if (!asset || cancelled) {
        setter(null);
        return;
      }
      const blob = await readPersonalBlob(db, datasetId, asset.assetId);
      if (!blob || cancelled) {
        setter(null);
        return;
      }
      const url = URL.createObjectURL(blob);
      urls.push(url);
      setter({ url, kind: asset.kind });
    }

    void load('idle', setPersonalPreview).catch(() => undefined);
    void load('greeting', setGreetingPreview).catch(() => undefined);
    void load('greetingPoster', setPosterPreview).catch(() => undefined);

    return () => {
      cancelled = true;
      for (const url of urls) URL.revokeObjectURL(url);
    };
  }, [db, datasetId, sharedVersion, personalVersion]);

  async function uploadPersonal(file: File | undefined, role: PersonalRole = 'idle') {
    if (!file) return;
    setBusy(true);
    try {
      await savePersonalAsset(db, datasetId, file, role);
      if (role === 'greeting') {
        const poster = await createGreetingPoster(file).catch(() => null);
        if (poster) await savePersonalAsset(db, datasetId, poster, 'greetingPoster');
      }
      setPersonalVersion((value) => value + 1);
      setStatus(`${role === 'greeting' ? '打招呼视频' : '首页形象'}已保存到${db.shared ? '共享空间' : '本机'}。`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : '保存失败');
    } finally {
      setBusy(false);
    }
  }

  async function removePersonal(role: PersonalRole = 'idle') {
    setBusy(true);
    try {
      await clearPersonalAssets(db, datasetId, role);
      if (role === 'greeting') {
        await clearPersonalAssets(db, datasetId, 'greetingPoster');
        setGreetingPreview(null);
      }
      else setPersonalPreview(null);
      setPersonalVersion((value) => value + 1);
      setStatus(role === 'greeting' ? '已移除打招呼视频。' : '已移除首页形象。');
    } finally {
      setBusy(false);
    }
  }

  async function cacheAllImages() {
    setBusy(true);
    setStatus('正在缓存图片…');
    try {
      const styles = await db.styles.where({ datasetId }).toArray();
      const pendingStyles = styles.filter((style) => style.mediaStatus !== 'cached' && style.imageUrl !== null);
      if (pendingStyles.length === 0) {
        setStatus('所有图片都已缓存。');
        return;
      }
      const result = await cacheStyleImages(
        db,
        datasetId,
        pendingStyles.map((style) => style.id),
        { concurrency: 2 },
      );
      setStatus(`缓存完成：成功 ${result.cached}，跳过 ${result.skipped}，失败 ${result.failed}`);
    } catch {
      setStatus('缓存失败，请稍后重试。');
    } finally {
      setBusy(false);
    }
  }

  async function exportBackup() {
    setBusy(true);
    setStatus('正在生成备份…');
    try {
      const backup = await createBackup(db, datasetId);
      const url = URL.createObjectURL(backup.blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = backup.filename;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      setTimeout(() => URL.revokeObjectURL(url), 30_000);
      setStatus(
        `备份已生成：${backup.manifest.counts.styles ?? 0} 个款式、${
          backup.manifest.counts.acquisitions ?? 0
        } 笔订单${backup.manifest.mediaComplete ? '' : '（部分图片缺失）'}。`,
      );
    } catch (error) {
      setStatus(describeError(error, '导出失败'));
    } finally {
      setBusy(false);
    }
  }

  async function chooseBackup(file: File | undefined) {
    if (!file) return;
    setStatus('正在校验备份…');
    try {
      const inspection = await inspectBackup(await file.arrayBuffer());
      setPending(inspection);
      setStatus(null);
    } catch (error) {
      setStatus(describeError(error, '备份文件无法读取'));
    }
  }

  async function confirmRestore() {
    if (!pending) return;
    setRestoring(true);
    try {
      await restoreBackup(db, pending);
      window.location.reload();
    } catch (error) {
      setStatus(describeError(error, '恢复失败'));
      setRestoring(false);
    }
  }

  return (
    <main className="page">
      <h1 className="page__title">设置</h1>

      {db.shared ? (
        <section className="settings-block">
          <h2 className="settings-block__title">云端共享空间</h2>
          <p className="page__hint">所有访客查看同一份收藏、账本、预算和形象素材。修改会同步给其他访客，已打开的页面约 5 秒更新一次。</p>
        </section>
      ) : null}

      <section className="settings-block">
        <h2 className="settings-block__title">安装到主屏幕</h2>
        <p className="page__hint">
          在 iPhone 上用 Safari 打开本页，点击底部分享按钮，选择「添加到主屏幕」。
        </p>
        <button
          type="button"
          className="button button--ghost"
          onClick={() => {
            localStorage.removeItem('mp-install-dismissed');
            setStatus('已重置，下次打开小窝会再次显示安装提示。');
          }}
        >
          重新显示安装提示
        </button>
      </section>

      <section className="settings-block">
        <h2 className="settings-block__title">版本与更新</h2>
        <p className="page__hint">当前版本：{db.shared ? '云端共享版' : '本机存储版'}</p>
        <button
          type="button"
          className="button button--ghost"
          onClick={async () => {
            try {
              const registrations = await navigator.serviceWorker.getRegistrations();
              await Promise.all(registrations.map((item) => item.unregister()));
              const keys = await caches.keys();
              await Promise.all(keys.map((key) => caches.delete(key)));
            } finally {
              window.location.reload();
            }
          }}
        >
          强制更新（保留收藏数据）
        </button>
        <p className="field__hint">只清理页面缓存，不会删除收藏、账本和备份。</p>
      </section>

      <section className="settings-block">
        <h2 className="settings-block__title">空间名称</h2>
        <p className="page__hint">显示在首页顶部，最多 12 个字符。</p>
        <label className="field">
          <span className="field__label">名称</span>
          <input
            className="field__input"
            value={spaceName}
            maxLength={12}
            onChange={(event) => setSpaceNameText(event.target.value)}
          />
        </label>
        <button
          type="button"
          className="button"
          disabled={savingName}
          onClick={async () => {
            setSavingName(true);
            try {
              await setSpaceName(db, {
                commandId: crypto.randomUUID(),
                datasetId,
                name: spaceName,
              });
              setStatus('空间名称已保存。');
            } catch (error) {
              setStatus(describeError(error, '名称保存失败'));
            } finally {
              setSavingName(false);
            }
          }}
        >
          {savingName ? '保存中…' : '保存名称'}
        </button>
      </section>

      <section className="settings-block">
        <h2 className="settings-block__title">首页形象</h2>
        {greetingPreview ? (
          <>
            <p className="page__hint">
              已自动使用打招呼视频的第一帧作为首页形象，所以点击前后完全一致，不需要再单独上传。
            </p>
            {posterPreview ? (
              <div className="personal-preview">
                <img src={posterPreview.url} alt="首页形象（视频首帧）" />
              </div>
            ) : null}
            <p className="field__hint">
              想换成自己的静态图？需要先移除打招呼视频；或者用那张图重新生成一段图生视频，首帧就会是它。
            </p>
          </>
        ) : (
          <>
            <p className="page__hint">
              {db.shared ? '上传后保存到共享空间，所有访客都能看到。' : '只保存在本机，不上传服务器。'}可以选一张图片，或一段静音循环视频；没有设置时首页显示占位。
            </p>
            {personalPreview ? (
              <div className="personal-preview">
                {personalPreview.kind === 'video' ? (
                  <video src={personalPreview.url} autoPlay muted loop playsInline />
                ) : (
                  <img src={personalPreview.url} alt="首页形象预览" />
                )}
              </div>
            ) : (
              <div className="personal-preview personal-preview--empty">还没有设置</div>
            )}
            <div className="row">
              <label className="button button--ghost file-button">
                选择图片或视频
                <input
                  type="file"
                  accept="image/*,video/*"
                  hidden
                  onChange={(event) => {
                    void uploadPersonal(event.target.files?.[0], 'idle');
                    event.target.value = '';
                  }}
                />
              </label>
              {personalPreview ? (
                <button
                  type="button"
                  className="button button--ghost"
                  disabled={busy}
                  onClick={() => void removePersonal('idle')}
                >
                  移除
                </button>
              ) : null}
            </div>
          </>
        )}
      </section>

      <section className="settings-block">
        <h2 className="settings-block__title">打招呼视频（可选）</h2>
        <p className="page__hint">
          只需要上传这一项：点击首页人物时原地播放，首帧自动成为首页形象，不放大、不遮挡背景。使用提供的 `greeting.mp4` 即可。
        </p>
        {greetingPreview ? (
          <div className="personal-preview">
            {posterPreview ? (
              <img src={posterPreview.url} alt="打招呼首帧（已合成）" />
            ) : (
              <span className="page__hint">已保存，正在生成预览…</span>
            )}
          </div>
        ) : (
          <div className="personal-preview personal-preview--empty">还没有设置</div>
        )}
        <div className="row">
          <label className="button button--ghost file-button">
            选择视频
            <input
              type="file"
              accept="video/*"
              hidden
              onChange={(event) => {
                void uploadPersonal(event.target.files?.[0], 'greeting');
                event.target.value = '';
              }}
            />
          </label>
          {greetingPreview ? (
            <button
              type="button"
              className="button button--ghost"
              disabled={busy}
              onClick={() => void removePersonal('greeting')}
            >
              移除
            </button>
          ) : null}
        </div>
      </section>

      <section className="settings-block">
        <h2 className="settings-block__title">图片与离线</h2>
        <p className="page__hint">收藏图片保存在本机，断网也能查看。</p>
        <button type="button" className="button" disabled={busy} onClick={cacheAllImages}>
          {busy ? '处理中…' : '缓存全部图片'}
        </button>
      </section>

      <section className="settings-block">
        <h2 className="settings-block__title">备份与恢复</h2>
        <p className="page__hint">
          备份包含图库、收藏、账本、预算与已保存图片。{db.shared ? '导出文件保存到你的设备；恢复备份会替换所有访客看到的共享数据。' : '文件由你保存到「文件」等位置，不会上传。'}
        </p>
        <button type="button" className="button" disabled={busy} onClick={exportBackup}>
          {busy ? '处理中…' : '导出备份'}
        </button>

        <label className="button button--ghost file-button">
          恢复备份
          <input
            type="file"
            accept=".zip,application/zip"
            hidden
            onChange={(event) => {
              void chooseBackup(event.target.files?.[0]);
              event.target.value = '';
            }}
          />
        </label>
      </section>

      <section className="settings-block">
        <h2 className="settings-block__title">本机诊断</h2>
        <ul className="order-lines">
          <li className="order-lines__row">
            <span>款式 / 订单 / 明细</span>
            <span>
              {diagnostics ? `${diagnostics.styles} / ${diagnostics.acquisitions} / ${diagnostics.lines}` : '—'}
            </span>
          </li>
          <li className="order-lines__row">
            <span>版本</span>
            <span>{db.shared ? '云端共享版' : '本机存储版'}</span>
          </li>
          <li className="order-lines__row">
            <span>已缓存图片</span>
            <span>{diagnostics ? diagnostics.media : '—'}</span>
          </li>
          <li className="order-lines__row">
            <span>存储占用 / 配额</span>
            <span>{diagnostics ? `${diagnostics.usageMb} MB / ${diagnostics.quotaMb} MB` : '—'}</span>
          </li>
          <li className="order-lines__row">
            <span>Service Worker</span>
            <span>{diagnostics?.sw ?? '—'}</span>
          </li>
        </ul>
        <p className="field__hint">这些数字只来自本机，不会上传。</p>
      </section>

      {status ? <p className="notice">{status}</p> : null}

      {pending ? (
        <Sheet title="恢复备份" onClose={() => setPending(null)}>
          <div className="stack">
            <p className="notice notice--error">
              {db.shared ? '恢复会替换所有访客看到的云端共享数据，且不会合并。建议先导出当前备份。' : '恢复会替换当前全部数据，且不会合并。建议先导出当前备份。'}
            </p>
            <ul className="order-lines">
              <li className="order-lines__row">
                <span>备份时间</span>
                <span>{new Date(pending.manifest.exportedAt).toLocaleString()}</span>
              </li>
              <li className="order-lines__row">
                <span>款式</span>
                <span>{pending.manifest.counts.styles ?? 0}</span>
              </li>
              <li className="order-lines__row">
                <span>订单</span>
                <span>{pending.manifest.counts.acquisitions ?? 0}</span>
              </li>
              <li className="order-lines__row">
                <span>图片</span>
                <span>{pending.media.size}</span>
              </li>
            </ul>
            {pending.manifest.mediaComplete ? null : (
              <p className="notice">备份中部分图片缺失，恢复后这些款式会显示占位。</p>
            )}
            <div className="row">
              <button type="button" className="button button--danger" disabled={restoring} onClick={confirmRestore}>
                {restoring ? '恢复中…' : '确认替换并恢复'}
              </button>
              <button type="button" className="button button--ghost" onClick={() => setPending(null)}>
                取消
              </button>
            </div>
          </div>
        </Sheet>
      ) : null}
    </main>
  );
}
