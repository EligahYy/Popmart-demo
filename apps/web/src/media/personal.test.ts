import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDatabase, openDatabase, type PopmartDb } from '../db/database.js';
import { initializeDatabase } from '../db/commands.js';
import { clearPersonalAssets, getPersonalAsset, savePersonalAsset } from './personal.js';

let db: PopmartDb;
let datasetId: string;

beforeEach(async () => {
  db = createDatabase(`personal-${crypto.randomUUID()}`);
  await openDatabase(db);
  datasetId = await initializeDatabase(db);
});

afterEach(async () => {
  await db.delete();
});

function imageFile(name = 'a.png'): File {
  return new File([new Uint8Array([1, 2, 3, 4])], name, { type: 'image/png' });
}

function videoFile(name = 'greet.mp4'): File {
  return new File([new Uint8Array([9, 8, 7, 6])], name, { type: 'video/mp4' });
}

describe('personal media roles', () => {
  it('stores idle and greeting assets independently', async () => {
    await savePersonalAsset(db, datasetId, imageFile(), 'idle');
    await savePersonalAsset(db, datasetId, videoFile(), 'greeting');

    expect((await getPersonalAsset(db, datasetId, 'idle'))?.kind).toBe('image');
    expect((await getPersonalAsset(db, datasetId, 'greeting'))?.kind).toBe('video');
  });

  it('replacing one role keeps the other', async () => {
    await savePersonalAsset(db, datasetId, imageFile('a.png'), 'idle');
    await savePersonalAsset(db, datasetId, videoFile(), 'greeting');
    await savePersonalAsset(db, datasetId, imageFile('b.png'), 'idle');

    expect((await getPersonalAsset(db, datasetId, 'greeting'))?.kind).toBe('video');
    const idle = await getPersonalAsset(db, datasetId, 'idle');
    expect(idle).not.toBeNull();
  });

  it('rejects images for the greeting role', async () => {
    await expect(savePersonalAsset(db, datasetId, imageFile(), 'greeting')).rejects.toThrow();
  });

  it('clears only the requested role', async () => {
    await savePersonalAsset(db, datasetId, imageFile(), 'idle');
    await savePersonalAsset(db, datasetId, videoFile(), 'greeting');
    await clearPersonalAssets(db, datasetId, 'greeting');

    expect(await getPersonalAsset(db, datasetId, 'greeting')).toBeNull();
    expect((await getPersonalAsset(db, datasetId, 'idle'))?.kind).toBe('image');
  });
});
