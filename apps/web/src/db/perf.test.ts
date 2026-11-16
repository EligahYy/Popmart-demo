import 'fake-indexeddb/auto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDatabase, openDatabase, type PopmartDb } from './database.js';
import { initializeDatabase } from './commands.js';
import { loadLedgerData } from './ledgerData.js';
import type { AcquisitionLineRow } from './rows.js';
import { aggregatePeriod } from '../domain/ledger.js';

const ORDER_COUNT = 200;
const LINES_PER_ORDER = 50;
const TOTAL_LINES = ORDER_COUNT * LINES_PER_ORDER;

let db: PopmartDb;
let datasetId: string;

function baseRow<T extends Record<string, unknown>>(id: string, extra: T) {
  return {
    datasetId,
    id,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    revision: 1,
    ...extra,
  };
}

beforeAll(async () => {
  db = createDatabase(`perf-${crypto.randomUUID()}`);
  await openDatabase(db);
  datasetId = await initializeDatabase(db);

  await db.ips.put(baseRow('ip-1', { canonicalKey: 'twinkle', displayName: 'Twinkle', aliases: [], sortOrder: 0 }));
  await db.series.put(
    baseRow('series-1', {
      ipId: 'ip-1',
      canonicalKey: 'series-1',
      displayName: 'Series',
      aliases: [],
      productKind: 'figure' as const,
      sortOrder: 0,
      defaultUnitCents: 6900,
      priceProvenance: null,
      priceUpdatedAt: null,
      foreignReference: null,
      sourceUrl: null,
      importedAt: null,
    }),
  );

  const styles = Array.from({ length: 100 }, (_, index) =>
    baseRow(`style-${index}`, {
      seriesId: 'series-1',
      canonicalKey: `style-${index}`,
      displayName: `Style ${index}`,
      isSecret: false,
      imageAssetId: null,
      imageUrl: null,
      mediaStatus: 'missing' as const,
      referenceUnitCents: 6900,
      priceProvenance: null,
      priceUpdatedAt: null,
      sortOrder: index,
    }),
  );
  await db.styles.bulkPut(styles);

  const acquisitions = Array.from({ length: ORDER_COUNT }, (_, index) =>
    baseRow(`order-${index}`, {
      source: 'official' as const,
      date: {
        precision: 'day' as const,
        day: `2026-${String((index % 12) + 1).padStart(2, '0')}-10`,
        month: `2026-${String((index % 12) + 1).padStart(2, '0')}`,
      },
      paidTotalCents: LINES_PER_ORDER * 1000,
      channel: null,
      note: null,
      status: 'active' as const,
      commandId: `cmd-${index}`,
    }),
  );

  const lines: Array<Record<string, unknown>> = [];
  for (let order = 0; order < ORDER_COUNT; order += 1) {
    for (let index = 0; index < LINES_PER_ORDER; index += 1) {
      lines.push(
        baseRow(`line-${order}-${index}`, {
          acquisitionId: `order-${order}`,
          styleId: `style-${index % 100}`,
          quantity: 1,
          allocatedCents: 1000,
          referenceUnitCentsSnapshot: 6900,
          allocationMode: 'proportional' as const,
          lineOrder: index,
          status: 'active' as const,
        }),
      );
    }
  }

  await db.acquisitions.bulkPut(acquisitions);
  await db.acquisitionLines.bulkPut(lines as unknown as AcquisitionLineRow[]);
}, 120_000);

afterAll(async () => {
  await db.delete();
});

describe(`ledger performance (${TOTAL_LINES} lines)`, () => {
  it('loads and aggregates within the target budget', async () => {
    const loadStart = performance.now();
    const data = await loadLedgerData(db, datasetId);
    const loadMs = performance.now() - loadStart;

    const aggregateStart = performance.now();
    const year = aggregatePeriod(data.records, { kind: 'year', anchor: '2026-06-01' }, '2026-06-01', 2026);
    const aggregateMs = performance.now() - aggregateStart;

    console.log(
      `[perf] rows=${data.records.length} load=${loadMs.toFixed(0)}ms aggregate=${aggregateMs.toFixed(1)}ms`,
    );

    expect(data.records).toHaveLength(TOTAL_LINES);
    expect(year.totalCents).toBe(TOTAL_LINES * 1000);
    // PRD 目标：统计 10,000 行在 300ms 内
    expect(aggregateMs).toBeLessThan(300);
    // 读取 + 派生整体不阻塞交互；具体数值随设备不同，记录在验收报告
    expect(loadMs).toBeLessThan(3000);
  }, 120_000);
});
