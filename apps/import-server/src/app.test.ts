import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { buildApp } from './buildApp.js';

const fixture = readFileSync(
  fileURLToPath(new URL('./providers/__fixtures__/popmart-product-9120.html', import.meta.url)),
  'utf8',
);
const aliasesPath = fileURLToPath(new URL('../data/aliases.zh.json', import.meta.url));

function makeApp() {
  const fetchImpl = vi.fn(async () => new Response(fixture, { status: 200, headers: { 'content-type': 'text/html' } }));
  return buildApp({
    signingSecret: 'test-secret',
    fetchImpl: fetchImpl as unknown as typeof fetch,
    aliasesPath,
  });
}

afterAll(async () => {
  // nothing to clean up
});

describe('import API', () => {
  it('reports health', async () => {
    const app = makeApp();
    const response = await app.inject({ method: 'GET', url: '/api/health' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ status: 'ok' });
    await app.close();
  });

  it('returns needs_name for mini program text', async () => {
    const app = makeApp();
    const response = await app.inject({
      method: 'POST',
      url: '/api/import/resolve',
      payload: { input: '#小程序://泡泡玛特/sk1pjoosexHRwAd' },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ status: 'needs_name' });
    await app.close();
  });

  it('validates request bodies', async () => {
    const app = makeApp();
    const response = await app.inject({
      method: 'POST',
      url: '/api/import/resolve',
      payload: { input: '' },
    });
    expect(response.statusCode).toBe(400);
    await app.close();
  });

  it('resolves a product link then returns its preview', async () => {
    const app = makeApp();
    const resolved = await app.inject({
      method: 'POST',
      url: '/api/import/resolve',
      payload: { input: 'https://www.popmart.com/ca/products/9120' },
    });
    expect(resolved.statusCode).toBe(200);
    const body = resolved.json() as { status: string; candidates: Array<{ candidateId: string }> };
    expect(body.status).toBe('candidates');
    expect(body.candidates).toHaveLength(1);

    const preview = await app.inject({
      method: 'POST',
      url: '/api/import/preview',
      payload: { candidateId: body.candidates[0]?.candidateId },
    });
    expect(preview.statusCode).toBe(200);
    const previewBody = preview.json() as { styles: unknown[]; warnings: string[] };
    expect(previewBody.styles).toHaveLength(13);
    expect(previewBody.warnings).toContain('PRICE_UNVERIFIED');
    await app.close();
  });

  it('searches by alias and rejects unknown candidates', async () => {
    const app = makeApp();
    const search = await app.inject({
      method: 'POST',
      url: '/api/import/search',
      payload: { query: '好好生活' },
    });
    expect(search.statusCode).toBe(200);
    expect((search.json() as { candidates: unknown[] }).candidates.length).toBeGreaterThan(0);

    const preview = await app.inject({
      method: 'POST',
      url: '/api/import/preview',
      payload: { candidateId: 'tampered-token-value' },
    });
    expect(preview.statusCode).toBe(400);
    expect(preview.json()).toMatchObject({ code: 'TOKEN_INVALID' });
    await app.close();
  });

  it('returns structured errors for unavailable sources', async () => {
    const app = buildApp({
      signingSecret: 'test-secret',
      fetchImpl: (async () => {
        throw new Error('network down');
      }) as unknown as typeof fetch,
      aliasesPath,
    });
    const response = await app.inject({
      method: 'POST',
      url: '/api/import/resolve',
      payload: { input: 'https://www.popmart.com/ca/products/9120' },
    });
    expect(response.statusCode).toBe(422);
    expect(response.json()).toMatchObject({ code: 'SOURCE_UNAVAILABLE', retryable: true });
    await app.close();
  });
});

describe('image proxy', () => {
  it.each(['384', '768'])('requests a %spx WebP and caches it at the CDN', async (width) => {
    const fetchImpl = vi.fn(async (_input: string | URL | Request) => new Response(new Uint8Array([1, 2]), {
      headers: { 'content-type': 'image/webp' },
    }));
    const app = buildApp({ signingSecret: 'test-secret', fetchImpl, aliasesPath });
    try {
      const src = encodeURIComponent('https://prod-global-biz.popmart.com/x.jpg?keep=1');
      const response = await app.inject(`/api/import/image?src=${src}&w=${width}`);
      expect(response.statusCode).toBe(200);
      const upstream = new URL(String(fetchImpl.mock.calls[0]?.[0]));
      expect(upstream.searchParams.get('x-oss-process')).toBe(`image/resize,w_${width},limit_1/quality,q_80/format,webp`);
      expect(upstream.searchParams.get('keep')).toBe('1');
      expect(response.headers['cache-control']).toContain('immutable');
      expect(response.headers['vercel-cdn-cache-control']).toContain('max-age=604800');
    } finally { await app.close(); }
  });

  it('leaves originals untouched and rejects unsupported thumbnail sizes', async () => {
    const fetchImpl = vi.fn(async (_input: string | URL | Request) => new Response(new Uint8Array([1]), {
      headers: { 'content-type': 'image/jpeg' },
    }));
    const app = buildApp({ signingSecret: 'test-secret', fetchImpl, aliasesPath });
    try {
      const original = 'https://prod-global-biz.popmart.com/original.jpg';
      const src = encodeURIComponent(original);
      expect((await app.inject(`/api/import/image?src=${src}`)).statusCode).toBe(200);
      expect(fetchImpl.mock.calls[0]?.[0]).toBe(original);
      expect((await app.inject(`/api/import/image?src=${src}&w=99999`)).statusCode).toBe(400);
      expect(fetchImpl).toHaveBeenCalledTimes(1);
    } finally { await app.close(); }
  });

  it('returns image bytes from an allowlisted host', async () => {
    const imageBytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]);
    const app = buildApp({
      signingSecret: 'test-secret',
      fetchImpl: (async () =>
        new Response(imageBytes, { status: 200, headers: { 'content-type': 'image/jpeg' } })) as unknown as typeof fetch,
      aliasesPath,
    });
    const src = encodeURIComponent('https://prod-global-biz.popmart.com/x.jpg');
    const response = await app.inject({ method: 'GET', url: `/api/import/image?src=${src}` });
    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('image/jpeg');
    expect(response.rawPayload.byteLength).toBe(imageBytes.byteLength);
    await app.close();
  });

  it('rejects hosts outside the media allowlist', async () => {
    const app = makeApp();
    const src = encodeURIComponent('https://evil.example.com/x.jpg');
    const response = await app.inject({ method: 'GET', url: `/api/import/image?src=${src}` });
    expect(response.statusCode).toBe(422);
    await app.close();
  });
});

describe('static hosting', () => {
  it('falls back to index.html only for application routes', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mp-static-'));
    writeFileSync(join(dir, 'index.html'), '<!doctype html><title>shell</title>');

    const app = buildApp({ signingSecret: 'test-secret', aliasesPath, staticDir: dir });

    const page = await app.inject({ method: 'GET', url: '/ledger' });
    expect(page.statusCode).toBe(200);
    expect(page.body).toContain('shell');
    expect(page.headers['content-security-policy']).toContain("default-src 'self'");
    expect(page.headers['x-content-type-options']).toBe('nosniff');

    const missingAsset = await app.inject({ method: 'GET', url: '/assets/missing.js' });
    expect(missingAsset.statusCode).toBe(404);

    const missingApi = await app.inject({ method: 'GET', url: '/api/does-not-exist' });
    expect(missingApi.statusCode).toBe(404);

    await app.close();
  });
});
