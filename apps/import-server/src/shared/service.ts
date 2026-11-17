import { createHash, randomUUID } from 'node:crypto';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { type SharedCommand, type SharedState } from '@my-popmart/contracts';
import { PopmartDb } from '../../../web/src/db/database.js';
import * as commands from '../../../web/src/db/commands.js';
import { savePersonalAsset, clearPersonalAssets, type PersonalRole } from '../../../web/src/media/personal.js';
import { restoreBackup, validateBackupData } from '../../../web/src/backup/restore.js';
import type { BackupInspection } from '../../../web/src/backup/format.js';
import { captureSnapshot, applySnapshot } from '../../../web/src/shared/snapshot.js';
import type { SharedStore } from './store.js';

export class SharedError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) { super(message); }
}

function temporaryDatabase(): PopmartDb {
  return new PopmartDb(`request-${randomUUID()}`, { indexedDB: new IDBFactory(), IDBKeyRange });
}

export function createSharedService(store: SharedStore) {
  async function read(): Promise<SharedState> {
    const current = await store.read();
    if (current) return current;
    const db = temporaryDatabase();
    try {
      await db.open();
      await commands.initializeDatabase(db);
      // Start empty. Never publish a visitor's local data or manufacture demo records.
      await store.initialize(await captureSnapshot(db));
    } finally { await db.delete(); }
    const initialized = await store.read();
    if (!initialized) throw new Error('共享空间初始化失败');
    return initialized;
  }

  async function readBlob(id: string): Promise<Blob> {
    const parts = await store.readMedia(id);
    if (!parts.length || parts.length !== parts[0]?.parts || parts.some((p, i) => p.part !== i || p.parts !== parts.length)) {
      throw new SharedError(400, 'MEDIA_INCOMPLETE', '素材尚未上传完整，请重新上传');
    }
    const bytes = Buffer.concat(parts.map((p) => Buffer.from(p.bytes, 'base64')));
    if (createHash('sha256').update(bytes).digest('hex') !== id) {
      throw new SharedError(400, 'MEDIA_INVALID', '素材校验失败，请重新上传');
    }
    return new Blob([bytes], { type: parts[0]?.mime ?? 'application/octet-stream' });
  }

  async function execute(name: SharedCommand, payload: Record<string, unknown>, requestId: string) {
    for (let attempt = 0; attempt < 5; attempt++) {
      const before = await read();
      const receipt = before.snapshot.receipts.find((item) => item.id === requestId);
      if (receipt) return { state: before, result: receipt.result };
      const db = temporaryDatabase();
      try {
        await db.open();
        const datasetId = await applySnapshot(db, before.snapshot);
        if (payload.datasetId !== datasetId) throw new SharedError(409, 'DATASET_CHANGED', '共享数据已被恢复，请重新打开表单');
        const input = payload;
        let result: unknown;
        switch (name) {
          case 'savePersonalAsset': {
            const file = new File([await readBlob(String(input.hash))], 'shared-media', { type: String(input.mime) });
            result = await savePersonalAsset(db, datasetId, file, input.role as PersonalRole);
            break;
          }
          case 'clearPersonalAssets':
            await clearPersonalAssets(db, datasetId, input.role as PersonalRole);
            result = null;
            break;
          case 'restoreBackup': {
            const media = new Map<string, Uint8Array>();
            for (const id of input.media as string[]) media.set(id, new Uint8Array(await (await readBlob(id)).arrayBuffer()));
            result = await restoreBackup(db, { manifest: input.manifest, data: input.data, media } as BackupInspection);
            break;
          }
          default: {
            // The same validated business commands run locally in tests and on the server.
            const command = commands[name] as (db: PopmartDb, input: never) => Promise<unknown>;
            result = await command(db, input as never);
          }
        }
        const snapshot = await captureSnapshot(db, before.snapshot);
        const activeId = snapshot.tables.appMeta.find((row) => row.id === 'control')?.activeDatasetId;
        const activeTables = Object.fromEntries(Object.entries(snapshot.tables).map(([key, rows]) => [
          key, rows.filter((row) => row.datasetId === activeId),
        ]));
        const problems = validateBackupData(activeTables);
        if (problems.length) throw new SharedError(400, 'INVALID_DATA', problems[0] ?? '数据校验失败');
        snapshot.receipts.push({ id: requestId, result });
        snapshot.receipts.splice(0, Math.max(0, snapshot.receipts.length - 100));
        if (Buffer.byteLength(JSON.stringify(snapshot)) > 3 * 1024 * 1024) {
          throw new SharedError(413, 'SPACE_FULL', '共享演示空间记录较多，请先导出备份并整理记录');
        }
        // Retry against fresh records instead of overwriting another visitor's changes.
        const saved = await store.compareAndSwap(before.revision, snapshot);
        if (saved) return { state: saved, result };
      } finally { await db.delete(); }
    }
    throw new SharedError(409, 'CONFLICT', '其他访客正在修改共享数据，请稍后重试');
  }
  return { read, readBlob, execute };
}
