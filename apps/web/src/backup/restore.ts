import { strFromU8, unzipSync } from 'fflate';
import type { PopmartDb } from '../db/database.js';
import { nowIso } from '../db/database.js';
import { sha256Hex } from '../media/hash.js';
import {
  BACKUP_FORMAT_NAME,
  BACKUP_FORMAT_VERSION,
  BACKUP_TABLES,
  BackupError,
  DATA_SCHEMA_VERSION,
  type BackupInspection,
  type BackupManifest,
} from './format.js';

function asRows(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value) ? (value as Array<Record<string, unknown>>) : [];
}

function idSet(rows: Array<Record<string, unknown>>): Set<string> {
  return new Set(rows.map((row) => String(row.id ?? '')).filter(Boolean));
}

/** 校验容器、manifest、文件哈希与数据结构；不写数据库。 */
export async function inspectBackup(buffer: ArrayBuffer): Promise<BackupInspection> {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(new Uint8Array(buffer));
  } catch {
    throw new BackupError('INVALID_FORMAT', '不是有效的备份 ZIP 文件');
  }

  const manifestFile = files['manifest.json'];
  if (!manifestFile) throw new BackupError('INVALID_FORMAT', '备份缺少 manifest.json');

  let manifest: BackupManifest;
  try {
    manifest = JSON.parse(strFromU8(manifestFile)) as BackupManifest;
  } catch {
    throw new BackupError('INVALID_FORMAT', 'manifest.json 不是有效 JSON');
  }

  if (manifest.formatName !== BACKUP_FORMAT_NAME) {
    throw new BackupError('INVALID_FORMAT', '这不是 my popmart 的备份文件');
  }
  if (manifest.backupFormatVersion > BACKUP_FORMAT_VERSION) {
    throw new BackupError('UNSUPPORTED_VERSION', '备份由更新版本的应用生成');
  }
  if (manifest.dataSchemaVersion > DATA_SCHEMA_VERSION) {
    throw new BackupError('UNSUPPORTED_VERSION', '备份数据结构版本过高');
  }

  for (const entry of manifest.files ?? []) {
    const bytes = files[entry.path];
    if (!bytes) throw new BackupError('MISSING_FILE', `备份缺少 ${entry.path}`);
    if (bytes.byteLength !== entry.bytes) {
      throw new BackupError('HASH_MISMATCH', `${entry.path} 大小不一致`);
    }
    const actual = await sha256Hex(bytes);
    if (actual !== entry.sha256) {
      throw new BackupError('HASH_MISMATCH', `${entry.path} 校验失败`);
    }
  }

  const data: Record<string, unknown[]> = {};
  for (const table of BACKUP_TABLES) {
    const file = files[`data/${table}.json`];
    if (!file) throw new BackupError('MISSING_FILE', `备份缺少 data/${table}.json`);
    try {
      data[table] = JSON.parse(strFromU8(file)) as unknown[];
    } catch {
      throw new BackupError('INVALID_DATA', `data/${table}.json 不是有效 JSON`);
    }
  }

  const media = new Map<string, Uint8Array>();
  for (const [path, bytes] of Object.entries(files)) {
    if (!path.startsWith('media/')) continue;
    const hash = path.slice('media/'.length).replace(/\.[a-z0-9]+$/i, '');
    media.set(hash, bytes);
  }

  return { manifest, data, media };
}

