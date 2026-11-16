import { beforeEach, describe, expect, it } from 'vitest';
import { chooseCover, sessionSeed } from './ipCover.js';

function memoryStorage(): Storage {
  const data = new Map<string, string>();
  return {
    get length() {
      return data.size;
    },
    clear: () => data.clear(),
    getItem: (key) => data.get(key) ?? null,
    key: (index) => [...data.keys()][index] ?? null,
    removeItem: (key) => data.delete(key),
    setItem: (key, value) => data.set(key, value),
  } as Storage;
}

let storage: Storage;

beforeEach(() => {
  storage = memoryStorage();
});

describe('chooseCover', () => {
  it('returns null without images', () => {
    expect(chooseCover('ip', [], 'seed', null)).toBeNull();
  });

  it('keeps a single image stable', () => {
    const covers = [{ url: 'a.jpg', assetId: null }];
    expect(chooseCover('ip', covers, 'seed-1', null)?.url).toBe('a.jpg');
    expect(chooseCover('ip', covers, 'seed-2', 'a.jpg')?.url).toBe('a.jpg');
  });

  it('avoids the previous pick when alternatives exist', () => {
    const covers = [
      { url: 'a.jpg', assetId: null },
      { url: 'b.jpg', assetId: null },
    ];
    expect(chooseCover('ip', covers, 'seed', 'a.jpg')?.url).toBe('b.jpg');
  });

  it('is stable for the same seed and last pick', () => {
    const covers = [
      { url: 'a.jpg', assetId: null },
      { url: 'b.jpg', assetId: null },
      { url: 'c.jpg', assetId: null },
    ];
    const first = chooseCover('ip', covers, 'same-seed', 'a.jpg')?.url;
    const second = chooseCover('ip', covers, 'same-seed', 'a.jpg')?.url;
    expect(second).toBe(first);
  });

  it('creates one session seed and reuses it', () => {
    const seedA = sessionSeed(storage, 1);
    const seedB = sessionSeed(storage, 2);
    expect(seedB).toBe(seedA);
  });
});
