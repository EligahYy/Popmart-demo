import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { dayDate, type SeriesPreview } from '@my-popmart/contracts';
import { createDatabase, openDatabase, type PopmartDb } from './database.js';
import {
  commitSeriesImport,
  createAcquisition,
  createRefund,
  initializeDatabase,
  setBudget,
} from './commands.js';
import { getBudgetLimits, loadLedgerData, monthUsage } from './ledgerData.js';
import { aggregatePeriod, recordsByIp } from '../domain/ledger.js';

function preview(ipKey: string, ipName: string, styleKey: string, suffix: string): SeriesPreview {
  return {
    previewVersion: 2,
    candidateId: `candidate-${suffix}`,
    canonicalKey: `popmart:ca:${suffix}`,
    ip: { canonicalKey: ipKey, name: ipName, aliases: [] },
    name: `Series ${suffix}`,
    productKind: 'figure',
    region: 'ca',
    sourceUrl: `https://www.popmart.com/ca/products/${suffix}`,
    fetchedAt: '2026-11-12T00:00:00.000Z',
    parserVersion: 'test',
    seriesReferenceUnitCents: 6900,
    priceProvenance: 'user_confirmed',
    foreignReference: null,
    styles: [
      {
        canonicalKey: styleKey,
        name: styleKey,
        isSecret: false,
        image: { sourceUrl: `https://cdn.example.com/${styleKey}.jpg`, assetToken: 't' },
        referenceUnitCents: null,
        sourcePrice: null,
      },
    ],
    warnings: [],
  };
}

let db: PopmartDb;
let datasetId: string;
let styleA: string;
let styleB: string;

beforeEach(async () => {
  db = createDatabase(`ledger-data-${crypto.randomUUID()}`);
  await openDatabase(db);
  datasetId = await initializeDatabase(db);

  const a = await commitSeriesImport(db, {
    commandId: crypto.randomUUID(),
    datasetId,
    preview: preview('twinkle-twinkle', 'Twinkle Twinkle', 'star', '1001'),
    seriesReferenceUnitCents: 6900,
    priceProvenance: 'user_confirmed',
  });
  const b = await commitSeriesImport(db, {
    commandId: crypto.randomUUID(),
    datasetId,
    preview: preview('crybaby', 'CRYBABY', 'tear', '1002'),
    seriesReferenceUnitCents: 6900,
    priceProvenance: 'user_confirmed',
  });
  styleA = a.styleIds.star ?? '';
  styleB = b.styleIds.tear ?? '';
});

afterEach(async () => {
  await db.delete();
});

describe('multi-IP order', () => {
  it('attributes each line to its IP and keeps the order total intact', async () => {
    await createAcquisition(db, {
      commandId: crypto.randomUUID(),
      datasetId,
      source: 'official',
      date: dayDate('2026-11-10'),
      paidTotalCents: 10000,
      lines: [
        { styleId: styleA, quantity: 1, allocatedCents: 6000, referenceUnitCentsSnapshot: 6900 },
        { styleId: styleB, quantity: 1, allocatedCents: 4000, referenceUnitCentsSnapshot: 6900 },
      ],
    });

    const data = await loadLedgerData(db, datasetId);
    expect(data.records).toHaveLength(2);
    const ipIds = new Set(data.records.map((record) => record.ipId));
    expect(ipIds.size).toBe(2);

    const onlyTwinkle = recordsByIp(data.records, data.records.find((r) => r.ipName === 'Twinkle Twinkle')!.ipId);
    const aggregate = aggregatePeriod(onlyTwinkle, { kind: 'month', anchor: '2026-11-10' }, '2026-11-10', 2026);
    expect(aggregate.totalCents).toBe(6000);

    const total = aggregatePeriod(data.records, { kind: 'month', anchor: '2026-11-10' }, '2026-11-10', 2026);
    expect(total.totalCents).toBe(10000);
  });
});

describe('refund across months', () => {
  it('reduces the original purchase month, not the processing month', async () => {
    const result = await createAcquisition(db, {
      commandId: crypto.randomUUID(),
      datasetId,
      source: 'official',
      date: dayDate('2026-11-10'),
      paidTotalCents: 13800,
      lines: [
        { styleId: styleA, quantity: 2, allocatedCents: 13800, referenceUnitCentsSnapshot: 6900 },
      ],
    });

    await createRefund(db, {
      commandId: crypto.randomUUID(),
      datasetId,
      acquisitionId: result.acquisitionId,
      kind: 'refund_only',
      processedOn: '2026-12-05',
      totalCents: 2000,
      lines: [{ lineId: result.lineIds[0] ?? '', refundCents: 2000, returnedQuantity: 0 }],
    });

    const data = await loadLedgerData(db, datasetId);
    expect(data.records[0]?.date.precision).toBe('day');
    expect(data.records[0]?.statsCents).toBe(11800);
    expect(monthUsage(data.records, '2026-11').cents).toBe(11800);
    expect(monthUsage(data.records, '2026-12').cents).toBe(0);
  });
});

describe('budget rules across months', () => {
  it('reuses the latest rule for later months without carrying balances', async () => {
    await setBudget(db, {
      commandId: crypto.randomUUID(),
      datasetId,
      month: '2026-11',
      amountLimitCents: 30000,
      quantityLimit: 4,
    });

    const november = await getBudgetLimits(db, datasetId, '2026-11');
    const december = await getBudgetLimits(db, datasetId, '2026-12');
    expect(november.amountLimitCents).toBe(30000);
    expect(december.amountLimitCents).toBe(30000);
    expect(december.quantityLimit).toBe(4);
    expect(december.fromSnapshot).toBe(false);

    await createAcquisition(db, {
      commandId: crypto.randomUUID(),
      datasetId,
      source: 'official',
      date: dayDate('2026-11-10'),
      paidTotalCents: 6900,
      lines: [{ styleId: styleA, quantity: 1, allocatedCents: 6900, referenceUnitCentsSnapshot: 6900 }],
    });

    const data = await loadLedgerData(db, datasetId);
    expect(monthUsage(data.records, '2026-11').cents).toBe(6900);
    expect(monthUsage(data.records, '2026-12').cents).toBe(0);
  });

  it('keeps historical months untouched when a new rule is set', async () => {
    await setBudget(db, {
      commandId: crypto.randomUUID(),
      datasetId,
      month: '2026-11',
      amountLimitCents: 30000,
      quantityLimit: 4,
    });
    await setBudget(db, {
      commandId: crypto.randomUUID(),
      datasetId,
      month: '2026-12',
      amountLimitCents: 50000,
      quantityLimit: 6,
    });

    const november = await getBudgetLimits(db, datasetId, '2026-11');
    const december = await getBudgetLimits(db, datasetId, '2026-12');
    expect(november.amountLimitCents).toBe(30000);
    expect(december.amountLimitCents).toBe(50000);
  });
});
