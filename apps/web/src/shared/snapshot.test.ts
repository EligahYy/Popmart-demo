import 'fake-indexeddb/auto';
import { afterEach, expect, it } from 'vitest';
import { createDatabase } from '../db/database.js';
import { initializeDatabase } from '../db/commands.js';
import { applySnapshot, captureSnapshot } from './snapshot.js';

const databases: ReturnType<typeof createDatabase>[] = [];
afterEach(async () => { for (const db of databases.splice(0)) await db.delete(); });
it('does not let an older response replace newer data in another tab\'s cache', async () => {
  const db = createDatabase(`cache-order-${crypto.randomUUID()}`);
  databases.push(db);
  await db.open();
  const datasetId = await initializeDatabase(db);
  const original = await captureSnapshot(db);
  const newer = structuredClone(original);
  newer.tables.preferences.push({datasetId,id:'spaceName',value:'newer'});
  await applySnapshot(db,newer,3);
  await applySnapshot(db,original,2);
  expect((await db.preferences.get([datasetId,'spaceName']))?.value).toBe('newer');
  expect((await db.appMeta.get('control'))?.sharedCache?.revision).toBe(3);
});
