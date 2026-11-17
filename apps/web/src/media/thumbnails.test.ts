import { afterEach, describe, expect, it, vi } from 'vitest';
import { readThumbnail, rememberThumbnail, thumbnailUrl } from './thumbnails.js';

afterEach(() => vi.unstubAllGlobals());

describe('display images', () => {
  const source = 'https://prod-global-biz.popmart.com/figure.jpg';
  it('uses small cards by default and preserves full resolution for original views', () => {
    const small = new URL(thumbnailUrl(source)!, 'https://app.example.com');
    expect(small.searchParams.get('src')).toBe(source);
    expect(small.searchParams.get('w')).toBe('384');
    expect(new URL(thumbnailUrl(source, 'original')!, small).searchParams.has('w')).toBe(false);
    expect(thumbnailUrl(null)).toBeNull();
    for (const url of ['blob:local', 'data:image/png;base64,AA', '/local.png', 'https://example.com/x.jpg']) {
      expect(thumbnailUrl(url)).toBe(url);
    }
  });

  it('deduplicates cache writes and reuses loaded HTTP responses', async () => {
    const entries = new Map<string, Response>();
    const cache = {
      match: vi.fn(async (url: string) => entries.get(url)?.clone()),
      put: vi.fn(async (url: string, response: Response) => { entries.set(url, response.clone()); }),
      keys: vi.fn(async () => [...entries.keys()]),
      delete: vi.fn(async (url: string) => entries.delete(url)),
    };
    vi.stubGlobal('caches', { open: async () => cache });
    const fetchImpl = vi.fn(async () => new Response('pixels', { headers: { 'content-type': 'image/webp' } }));
    vi.stubGlobal('fetch', fetchImpl);
    const url = thumbnailUrl(source)!;
    await Promise.all([rememberThumbnail(url), rememberThumbnail(url)]);
    await rememberThumbnail(url);
    expect(fetchImpl).toHaveBeenCalledExactlyOnceWith(url, { cache: 'force-cache' });
    expect(await (await readThumbnail(url))?.text()).toBe('pixels');
    expect(cache.put).toHaveBeenCalledTimes(1);
  });

  it('does not persist failed responses and tolerates unavailable storage', async () => {
    const put = vi.fn();
    vi.stubGlobal('caches', { open: async () => ({ match: async () => undefined, put }) });
    vi.stubGlobal('fetch', vi.fn(async () => new Response('no image', { status: 502 })));
    await rememberThumbnail(thumbnailUrl(source)!);
    expect(put).not.toHaveBeenCalled();
    vi.stubGlobal('caches', { open: async () => { throw new Error('quota'); } });
    expect(await readThumbnail(thumbnailUrl(source)!)).toBeNull();
    await expect(rememberThumbnail(thumbnailUrl(source)!)).resolves.toBeUndefined();
  });
});
