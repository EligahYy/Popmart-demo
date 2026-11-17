import { MEDIA_CHUNK_BYTES, SHARED_TABLES, type SharedMedia, type SharedSnapshot } from '@my-popmart/contracts';
import type { PopmartDb } from '../db/database.js';

/** Serializes records only; binary media travels separately in bounded chunks. */
export async function captureSnapshot(db: PopmartDb, previous?: SharedSnapshot): Promise<SharedSnapshot> {
  const tables = Object.fromEntries(await Promise.all(SHARED_TABLES.map(async (name) => [
    name, await db.table(name).toArray(),
  ]))) as SharedSnapshot['tables'];
  const media = new Map<string, SharedMedia>((previous?.media ?? []).map((item) => [
    `${item.datasetId}:${item.id}`, item,
  ]));
  for (const row of await db.mediaBlobs.toArray()) {
    const asset = await db.assets.get([row.datasetId, row.id]);
    media.set(`${row.datasetId}:${row.id}`, {
      datasetId: row.datasetId, id: row.id, bytes: row.blob.size,
      mime: asset?.mime ?? row.blob.type ?? 'application/octet-stream',
      parts: Math.ceil(row.blob.size / MEDIA_CHUNK_BYTES),
    });
  }
  return { schemaVersion: 1, instanceId: previous?.instanceId ?? crypto.randomUUID(), tables, media: [...media.values()], receipts: [...(previous?.receipts ?? [])] };
}

export async function applySnapshot(db: PopmartDb, snapshot: SharedSnapshot, revision?: number): Promise<string> {
  if (snapshot.schemaVersion !== 1) throw new Error('共享数据版本不兼容，请更新页面');
  await db.transaction('rw', SHARED_TABLES.map((name) => db.table(name)), async () => {
    const cached = (await db.appMeta.get('control'))?.sharedCache;
    // Two tabs may receive responses in a different order. Never replace a newer
    // shared cache with an older response from the same server-side space.
    if (revision !== undefined && cached?.instanceId === snapshot.instanceId && cached.revision >= revision) return;
    for (const name of SHARED_TABLES) {
      await db.table(name).clear();
      if (snapshot.tables[name].length) await db.table(name).bulkPut(snapshot.tables[name]);
    }
    if (revision !== undefined) {
      const meta = await db.appMeta.get('control');
      if (meta) await db.appMeta.put({ ...meta, sharedCache: { instanceId: snapshot.instanceId, revision, media: snapshot.media } });
    }
  });
  const meta = await db.appMeta.get('control');
  if (!meta) throw new Error('云端数据缺少控制记录');
  return meta.activeDatasetId;
}
