import 'fake-indexeddb/auto';
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { dayDate } from '@my-popmart/contracts';
import { buildApp } from '../buildApp.js';
import { createDatabase, type PopmartDb } from '../../../web/src/db/database.js';
import * as commands from '../../../web/src/db/commands.js';
import { SharedClient } from '../../../web/src/shared/client.js';
import { getOwnedIps } from '../../../web/src/db/queries.js';
import { savePersonalAsset, readPersonalBlob } from '../../../web/src/media/personal.js';
import { createBackup } from '../../../web/src/backup/export.js';
import { inspectBackup, restoreBackup } from '../../../web/src/backup/restore.js';
import { MemoryStore } from './testing/memoryStore.js';


const fixture = readFileSync(new URL('../providers/__fixtures__/popmart-product-9120.html', import.meta.url), 'utf8');
const cleanup: Array<() => Promise<unknown>> = [];
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close(); });

function server(store = new MemoryStore()) {
  const app = buildApp({ sharedStore: store, fetchImpl: vi.fn(async () => new Response(fixture)), signingSecret: 'test' });
  cleanup.push(() => app.close());
  const fetchImpl = (async (path, init) => {
    const headers = new Headers(init?.headers);
    const response = await app.inject({
      method: (init?.method ?? 'GET') as 'GET' | 'POST' | 'PUT',
      url: String(path), headers: Object.fromEntries(headers.entries()),
      ...(typeof init?.body === 'string' ? { payload: init.body } : {}),
    });
    return new Response(response.statusCode === 204 ? null : new Uint8Array(response.rawPayload), {
      status: response.statusCode, headers: response.headers as Record<string, string>,
    });
  }) as typeof fetch;
  return { app, fetchImpl, store };
}

async function client(fetchImpl: typeof fetch) {
  const db = createDatabase(`shared-test-${crypto.randomUUID()}`);
  cleanup.push(() => db.delete());
  await db.open();
  db.shared = new SharedClient(db, fetchImpl);
  await db.shared.refresh();
  const datasetId = (await db.appMeta.get('control'))!.activeDatasetId;
  return { db, datasetId };
}

async function importSeries(fetchImpl: typeof fetch, target: { db: PopmartDb; datasetId: string }) {
  const resolved = await (await fetchImpl('/api/import/resolve', { method: 'POST', headers: {'content-type':'application/json'}, body: JSON.stringify({input:'https://www.popmart.com/ca/products/9120'}) })).json() as { candidates: Array<{candidateId: string}> };
  const preview = await (await fetchImpl('/api/import/preview', { method: 'POST', headers: {'content-type':'application/json'}, body: JSON.stringify({candidateId:resolved.candidates[0]!.candidateId}) })).json();
  return commands.commitSeriesImport(target.db, { commandId: crypto.randomUUID(), datasetId: target.datasetId, preview, seriesReferenceUnitCents: 6900, priceProvenance: 'user_confirmed' });
}

function purchase(target: {db: PopmartDb; datasetId: string}, styleId: string, quantity = 1) {
  return commands.createAcquisition(target.db, {
    commandId: crypto.randomUUID(), datasetId: target.datasetId, source: 'official',
    date: dayDate('2026-11-17'), paidTotalCents: quantity * 6900,
    lines: [{ styleId, quantity, allocatedCents: quantity * 6900, referenceUnitCentsSnapshot: 6900 }],
  });
}

