import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { expect, it } from 'vitest';
import { createDatabase, openDatabase } from './database.js';

it('upgrades the old style index without losing data and allows same-name styles in different series', async () => {
  const name = `schema-upgrade-${crypto.randomUUID()}`;
  const current = createDatabase(`${name}-schema`);
  const oldSchema = Object.fromEntries(current.tables.map(table => [table.name, [
    table.schema.primKey.src, ...table.schema.indexes.map(index => index.src),
  ].join(', ')]));
  oldSchema.styles = '[datasetId+id], datasetId, seriesId, [datasetId+seriesId], &[datasetId+canonicalKey]';
  const legacy = new Dexie(name);
  legacy.version(1).stores(oldSchema);
  await legacy.open();
  const row = { datasetId: 'space', id: 'old-style', seriesId: 'first', canonicalKey: 'secret', displayName: 'Secret' };
  await legacy.table('styles').put(row);
  legacy.close();
  const upgraded = createDatabase(name);
  try {
    await openDatabase(upgraded);
    expect(await upgraded.styles.get(['space', 'old-style'])).toEqual(row);
    await upgraded.table('styles').put({ ...row, id: 'new-style', seriesId: 'second' });
    expect(await upgraded.styles.count()).toBe(2);
    await expect(upgraded.table('styles').put({ ...row, id: 'duplicate' })).rejects.toMatchObject({ name: 'ConstraintError' });
  } finally {
    await upgraded.delete();
    await current.delete();
  }
});
