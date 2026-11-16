import { nowIso, type PopmartDb } from '../db/database.js';
import { sha256Hex } from './hash.js';

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

export type CacheResult =
  | { readonly status: 'cached'; readonly hash: string }
  | { readonly status: 'skipped'; readonly hash: string }
  | { readonly status: 'failed'; readonly reason: string };

/**
 * 把款式图片下载为本机 Blob：先取字节、算 hash，再进短事务写入，
 * 事务里不做网络与哈希，避免 Dexie 事务提前结束。
 */
export async function cacheStyleImage(
  db: PopmartDb,
  datasetId: string,
  styleId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<CacheResult> {
  const style = await db.styles.get([datasetId, styleId]);
  if (!style) return { status: 'failed', reason: '款式不存在' };
  if (style.mediaStatus === 'cached' && style.imageAssetId) {
    return { status: 'skipped', hash: style.imageAssetId };
  }
  if (!style.imageUrl) return { status: 'failed', reason: '没有图片地址' };

  let blob: Blob;
  let mime: string;
  let hash: string;
  try {
    // CDN 对浏览器 fetch 不返回 CORS 头，走同源媒体代理取字节。
    const proxyUrl = `/api/import/image?src=${encodeURIComponent(style.imageUrl)}`;
    const response = await fetchImpl(proxyUrl);
    if (!response.ok) return { status: 'failed', reason: `HTTP ${response.status}` };
    mime = response.headers.get('content-type') ?? 'image/jpeg';
    if (!mime.startsWith('image/')) return { status: 'failed', reason: '不是图片' };
    blob = await response.blob();
    if (blob.size > MAX_IMAGE_BYTES) return { status: 'failed', reason: '图片超过大小限制' };
    hash = await sha256Hex(await blob.arrayBuffer());
  } catch (error) {
    return { status: 'failed', reason: error instanceof Error ? error.message : '下载失败' };
  }

  const timestamp = nowIso();
  await db.transaction('rw', [db.assets, db.mediaBlobs, db.styles], async () => {
    await db.mediaBlobs.put({ datasetId, id: hash, blob });
    await db.assets.put({
      datasetId,
      id: hash,
      createdAt: timestamp,
      updatedAt: timestamp,
      revision: 1,
      hash,
      mime,
      byteLength: blob.size,
      kind: 'style_image',
      sourceUrl: style.imageUrl ?? null,
      ownerType: 'style',
      ownerId: styleId,
      status: 'ready',
    });
    const current = await db.styles.get([datasetId, styleId]);
    if (!current) return;
    await db.styles.put({
      ...current,
      imageAssetId: hash,
      mediaStatus: 'cached',
      updatedAt: timestamp,
      revision: current.revision + 1,
    });
  });

  return { status: 'cached', hash };
}

/** 批量缓存，控制并发，避免一次打满网络与主线程。 */
export async function cacheStyleImages(
  db: PopmartDb,
  datasetId: string,
  styleIds: readonly string[],
  options: { concurrency?: number; fetchImpl?: typeof fetch } = {},
): Promise<{ cached: number; failed: number; skipped: number }> {
  const concurrency = Math.max(1, options.concurrency ?? 2);
  const queue = [...styleIds];
  const result = { cached: 0, failed: 0, skipped: 0 };

  async function worker(): Promise<void> {
    for (;;) {
      const styleId = queue.shift();
      if (!styleId) return;
      const outcome = await cacheStyleImage(db, datasetId, styleId, options.fetchImpl ?? fetch);
      if (outcome.status === 'cached') result.cached += 1;
      else if (outcome.status === 'skipped') result.skipped += 1;
      else result.failed += 1;
    }
  }

  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  return result;
}

export async function readStyleImage(
  db: PopmartDb,
  datasetId: string,
  assetId: string,
): Promise<Blob | null> {
  const row = await db.mediaBlobs.get([datasetId, assetId]);
  return row?.blob ?? null;
}