describe('shared cloud API and independent browser caches', () => {
  it('starts with an empty cloud space and reports missing configuration clearly', async () => {
    const unconfigured = buildApp();
    cleanup.push(() => unconfigured.close());
    expect((await unconfigured.inject('/api/shared/state')).statusCode).toBe(503);
    expect((await unconfigured.inject('/api/health')).statusCode).toBe(200);
    const {fetchImpl, store} = server();
    const a = await client(fetchImpl);
    const b = await client(fetchImpl);
    expect(a.datasetId).toBe(b.datasetId);
    expect(await a.db.styles.count()).toBe(0);
    expect(store.state?.snapshot.tables.acquisitions).toEqual([]);
  });

  it('revalidates only matching snapshots and can display media when local storage is full', async () => {
    const { fetchImpl } = server();
    const a = await client(fetchImpl);
    const file = new File(['portrait'], 'avatar.webp', { type: 'image/webp' });
    const { hash } = await savePersonalAsset(a.db, a.datasetId, file);
    const cached = (await a.db.appMeta.get('control'))!.sharedCache!;
    const stateUrl = `/api/shared/state?revision=${cached.revision}&instanceId=`;
    expect((await fetchImpl(stateUrl + cached.instanceId)).status).toBe(204);
    const replaced = await fetchImpl(stateUrl + crypto.randomUUID());
    expect(replaced.status).toBe(200);
    expect(replaced.headers.get('cache-control')).toBe('no-store');
    const partUrl = `/api/shared/media/${hash}/`;
    expect((await fetchImpl(partUrl + '0')).headers.get('cache-control')).toContain('immutable');
    expect((await fetchImpl(partUrl + '1')).headers.get('cache-control')).toBe('no-store');
    vi.spyOn(a.db.mediaBlobs, 'put').mockRejectedValueOnce(new DOMException('Full', 'QuotaExceededError'));
    expect(await (await a.db.shared!.readMedia(hash))?.text()).toBe('portrait');
  });

  it('persists a name across clients and new server instances', async () => {
    const {fetchImpl, store} = server();
    const a = await client(fetchImpl);
    const b = await client(fetchImpl);
    await commands.setSpaceName(a.db, {datasetId:a.datasetId,commandId:crypto.randomUUID(),name:'我的共享空间'});
    await b.db.shared!.refresh();
    expect((await b.db.preferences.get([b.datasetId,'spaceName']))?.value).toBe('我的共享空间');
    const restarted = server(store);
    const c = await client(restarted.fetchImpl);
    expect((await c.db.preferences.get([c.datasetId,'spaceName']))?.value).toBe('我的共享空间');
  });

  it('shares imported series, orders, budgets, stories, refunds and transfers', async () => {
    const {fetchImpl} = server();
    const a = await client(fetchImpl);
    const b = await client(fetchImpl);
    const imported = await importSeries(fetchImpl,a);
    const styleId = Object.values(imported.styleIds)[0]!;
    const bought = await purchase(a,styleId,3);
    await commands.setBudget(a.db,{commandId:crypto.randomUUID(),datasetId:a.datasetId,month:'2026-11',amountLimitCents:50000,quantityLimit:10});
    await commands.updateCollectionProfile(a.db,{commandId:crypto.randomUUID(),datasetId:a.datasetId,styleId,nickname:'星星',story:'共享收藏故事'});
    await commands.createRefund(a.db,{commandId:crypto.randomUUID(),datasetId:a.datasetId,acquisitionId:bought.acquisitionId,kind:'return',processedOn:'2026-11-17',totalCents:6900,lines:[{lineId:bought.lineIds[0]!,refundCents:6900,returnedQuantity:1}]});
    await commands.createTransfer(a.db,{commandId:crypto.randomUUID(),datasetId:a.datasetId,kind:'give_away',occurredOn:'2026-11-17',lines:[{lineId:bought.lineIds[0]!,quantity:1}]});
    await b.db.shared!.refresh();
    expect(await b.db.styles.count()).toBe(13);
    expect((await getOwnedIps(b.db,b.datasetId))[0]?.heldTotal).toBe(1);
    expect((await b.db.budgetMonths.toArray())[0]?.amountLimitCents).toBe(50000);
    expect((await b.db.collectionProfiles.toArray())[0]?.story).toBe('共享收藏故事');
    expect(await b.db.refunds.count()).toBe(1);
    expect(await b.db.transfers.count()).toBe(1);
  });

  it('retries simultaneous writes without losing either order', async () => {
    const {fetchImpl} = server();
    const a = await client(fetchImpl);
    const imported = await importSeries(fetchImpl,a);
    const b = await client(fetchImpl);
    const styleId = Object.values(imported.styleIds)[0]!;
    await Promise.all([purchase(a,styleId),purchase(b,styleId)]);
    await a.db.shared!.refresh();
    expect(await a.db.acquisitions.count()).toBe(2);
    expect((await getOwnedIps(a.db,a.datasetId))[0]?.heldTotal).toBe(2);
  });

  it('does not leave a failed save in a browser cache', async () => {
    const {fetchImpl,store} = server();
    const a = await client(fetchImpl);
    store.compareAndSwap = async () => { throw new Error('database offline'); };
    await expect(commands.setSpaceName(a.db,{datasetId:a.datasetId,commandId:crypto.randomUUID(),name:'不应保存'})).rejects.toThrow('暂时无法连接共享数据库');
    expect(await a.db.preferences.count()).toBe(0);
  });

  it('rejects a stale edit instead of replacing another visitor\'s changes', async () => {
    const {fetchImpl} = server();
    const a = await client(fetchImpl);
    const imported = await importSeries(fetchImpl,a);
    const bought = await purchase(a,Object.values(imported.styleIds)[0]!);
    const b = await client(fetchImpl);
    await commands.updateAcquisition(a.db, {datasetId:a.datasetId,commandId:crypto.randomUUID(),acquisitionId:bought.acquisitionId,expectedRevision:1,patch:{note:'first visitor'}});
    await expect(commands.updateAcquisition(b.db, {datasetId:b.datasetId,commandId:crypto.randomUUID(),acquisitionId:bought.acquisitionId,expectedRevision:1,patch:{note:'stale visitor'}})).rejects.toThrow('记录已被修改');
    expect((await b.db.acquisitions.get([b.datasetId,bought.acquisitionId]))?.note).toBe('first visitor');
  });

  it('does not duplicate an order when the committed response is lost', async () => {
    const {fetchImpl} = server();
    const a = await client(fetchImpl);
    const imported = await importSeries(fetchImpl,a);
    let loseResponse = true;
    const flaky = (async (path,init) => {
      const response = await fetchImpl(path,init);
      if (String(path).endsWith('/commands') && loseResponse) { loseResponse = false; throw new TypeError('connection closed'); }
      return response;
    }) as typeof fetch;
    a.db.shared = new SharedClient(a.db,flaky);
    await a.db.shared.refresh();
    await purchase(a,Object.values(imported.styleIds)[0]!);
    expect(await a.db.acquisitions.count()).toBe(1);
  });

  it('shares chunked media and restores a backup atomically for every visitor', async () => {
    const {fetchImpl} = server();
    const a = await client(fetchImpl);
    const bytes = new Uint8Array(700000).fill(47);
    await savePersonalAsset(a.db,a.datasetId,new File([bytes],'avatar.png',{type:'image/png'}));
    const b = await client(fetchImpl);
    const asset = (await b.db.assets.toArray())[0]!;
    const blob = await readPersonalBlob(b.db,b.datasetId,asset.id);
    expect(blob?.size).toBe(bytes.length);
    expect(new Uint8Array(await blob!.arrayBuffer())).toEqual(bytes);
    const backup = await createBackup(b.db,b.datasetId);
    const inspection = await inspectBackup(await backup.blob.arrayBuffer());
    const restored = await restoreBackup(a.db,inspection);
    expect(restored.datasetId).not.toBe(a.datasetId);
    await b.db.shared!.refresh();
    const meta = await b.db.appMeta.get('control');
    expect(meta?.activeDatasetId).toBe(restored.datasetId);
    expect((await readPersonalBlob(b.db,restored.datasetId,asset.id))?.size).toBe(bytes.length);
  }, 20000);
});
