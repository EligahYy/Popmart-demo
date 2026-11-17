import { PGlite } from '@electric-sql/pglite';
import { neonConfig } from '@neondatabase/serverless';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SHARED_TABLES, type SharedSnapshot } from '@my-popmart/contracts';
import { createNeonStore } from './store.js';

let postgres: PGlite;
const originalFetch = neonConfig.fetchFunction;
beforeEach(() => {
  postgres = new PGlite();
  // Exercise the real Neon HTTP driver and production SQL against PostgreSQL,
  // without needing production credentials in the test runner.
  neonConfig.fetchFunction = (async (_url, init) => {
    const packet = JSON.parse(String(init?.body)) as { query: string; params: unknown[] };
    const result = await postgres.query<Record<string, unknown>>(packet.query, packet.params);
    const fields = result.fields;
    const rows = result.rows.map((row) => fields.map((field) => {
      const value = row[field.name];
      return value === null ? null : typeof value === 'object' ? JSON.stringify(value) : String(value);
    }));
    return new Response(JSON.stringify({ fields, rows, rowCount: result.affectedRows ?? rows.length }), {headers:{'content-type':'application/json'}});
  }) as typeof fetch;
});
afterEach(async () => { neonConfig.fetchFunction = originalFetch; await postgres.close(); });

function snapshot(): SharedSnapshot {
  return {
    schemaVersion: 1,
    instanceId: crypto.randomUUID(),
    tables: Object.fromEntries(SHARED_TABLES.map((name) => [name, [] as Array<Record<string, unknown>>])) as SharedSnapshot['tables'],
    media: [], receipts: [],
  };
}
const url = 'postgresql://user:password@example.neon.tech/popmart';

describe('Neon persistent SQL store', () => {
  it('creates tables and retains a single initialized space across instances', async () => {
    const first = createNeonStore(url);
    expect(await first.read()).toBeNull();
    const initial = snapshot();
    initial.tables.preferences.push({ id: 'name', value: '公共收藏' });
    await first.initialize(initial);
    const second = createNeonStore(url);
    await second.initialize(snapshot());
    expect((await second.read())?.snapshot.tables.preferences[0]?.value).toBe('公共收藏');
  }, 30000);

  it('rejects a stale SQL update and isolates named spaces', async () => {
    const first = createNeonStore(url);
    await first.initialize(snapshot());
    const a = snapshot(); a.tables.preferences.push({id:'a'});
    const b = snapshot(); b.tables.preferences.push({id:'b'});
    const results = await Promise.all([first.compareAndSwap(1,a),first.compareAndSwap(1,b)]);
    expect(results.filter(Boolean)).toHaveLength(1);
    expect((await first.read())?.revision).toBe(2);
    expect(await createNeonStore(url,'another').read()).toBeNull();
  }, 30000);

  it('stores immutable media chunks and reads only a requested part', async () => {
    const store = createNeonStore(url);
    await store.putMedia({id:'hash',part:0,parts:2,mime:'image/png',bytes:'YQ=='});
    await store.putMedia({id:'hash',part:1,parts:2,mime:'image/png',bytes:'Yg=='});
    await store.putMedia({id:'hash',part:0,parts:2,mime:'image/png',bytes:'Yw=='});
    expect((await store.readMediaPart('hash',0))?.bytes).toBe('YQ==');
    expect((await store.readMedia('hash')).map((part) => part.part)).toEqual([0,1]);
    expect(await createNeonStore(url,'another').readMedia('hash')).toEqual([]);
  }, 30000);
});
