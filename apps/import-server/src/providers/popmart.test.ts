import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import {
  ImportError,
  buildPreview,
  createPopmartProvider,
  extractNextData,
} from './popmart.js';
import { signToken } from '../security/sign.js';

const fixture = readFileSync(
  fileURLToPath(new URL('./__fixtures__/popmart-product-9120.html', import.meta.url)),
  'utf8',
);
const aliasesPath = fileURLToPath(new URL('../../data/aliases.zh.json', import.meta.url));

function providerWith(html = fixture, extra: Partial<Parameters<typeof createPopmartProvider>[0]> = {}) {
  const fetchImpl = vi.fn(async () => new Response(html, { status: 200, headers: { 'content-type': 'text/html' } }));
  const provider = createPopmartProvider({
    signingSecret: 'test-secret',
    fetchImpl: fetchImpl as unknown as typeof fetch,
    aliasesPath,
    ...extra,
  });
  return { provider, fetchImpl };
}

describe('extractNextData', () => {
  it('reads __NEXT_DATA__ from the page', () => {
    const data = extractNextData(fixture) as { buildId?: string };
    expect(typeof data.buildId).toBe('string');
    expect((data.buildId ?? '').length).toBeGreaterThan(0);
  });

  it('reports SOURCE_CHANGED instead of inventing data', () => {
    expect(() => extractNextData('<html><body>no data</body></html>')).toThrowError(ImportError);
    try {
      extractNextData('<html></html>');
    } catch (error) {
      expect((error as ImportError).code).toBe('SOURCE_CHANGED');
    }
  });
});

describe('buildPreview', () => {
  const preview = buildPreview(
    extractNextData(fixture),
    {
      region: 'ca',
      spuId: '9120',
      sourceUrl: 'https://www.popmart.com/ca/products/9120',
      fetchedAt: '2026-11-12T00:00:00.000Z',
    },
    { signMedia: (url) => `token:${url}` },
  );

  it('reads title, IP and all 13 styles', () => {
    expect(preview.name).toBe('Twinkle Twinkle Live the Ordinary Series Figures');
    expect(preview.ip.name).toBe('Twinkle Twinkle');
    expect(preview.styles).toHaveLength(13);
    expect(preview.productKind).toBe('figure');
  });

  it('marks the secret style and keeps stable keys', () => {
    const secret = preview.styles.filter((style) => style.isSecret);
    expect(secret).toHaveLength(1);
    expect(secret[0]?.name).toContain('Secret');
    expect(new Set(preview.styles.map((style) => style.canonicalKey)).size).toBe(13);
  });

  it('never invents a CNY price', () => {
    expect(preview.seriesReferenceUnitCents).toBeNull();
    expect(preview.priceProvenance).toBeNull();
    expect(preview.styles.every((style) => style.referenceUnitCents === null)).toBe(true);
    expect(preview.warnings).toContain('PRICE_UNVERIFIED');
    expect(preview.warnings).toContain('CNY_PRICE_UNAVAILABLE');
  });
});

describe('classify', () => {
  const { provider } = providerWith();

  it('recognises official links, mini program text and junk', () => {
    expect(provider.classify('https://www.popmart.com/ca/products/9120')).toBe('web_url');
    expect(provider.classify('#小程序://泡泡玛特/sk1pjoosexHRwAd')).toBe('miniapp_text');
    expect(provider.classify('随便一段文字')).toBe('invalid');
  });
});

describe('resolve', () => {
  it('turns a product link into one candidate', async () => {
    const { provider, fetchImpl } = providerWith();
    const candidates = await provider.resolve(
      'https://www.popmart.com/ca/products/9120/twinkle-twinkle-live-the-ordinary-series-figures',
    );
    expect(fetchImpl).toHaveBeenCalled();
    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.title).toContain('Live the Ordinary');
    expect(candidates[0]?.ipName).toBe('Twinkle Twinkle');
    expect(candidates[0]?.candidateId).not.toBe('');
  });

  it('refuses mini program codes with an explicit reason', async () => {
    const { provider } = providerWith();
    await expect(provider.resolve('#小程序://泡泡玛特/sk1pjoosexHRwAd')).rejects.toMatchObject({
      code: 'MINIAPP_UNRESOLVED',
    });
  });

  it('refuses non-official hosts', async () => {
    const { provider } = providerWith();
    await expect(provider.resolve('https://example.com/ca/products/9120')).rejects.toMatchObject({
      code: 'INVALID_INPUT',
    });
  });

  it('refuses unsupported paths on the official host', async () => {
    const { provider } = providerWith();
    await expect(provider.resolve('https://www.popmart.com/ca/about')).rejects.toMatchObject({
      code: 'UNSUPPORTED_SOURCE',
    });
  });
});