/** 业务引用与数量约束校验；恢复前必须通过。 */
export function validateBackupData(data: Record<string, unknown[]>): string[] {
  const problems: string[] = [];
  const ips = asRows(data.ips);
  const series = asRows(data.series);
  const styles = asRows(data.styles);
  const acquisitions = asRows(data.acquisitions);
  const lines = asRows(data.acquisitionLines);
  const profiles = asRows(data.collectionProfiles);
  const refunds = asRows(data.refunds);
  const refundLines = asRows(data.refundLines);
  const transfers = asRows(data.transfers);
  const transferLines = asRows(data.transferLines);

  const ipIds = idSet(ips);
  const seriesIds = idSet(series);
  const styleIds = idSet(styles);
  const acquisitionIds = idSet(acquisitions);
  const lineIds = idSet(lines);
  const refundIds = idSet(refunds);
  const transferIds = idSet(transfers);

  for (const table of [ips, series, styles, acquisitions, lines, profiles, refunds, refundLines, transfers, transferLines]) {
    for (const row of table) {
      if (typeof row.id !== 'string' || row.id === '') problems.push('存在缺少 id 的记录');
    }
  }

  for (const row of series) {
    if (!ipIds.has(String(row.ipId ?? ''))) problems.push(`系列 ${String(row.id)} 的 IP 不存在`);
  }
  for (const row of styles) {
    if (!seriesIds.has(String(row.seriesId ?? ''))) problems.push(`款式 ${String(row.id)} 的系列不存在`);
  }
  for (const row of lines) {
    if (!acquisitionIds.has(String(row.acquisitionId ?? ''))) problems.push(`明细 ${String(row.id)} 的订单不存在`);
    if (!styleIds.has(String(row.styleId ?? ''))) problems.push(`明细 ${String(row.id)} 的款式不存在`);
    const quantity = Number(row.quantity);
    if (!Number.isSafeInteger(quantity) || quantity <= 0) problems.push(`明细 ${String(row.id)} 数量非法`);
  }
  for (const row of profiles) {
    if (!styleIds.has(String(row.styleId ?? ''))) problems.push(`收藏档案 ${String(row.id)} 的款式不存在`);
  }
  for (const row of refundLines) {
    if (!refundIds.has(String(row.refundId ?? ''))) problems.push('退款明细引用了不存在的退款');
    if (!lineIds.has(String(row.acquisitionLineId ?? ''))) problems.push('退款明细引用了不存在的购买明细');
  }
  for (const row of transferLines) {
    if (!transferIds.has(String(row.transferId ?? ''))) problems.push('转出明细引用了不存在的转出');
    if (!lineIds.has(String(row.acquisitionLineId ?? ''))) problems.push('转出明细引用了不存在的购买明细');
  }
  for (const row of acquisitions) {
    const source = String(row.source ?? '');
    if (!['official', 'secondhand', 'gift'].includes(source)) problems.push(`订单 ${String(row.id)} 来源非法`);
    if (source === 'gift' && row.paidTotalCents !== null) problems.push(`礼物订单 ${String(row.id)} 不应有金额`);
    if (source !== 'gift' && typeof row.paidTotalCents !== 'number') {
      problems.push(`订单 ${String(row.id)} 缺少实付金额`);
    }
  }

  const allocations = new Map<string, number>();
  for (const row of lines) {
    const amount = row.allocatedCents;
    if (amount !== null && (typeof amount !== 'number' || !Number.isSafeInteger(amount) || amount < 0)) {
      problems.push(`明细 ${String(row.id)} 分摊金额非法`);
    }
    const key = String(row.acquisitionId ?? '');
    allocations.set(key, (allocations.get(key) ?? 0) + (typeof amount === 'number' ? amount : 0));
  }

  for (const row of acquisitions) {
    if (row.source === 'gift') continue;
    const total = Number(row.paidTotalCents);
    const sum = allocations.get(String(row.id)) ?? 0;
    if (sum !== total) problems.push(`订单 ${String(row.id)} 分摊合计与实付不一致`);
  }

  return problems;
}

export interface RestoreSummary {
  readonly datasetId: string;
  readonly counts: Record<string, number>;
  readonly mediaCount: number;
}

/**
 * 恢复：把备份写入新的 staging 数据集，校验通过后一次切换 activeDatasetId。
 * 旧数据集保留为 retired，失败时不动当前数据。
 */
export async function restoreBackup(
  db: PopmartDb,
  inspection: BackupInspection,
): Promise<RestoreSummary> {
  const problems = validateBackupData(inspection.data);
  if (problems.length > 0) {
    throw new BackupError('REFERENCE_BROKEN', problems.slice(0, 5).join('；'));
  }

  const stagingId = crypto.randomUUID();
  const timestamp = nowIso();
  const tables = BACKUP_TABLES.map((name) => db.table(name));
  const meta = await db.appMeta.get('control');
  if (!meta) throw new BackupError('RESTORE_FAILED', '缺少 appMeta，无法恢复');

  const operationId = crypto.randomUUID();

  let restoredCounts: Record<string, number> = {};
  try {
    restoredCounts = await db.transaction('rw', [...tables, db.datasets, db.appMeta, db.mediaBlobs], async () => {
      await db.appMeta.put({ ...meta, maintenance: 'restore', maintenanceOpId: operationId });

      await db.datasets.put({
        id: stagingId,
        status: 'staging',
        schemaVersion: DATA_SCHEMA_VERSION,
        verifiedAt: timestamp,
      });

      const counts: Record<string, number> = {};
      for (const table of BACKUP_TABLES) {
        const rows = asRows(inspection.data[table]).map((row) => ({ ...row, datasetId: stagingId }));
        if (rows.length > 0) await db.table(table).bulkPut(rows);
        counts[table] = rows.length;
        const stored = await db.table(table).where({ datasetId: stagingId }).count();
        if (stored !== rows.length) {
          throw new BackupError('RESTORE_FAILED', `${table} 写入数量不一致`);
        }
      }

      for (const [hash, bytes] of inspection.media) {
        await db.mediaBlobs.put({
          datasetId: stagingId,
          id: hash,
          blob: new Blob([bytes as unknown as BlobPart], { type: 'application/octet-stream' }),
        });
      }

      const previous = await db.datasets.get(meta.activeDatasetId);
      if (previous) {
        await db.datasets.put({ ...previous, status: 'retired' });
      }
      const staging = await db.datasets.get(stagingId);
      if (!staging) throw new BackupError('RESTORE_FAILED', 'staging 数据集丢失');
      await db.datasets.put({ ...staging, status: 'active', verifiedAt: timestamp });

      await db.appMeta.put({
        ...meta,
        activeDatasetId: stagingId,
        maintenance: 'none',
        maintenanceOpId: null,
        appDataRevision: meta.appDataRevision + 1,
      });

      return counts;
    });
  } catch (error) {
    const current = await db.appMeta.get('control');
    if (current && current.maintenance !== 'none') {
      await db.appMeta.put({ ...current, maintenance: 'none', maintenanceOpId: null });
    }
    if (error instanceof BackupError) throw error;
    throw new BackupError('RESTORE_FAILED', error instanceof Error ? error.message : '恢复失败');
  }

  return {
    datasetId: stagingId,
    counts: restoredCounts,
    mediaCount: inspection.media.size,
  };
}
