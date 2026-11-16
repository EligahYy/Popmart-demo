import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { dayDate } from '@my-popmart/contracts';
import { createDatabase, openDatabase, type PopmartDb } from './database.js';
import {
  CommandError,
  createAcquisition,
  initializeDatabase,
  putStyleForTest,
  type CreateAcquisitionInput,
} from './commands.js';

let db: PopmartDb;
let datasetId: string;

async function setup(): Promise<void> {
  db = createDatabase(`my-popmart-test-${crypto.randomUUID()}`);
  await openDatabase(db);
  datasetId = await initializeDatabase(db);
  await putStyleForTest(db, datasetId, {
    id: 'style-a',
    seriesId: 'series-1',
    canonicalKey: 'a',
    displayName: 'Stay Curious',
  });
  await putStyleForTest(db, datasetId, {
    id: 'style-b',
    seriesId: 'series-1',
    canonicalKey: 'b',
    displayName: 'The Thinker',
  });
}

function baseInput(overrides: Partial<CreateAcquisitionInput> = {}): CreateAcquisitionInput {
  return {
    commandId: crypto.randomUUID(),
    datasetId,
    source: 'official',
    date: dayDate('2026-11-12'),
    paidTotalCents: 13800,
    lines: [
      {
        styleId: 'style-a',
        quantity: 2,
        allocatedCents: 13800,
        referenceUnitCentsSnapshot: 6900,
      },
    ],
    ...overrides,
  };
}

beforeEach(async () => {
  await setup();
});

afterEach(async () => {
  await db.delete();
});

describe('createAcquisition', () => {
  it('writes order, lines and collection numbers atomically', async () => {
    const input = baseInput();
    const result = await createAcquisition(db, input);

    expect(result.replayed).toBe(false);
    expect(result.collectionNos).toEqual([{ styleId: 'style-a', collectionNo: 'MP-000001' }]);

    const order = await db.acquisitions.get([datasetId, result.acquisitionId]);
    expect(order?.paidTotalCents).toBe(13800);
    expect(order?.source).toBe('official');

    const lines = await db.acquisitionLines.where({ datasetId }).toArray();
    expect(lines).toHaveLength(1);
    expect(lines[0]?.quantity).toBe(2);
    expect(lines[0]?.allocatedCents).toBe(13800);

    const profiles = await db.collectionProfiles.where({ datasetId }).toArray();
    expect(profiles).toHaveLength(1);
    expect(profiles[0]?.collectionNo).toBe('MP-000001');
  });

  it('allocates sequential collection numbers per new style', async () => {
    await createAcquisition(db, baseInput());
    await createAcquisition(db, baseInput({ lines: [
      { styleId: 'style-b', quantity: 1, allocatedCents: 6900, referenceUnitCentsSnapshot: 6900 },
    ], paidTotalCents: 6900 }));

    const profiles = await db.collectionProfiles.where({ datasetId }).toArray();
    expect(profiles.map((profile) => profile.collectionNo).sort()).toEqual(['MP-000001', 'MP-000002']);
  });

  it('T11: same commandId twice creates one order', async () => {
    const input = baseInput();
    const first = await createAcquisition(db, input);
    const second = await createAcquisition(db, input);

    expect(second.acquisitionId).toBe(first.acquisitionId);
    expect(second.replayed).toBe(true);

    const orders = await db.acquisitions.where({ datasetId }).toArray();
    expect(orders).toHaveLength(1);
    const lines = await db.acquisitionLines.where({ datasetId }).toArray();
    expect(lines).toHaveLength(1);
    const meta = await db.appMeta.get('control');
    expect(meta?.appDataRevision).toBe(1);
  });

  it('rejects the same commandId with different payload', async () => {
    const input = baseInput();
    await createAcquisition(db, input);
    await expect(
      createAcquisition(db, { ...input, paidTotalCents: 6900, lines: [
        { styleId: 'style-a', quantity: 1, allocatedCents: 6900, referenceUnitCentsSnapshot: 6900 },
      ] }),
    ).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
  });

  it('rejects allocations that do not sum to the paid total', async () => {
    const input = baseInput({
      paidTotalCents: 13800,
      lines: [
        { styleId: 'style-a', quantity: 2, allocatedCents: 12000, referenceUnitCentsSnapshot: 6900 },
      ],
    });
    await expect(createAcquisition(db, input)).rejects.toBeInstanceOf(CommandError);
    expect(await db.acquisitions.count()).toBe(0);
  });

  it('rejects gift records carrying money', async () => {
    const input = baseInput({ source: 'gift', paidTotalCents: 6900 });
    await expect(createAcquisition(db, input)).rejects.toMatchObject({ code: 'INVALID_DRAFT' });
  });

  it('accepts gift with null amounts', async () => {
    const input = baseInput({
      source: 'gift',
      paidTotalCents: null,
      lines: [
        { styleId: 'style-a', quantity: 1, allocatedCents: null, referenceUnitCentsSnapshot: null },
      ],
    });
    const result = await createAcquisition(db, input);
    const order = await db.acquisitions.get([datasetId, result.acquisitionId]);
    expect(order?.paidTotalCents).toBeNull();
  });

  it('fails on unknown style and persists nothing', async () => {
    const input = baseInput({
      paidTotalCents: 6900,
      lines: [
        { styleId: 'missing', quantity: 1, allocatedCents: 6900, referenceUnitCentsSnapshot: 6900 },
      ],
    });
    await expect(createAcquisition(db, input)).rejects.toMatchObject({ code: 'STYLE_NOT_FOUND' });
    expect(await db.acquisitions.count()).toBe(0);
    expect(await db.acquisitionLines.count()).toBe(0);
  });

  it('blocks writes while maintenance is running', async () => {
    const meta = await db.appMeta.get('control');
    if (!meta) throw new Error('missing meta');
    await db.appMeta.put({ ...meta, maintenance: 'restore' });

    await expect(createAcquisition(db, baseInput())).rejects.toMatchObject({ code: 'MAINTENANCE' });
    expect(await db.acquisitions.count()).toBe(0);
  });
});
