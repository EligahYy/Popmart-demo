import 'fake-indexeddb/auto';
import { unzipSync, zipSync, strToU8, strFromU8 } from 'fflate';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { dayDate, type SeriesPreview } from '@my-popmart/contracts';
import { createDatabase, openDatabase, type PopmartDb } from '../db/database.js';
import {
  commitSeriesImport,
  createAcquisition,
  initializeDatabase,
  setBudget,
} from '../db/commands.js';
import { getSeriesViews, loadCollectionState } from '../db/queries.js';
import { cacheStyleImage } from '../media/cache.js';
import { createBackup } from './export.js';
import { inspectBackup, restoreBackup, validateBackupData } from './restore.js';
import { BackupError } from './format.js';

let imageCall = 0;
const imageFetch = (async () => {
  imageCall += 1;
  const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, imageCall, 9, 9]);
  return new Response(bytes, { status: 200, headers: { 'content-type': 'image/jpeg' } });
}) as unknown as typeof fetch;

function makePreview(): SeriesPreview {
  return {
    previewVersion: 2,
    candidateId: 'candidate',
    canonicalKey: 'popmart:ca:9120',
    ip: { canonicalKey: 'twinkle-twinkle', name: 'Twinkle Twinkle', aliases: [] },
    name: 'Live the Ordinary',
    productKind: 'figure',
    region: 'ca',
    sourceUrl: 'https://www.popmart.com/ca/products/9120',
    fetchedAt: '2026-11-12T00:00:00.000Z',
    parserVersion: 'test',
    seriesReferenceUnitCents: 6900,
    priceProvenance: 'user_confirmed',
    foreignReference: null,
    styles: ['Stay Curious', 'The Thinker'].map((name, index) => ({
      canonicalKey: name.toLowerCase().replace(/\s+/g, '-'),
      name,
      isSecret: false,
      image: { sourceUrl: `https://cdn.example.com/${index}.jpg`, assetToken: `token-${index}` },
      referenceUnitCents: null,
      sourcePrice: null,
    })),
    warnings: [],
  };
}

let db: PopmartDb;
let datasetId: string;
let styleIds: string[];
let purchaseCommandId: string;

beforeEach(async () => {
  db = createDatabase(`backup-test-${crypto.randomUUID()}`);
  await openDatabase(db);
  datasetId = await initializeDatabase(db);

  const committed = await commitSeriesImport(db, {
    commandId: crypto.randomUUID(),
    datasetId,
    preview: makePreview(),
    seriesReferenceUnitCents: 6900,
    priceProvenance: 'user_confirmed',
  });
  styleIds = Object.values(committed.styleIds);

  purchaseCommandId = crypto.randomUUID();
  await createAcquisition(db, {
    commandId: purchaseCommandId,
    datasetId,
    source: 'official',
    date: dayDate('2026-11-10'),
    paidTotalCents: 13800,
    lines: [
      {
        styleId: styleIds[0] ?? '',
        quantity: 2,
        allocatedCents: 13800,
        referenceUnitCentsSnapshot: 6900,
      },
    ],
  });

  await setBudget(db, {
    commandId: crypto.randomUUID(),
    datasetId,
    month: '2026-11',
    amountLimitCents: 30000,
    quantityLimit: 4,
  });

  await cacheStyleImage(db, datasetId, styleIds[0] ?? '', imageFetch);
  await cacheStyleImage(db, datasetId, styleIds[1] ?? '', imageFetch);
});

afterEach(async () => {
  await db.delete();
});