describe('search', () => {
  it('finds the verified series by Chinese alias', async () => {
    const { provider } = providerWith();
    const results = await provider.search('好好生活');
    expect(results[0]?.canonicalKey).toBe('popmart:ca:9120');
    expect(results[0]?.matchReason).toBe('alias');
  });

  it('returns NO_MATCH when nothing matches', async () => {
    const { provider } = providerWith('<html><body>empty sitemap</body></html>');
    await expect(provider.search('不存在的系列名')).rejects.toMatchObject({ code: 'NO_MATCH' });
  });

  it('reports a source failure when sitemap is unavailable and no alias matches', async () => {
    const { provider } = providerWith(fixture, {
      fetchImpl: vi.fn(async () => { throw new Error('network down'); }),
    });
    await expect(provider.search('不存在的系列名')).rejects.toMatchObject({
      code: 'SOURCE_UNAVAILABLE',
      retryable: true,
    });
  });

  it('keeps alias results when sitemap is unavailable', async () => {
    const { provider } = providerWith(fixture, {
      fetchImpl: vi.fn(async () => { throw new Error('network down'); }),
    });
    const results = await provider.search('好好生活');
    expect(results[0]?.canonicalKey).toBe('popmart:ca:9120');
  });
});

describe('preview token', () => {
  it('rejects a tampered candidate id', async () => {
    const { provider } = providerWith();
    const candidateId = signToken({ v: 1, region: 'ca', spuId: '9120' }, 'test-secret');
    await expect(provider.preview(`${candidateId}x`)).rejects.toMatchObject({ code: 'TOKEN_INVALID' });
  });

  it('returns preview for a valid candidate id', async () => {
    const { provider } = providerWith();
    const candidateId = signToken({ v: 1, region: 'ca', spuId: '9120' }, 'test-secret');
    const preview = await provider.preview(candidateId);
    expect(preview.styles).toHaveLength(13);
    expect(preview.candidateId).toBe(candidateId);
  });
});

describe('media', () => {
  it('follows redirects between media hosts while rejecting redirects off the allowlist', async () => {
    const fetchImpl = vi.fn(async (input: string | URL | Request) => String(input).includes('/start.jpg')
      ? new Response(null, { status: 302, headers: { location: 'https://global-static.popmart.com/final.jpg' } })
      : new Response(new Uint8Array([1]), { headers: { 'content-type': 'image/jpeg' } }));
    const { provider } = providerWith(fixture, { fetchImpl });
    await expect(provider.imageByUrl('https://prod-global-biz.popmart.com/start.jpg')).resolves.toMatchObject({ contentType: 'image/jpeg' });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    fetchImpl.mockClear();
    fetchImpl.mockImplementation(async () => new Response(null, { status: 302, headers: { location: 'https://evil.example.com/private.jpg' } }));
    await expect(provider.imageByUrl('https://prod-global-biz.popmart.com/start.jpg')).rejects.toMatchObject({ code: 'UNSUPPORTED_SOURCE' });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('does not add OSS parameters to CDNs without verified support', async () => {
    const fetchImpl = vi.fn(async (_input: string | URL | Request) => new Response(new Uint8Array([1]), { headers: { 'content-type': 'image/jpeg' } }));
    const { provider } = providerWith(fixture, { fetchImpl });
    const source = 'https://global-static.popmart.com/x.jpg';
    await provider.imageByUrl(source, 384);
    expect(fetchImpl.mock.calls[0]?.[0]).toBe(source);
  });

  it('rejects an expired token', async () => {
    const { provider } = providerWith();
    const token = signToken(
      { v: 1, u: 'https://prod-global-biz.popmart.com/x.jpg', e: Date.now() - 1000 },
      'test-secret',
    );
    await expect(provider.media(token)).rejects.toMatchObject({ code: 'TOKEN_INVALID' });
  });

  it('rejects media hosts outside the whitelist', async () => {
    const { provider } = providerWith();
    const token = signToken(
      { v: 1, u: 'https://evil.example.com/x.jpg', e: Date.now() + 60_000 },
      'test-secret',
    );
    await expect(provider.media(token)).rejects.toBeInstanceOf(Error);
  });
});
