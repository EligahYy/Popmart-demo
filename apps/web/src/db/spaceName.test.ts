import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDatabase, openDatabase, type PopmartDb } from './database.js';
import { initializeDatabase, setSpaceName } from './commands.js';
import { getSpaceName } from './queries.js';
import { createBackup } from '../backup/export.js';
import { inspectBackup, restoreBackup } from '../backup/restore.js';

let db: PopmartDb;
let datasetId: string;

beforeEach(async () => {
  db = createDatabase(`space-${crypto.randomUUID()}`);
  await openDatabase(db);
  datasetId = await initializeDatabase(db);
});

afterEach(async () => {
  await db.delete();
});

describe('space name', () => {
  it('falls back to the default name', async () => {
    expect(await getSpaceName(db, datasetId)).toBe('红彤彤收纳');
  });

  it('saves a custom name and persists it', async () => {
    await setSpaceName(db, { commandId: crypto.randomUUID(), datasetId, name: ' 我的收纳角 ' });
    expect(await getSpaceName(db, datasetId)).toBe('我的收纳角');
  });

  it('rejects empty or overly long names', async () => {
    await expect(
      setSpaceName(db, { commandId: crypto.randomUUID(), datasetId, name: '   ' }),
    ).rejects.toMatchObject({ code: 'INVALID_DRAFT' });
    await expect(
      setSpaceName(db, { commandId: crypto.randomUUID(), datasetId, name: '一二三四五六七八九十十一十二三' }),
    ).rejects.toMatchObject({ code: 'INVALID_DRAFT' });
  });

  it('survives backup and restore', async () => {
    await setSpaceName(db, { commandId: crypto.randomUUID(), datasetId, name: '收纳小站' });

    const backup = await createBackup(db, datasetId);
    const inspection = await inspectBackup(await backup.blob.arrayBuffer());
    expect(inspection.data.preferences).toHaveLength(1);

    const result = await restoreBackup(db, inspection);
    expect(await getSpaceName(db, result.datasetId)).toBe('收纳小站');
  });
});