describe('createBackup + inspectBackup', () => {
  it('produces a valid zip with manifest, data and media', async () => {
    const backup = await createBackup(db, datasetId);
    expect(backup.manifest.mediaComplete).toBe(true);
    expect(backup.manifest.counts.styles).toBe(2);
    expect(backup.manifest.counts.acquisitions).toBe(1);
    expect(backup.manifest.missingMedia).toEqual([]);

    const files = unzipSync(new Uint8Array(await backup.blob.arrayBuffer()));
    expect(files['manifest.json']).toBeTruthy();
    expect(files['data/styles.json']).toBeTruthy();
    expect(Object.keys(files).filter((path) => path.startsWith('media/'))).toHaveLength(2);

    const inspection = await inspectBackup(await backup.blob.arrayBuffer());
    expect(inspection.data.styles).toHaveLength(2);
    expect(inspection.media.size).toBe(2);
    expect(validateBackupData(inspection.data)).toEqual([]);
  });

  it('detects a tampered data file', async () => {
    const backup = await createBackup(db, datasetId);
    const files = unzipSync(new Uint8Array(await backup.blob.arrayBuffer()));
    const styles = strFromU8(files['data/styles.json'] ?? new Uint8Array());
    files['data/styles.json'] = strToU8(styles.replace('Stay Curious', 'Tampered'));
    const tampered = zipSync(files);

    await expect(inspectBackup(tampered.buffer as ArrayBuffer)).rejects.toBeInstanceOf(BackupError);
  });

  it('rejects broken references during validation', async () => {
    const backup = await createBackup(db, datasetId);
    const inspection = await inspectBackup(await backup.blob.arrayBuffer());
    const data = { ...inspection.data, series: [] };
    expect(validateBackupData(data).length).toBeGreaterThan(0);
  });
});

describe('restoreBackup', () => {
  it('restores into a new active dataset and keeps the old one retired', async () => {
    const backup = await createBackup(db, datasetId);
    const inspection = await inspectBackup(await backup.blob.arrayBuffer());

    const oldDatasetId = datasetId;
    const result = await restoreBackup(db, inspection);

    expect(result.datasetId).not.toBe(oldDatasetId);
    const meta = await db.appMeta.get('control');
    expect(meta?.activeDatasetId).toBe(result.datasetId);
    expect(meta?.maintenance).toBe('none');

    const oldDataset = await db.datasets.get(oldDatasetId);
    expect(oldDataset?.status).toBe('retired');
    const newDataset = await db.datasets.get(result.datasetId);
    expect(newDataset?.status).toBe('active');

    const styles = await db.styles.where({ datasetId: result.datasetId }).toArray();
    expect(styles).toHaveLength(2);
    const blobs = await db.mediaBlobs.where({ datasetId: result.datasetId }).toArray();
    expect(blobs).toHaveLength(2);

    const state = await loadCollectionState(db, result.datasetId);
    expect(state.netSpendCents).toBe(13800);

    // 幂等历史随备份恢复：同一 commandId 重放不会重复入账
    const replay = await createAcquisition(db, {
      commandId: purchaseCommandId,
      datasetId: result.datasetId,
      source: 'official',
      date: dayDate('2026-11-10'),
      paidTotalCents: 13800,
      lines: [
        {
          styleId: styleIds[0] ?? '',
          quantity: 2,
          allocatedCents: 13800,
          referenceUnitCentsSnapshot: 6900,
        },
      ],
    });
    expect(replay.replayed).toBe(true);
    expect(await db.acquisitions.where({ datasetId: result.datasetId }).count()).toBe(1);
    const views = await getSeriesViews(db, result.datasetId);
    expect(views[0]?.heldTotal).toBe(2);
  });

  it('refuses a backup with broken references and leaves data untouched', async () => {
    const backup = await createBackup(db, datasetId);
    const inspection = await inspectBackup(await backup.blob.arrayBuffer());
    const broken = { ...inspection, data: { ...inspection.data, styles: [] } };

    const before = await db.appMeta.get('control');
    await expect(restoreBackup(db, broken)).rejects.toBeInstanceOf(BackupError);
    const after = await db.appMeta.get('control');
    expect(after?.activeDatasetId).toBe(before?.activeDatasetId);
    expect(await db.styles.where({ datasetId }).count()).toBe(2);
  });
});
