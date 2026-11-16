import { strToU8, zipSync } from 'fflate';
import { sha256Hex } from '../media/hash.js';
import type { PopmartDb } from '../db/database.js';
import {
  BACKUP_FORMAT_NAME,
  BACKUP_FORMAT_VERSION,
  BACKUP_TABLES,
  DATA_SCHEMA_VERSION,
  type BackupFileEntry,
  type BackupManifest,
} from './format.js';

export const APP_VERSION = '0.1.0';

export interface BackupResult {
  readonly blob: Blob;
  readonly filename: string;
  readonly manifest: BackupManifest;
}

function backupFilename(now: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `my-popmart-backup-${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(
    now.getHours(),
  )}${pad(now.getMinutes())}.zip`;
}

/**
 * 导出：先在一个只读事务里取一致快照（结构化数据 + 媒体引用），
 * 事务外做哈希与压缩，避免长时间占用事务。
 */
export async function createBackup(db: PopmartDb, datasetId: string): Promise<BackupResult> {
  const scope = [...BACKUP_TABLES.map((table) => db.table(table)), db.mediaBlobs];
  const snapshot = await db.transaction('r', scope, async () => {
    const data: Record<string, unknown[]> = {};
    for (const table of BACKUP_TABLES) {
      data[table] = await db.table(table).where({ datasetId }).toArray();
    }
    const blobs = await db.mediaBlobs.where({ datasetId }).toArray();
    return { data, blobs };
  });

  const blobByHash = new Map(snapshot.blobs.map((row) => [row.id, row.blob]));

  const assets = (snapshot.data.assets ?? []) as Array<{
    id: string;
    hash: string;
    mime: string;
    status: string;
  }>;

  const missingMedia: string[] = [];
  const mediaFiles = new Map<string, Uint8Array>();
  const mimeByHash = new Map<string, string>();

  for (const asset of assets) {
    if (asset.status !== 'ready') continue;
    const blob = blobByHash.get(asset.hash);
    if (!blob) {
      missingMedia.push(asset.hash);
      continue;
    }
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const actualHash = await sha256Hex(bytes);
    if (actualHash !== asset.hash) {
      missingMedia.push(asset.hash);
      continue;
    }
    mediaFiles.set(asset.hash, bytes);
    mimeByHash.set(asset.hash, asset.mime);
  }

  // 仍在远程、未缓存到本机的款式图也算缺项，不能谎称完整。
  const styles = (snapshot.data.styles ?? []) as Array<{
    id: string;
    imageUrl: string | null;
    mediaStatus: string;
  }>;
  for (const style of styles) {
    if (style.imageUrl !== null && style.mediaStatus !== 'cached') {
      missingMedia.push(style.id);
    }
  }

  const files: Record<string, Uint8Array> = {};
  const fileEntries: BackupFileEntry[] = [];
  const counts: Record<string, number> = {};

  for (const table of BACKUP_TABLES) {
    const rows = snapshot.data[table] ?? [];
    counts[table] = rows.length;
    const bytes = strToU8(JSON.stringify(rows));
    const path = `data/${table}.json`;
    files[path] = bytes;
    fileEntries.push({ path, bytes: bytes.byteLength, sha256: await sha256Hex(bytes) });
  }

  for (const [hash, bytes] of mediaFiles) {
    const mime = mimeByHash.get(hash) ?? 'application/octet-stream';
    const extension = mime.includes('png') ? '.png' : mime.includes('webp') ? '.webp' : '.jpg';
    const path = `media/${hash}${extension}`;
    files[path] = bytes;
    fileEntries.push({ path, bytes: bytes.byteLength, sha256: await sha256Hex(bytes) });
  }

  const manifest: BackupManifest = {
    formatName: BACKUP_FORMAT_NAME,
    backupFormatVersion: BACKUP_FORMAT_VERSION,
    dataSchemaVersion: DATA_SCHEMA_VERSION,
    appVersion: APP_VERSION,
    exportedAt: new Date().toISOString(),
    sourceDatasetId: datasetId,
    counts,
    files: fileEntries,
    mediaComplete: missingMedia.length === 0,
    missingMedia,
  };

  files['manifest.json'] = strToU8(JSON.stringify(manifest, null, 2));

  const zipped = zipSync(files, { level: 6 });
  return {
    blob: new Blob([zipped], { type: 'application/zip' }),
    filename: backupFilename(new Date()),
    manifest,
  };
}
