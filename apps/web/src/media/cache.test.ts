import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDatabase, openDatabase, type PopmartDb } from '../db/database.js';
import { initializeDatabase, putStyleForTest } from '../db/commands.js';
import { cacheStyleImage, cacheStyleImages, readStyleImage } from './cache.js';

let db: PopmartDb;
let datasetId: string;

const imageBytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);

function imageResponse(): Response {
  return new Response(imageBytes, { status: 200, headers: { 'content-type': 'image/jpeg' } });
}

beforeEach(async () => {
  db = createDatabase(`media-test-${crypto.randomUUID()}`);
  await openDatabase(db);
  datasetId = await initializeDatabase(db);
  await putStyleForTest(db, datasetId, {
    id: 'style-a',
    seriesId: 's1',
    canonicalKey: 'a',
    displayName: 'A',
    imageUrl: 'https://cdn.example.com/a.jpg',
    mediaStatus: 'remote',
  });
});

afterEach(async () => {
  await db.delete();
});

describe('cacheStyleImage', () => {
  it('downloads, hashes and stores the blob', async () => {
    const fetchImpl = vi.fn(async () => imageResponse()) as unknown as typeof fetch;
    const result = await cacheStyleImage(db, datasetId, 'style-a', fetchImpl);

    expect(result.status).toBe('cached');
    const style = await db.styles.get([datasetId, 'style-a']);
    expect(style?.mediaStatus).toBe('cached');
    expect(style?.imageAssetId).not.toBeNull();

    const blob = await readStyleImage(db, datasetId, style?.imageAssetId ?? '');
    expect(blob).not.toBeNull();
    expect(blob?.size).toBe(imageBytes.byteLength);

    const assets = await db.assets.where({ datasetId }).toArray();
    expect(assets).toHaveLength(1);
    expect(assets[0]?.mime).toBe('image/jpeg');
    expect(assets[0]?.ownerId).toBe('style-a');
  });

  it('is idempotent for already cached styles', async () => {
    const fetchImpl = vi.fn(async () => imageResponse()) as unknown as typeof fetch;
    await cacheStyleImage(db, datasetId, 'style-a', fetchImpl);
    const second = await cacheStyleImage(db, datasetId, 'style-a', fetchImpl);
    expect(second.status).toBe('skipped');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('leaves the style unchanged on failure', async () => {
    const fetchImpl = vi.fn(async () => new Response('nope', { status: 500 })) as unknown as typeof fetch;
    const result = await cacheStyleImage(db, datasetId, 'style-a', fetchImpl);
    expect(result.status).toBe('failed');
    const style = await db.styles.get([datasetId, 'style-a']);
    expect(style?.mediaStatus).toBe('remote');
    expect(style?.imageAssetId).toBeNull();
  });

  it('rejects non-image responses', async () => {
    const fetchImpl = vi.fn(
      async () => new Response('<html></html>', { status: 200, headers: { 'content-type': 'text/html' } }),
    ) as unknown as typeof fetch;
    expect((await cacheStyleImage(db, datasetId, 'style-a', fetchImpl)).status).toBe('failed');
  });
});

describe('cacheStyleImages', () => {
  it('reports counts for a batch', async () => {
    for (const id of ['style-b', 'style-c']) {
      await putStyleForTest(db, datasetId, {
        id,
        seriesId: 's1',
        canonicalKey: id,
        displayName: id,
        imageUrl: `https://cdn.example.com/${id}.jpg`,
        mediaStatus: 'remote',
      });
    }
    const fetchImpl = vi.fn(async () => imageResponse()) as unknown as typeof fetch;
    const result = await cacheStyleImages(db, datasetId, ['style-a', 'style-b', 'style-c'], {
      fetchImpl,
      concurrency: 2,
    });
    expect(result.cached).toBe(3);
    expect(result.failed).toBe(0);
  });
});
