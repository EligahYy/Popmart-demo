/** Display-only thumbnails. Originals remain available for full-image backups. */
export type ImageWidth = 384 | 768 | 'original';
const CACHE_NAME = 'my-popmart-thumbnails-v1';
const MAX_ENTRIES = 512;
const hosts = new Set([
  'prod-global-biz.popmart.com', 'global-static.popmart.com',
  'prod-america-res.popmart.com', 'cdn-global-naus.popmart.com',
]);
const pending = new Map<string, Promise<void>>();

export function thumbnailUrl(source: string | null, width: ImageWidth = 384): string | null {
  if (!source) return null;
  try {
    const url = new URL(source);
    if (url.protocol !== 'https:' || !hosts.has(url.hostname)) return source;
    return `/api/import/image?src=${encodeURIComponent(source)}${width === 'original' ? '' : `&w=${width}`}`;
  } catch { return source; }
}

export async function readThumbnail(url: string): Promise<Blob | null> {
  if (typeof caches === 'undefined' || !url.startsWith('/api/import/image?')) return null;
  try {
    return (await (await caches.open(CACHE_NAME)).match(url))?.blob() ?? null;
  } catch { return null; }
}

/** Called after <img> loads, so force-cache reuses its completed HTTP response. */
export function rememberThumbnail(url: string): Promise<void> {
  if (typeof caches === 'undefined' || !url.startsWith('/api/import/image?')) return Promise.resolve();
  const existing = pending.get(url);
  if (existing) return existing;
  const request = (async () => {
    try {
      const cache = await caches.open(CACHE_NAME);
      if (await cache.match(url)) return;
      const response = await fetch(url, { cache: 'force-cache' });
      if (!response.ok || !response.headers.get('content-type')?.startsWith('image/')) return;
      await cache.put(url, response);
      const keys = await cache.keys();
      for (const key of keys.slice(0, Math.max(0, keys.length - MAX_ENTRIES))) await cache.delete(key);
    } catch { /* Cache failure must not block browsing or saving records. */ }
  })().finally(() => pending.delete(url));
  pending.set(url, request);
  return request;
}
