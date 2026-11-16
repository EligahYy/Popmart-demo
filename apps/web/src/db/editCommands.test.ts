import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { dayDate } from '@my-popmart/contracts';
import { createDatabase, openDatabase, type PopmartDb } from './database.js';
import {
  createAcquisition,
  createRefund,
  createTransfer,
  deleteAcquisition,
  initializeDatabase,
  putStyleForTest,
  updateAcquisition,
} from './commands.js';
import { loadCollectionState } from './queries.js';

let db: PopmartDb;
let datasetId: string;
let acquisitionId: string;
let lineA: string;
let lineB: string;

beforeEach(async () => {
  db = createDatabase(`edit-test-${crypto.randomUUID()}`);
  await openDatabase(db);
  datasetId = await initializeDatabase(db);
  await putStyleForTest(db, datasetId, { id: 'style-a', seriesId: 's1', canonicalKey: 'a', displayName: 'A' });
  await putStyleForTest(db, datasetId, { id: 'style-b', seriesId: 's1', canonicalKey: 'b', displayName: 'B' });

  const result = await createAcquisition(db, {
    commandId: crypto.randomUUID(),
    datasetId,
    source: 'official',
    date: dayDate('2026-11-10'),
    paidTotalCents: 24000,
    lines: [
      { styleId: 'style-a', quantity: 2, allocatedCents: 12000, referenceUnitCentsSnapshot: 6900 },
      { styleId: 'style-b', quantity: 1, allocatedCents: 12000, referenceUnitCentsSnapshot: 13800 },
    ],
  });
  acquisitionId = result.acquisitionId;
  lineA = result.lineIds[0] ?? '';
  lineB = result.lineIds[1] ?? '';
});

afterEach(async () => {
  await db.delete();
});

describe('updateAcquisition', () => {
  it('changes the paid total and reallocates by reference weight', async () => {
    const result = await updateAcquisition(db, {
      commandId: crypto.randomUUID(),
      datasetId,
      acquisitionId,
      expectedRevision: 1,
      patch: { paidTotalCents: 18000 },
    });
    expect(result.revision).toBe(2);

    const lines = await db.acquisitionLines.where({ datasetId, acquisitionId }).toArray();
    expect(lines.map((line) => line.allocatedCents).sort()).toEqual([9000, 9000]);

    const state = await loadCollectionState(db, datasetId);
    expect(state.netSpendCents).toBe(18000);
  });

  it('rejects a stale revision', async () => {
    await expect(
      updateAcquisition(db, {
        commandId: crypto.randomUUID(),
        datasetId,
        acquisitionId,
        expectedRevision: 5,
        patch: { note: 'stale' },
      }),
    ).rejects.toMatchObject({ code: 'INVALID_DRAFT' });
  });

  it('switches to gift and clears amounts', async () => {
    await updateAcquisition(db, {
      commandId: crypto.randomUUID(),
      datasetId,
      acquisitionId,
      expectedRevision: 1,
      patch: { source: 'gift' },
    });
    const acquisition = await db.acquisitions.get([datasetId, acquisitionId]);
    expect(acquisition?.paidTotalCents).toBeNull();
    const lines = await db.acquisitionLines.where({ datasetId, acquisitionId }).toArray();
    expect(lines.every((line) => line.allocatedCents === null)).toBe(true);

    const state = await loadCollectionState(db, datasetId);
    expect(state.netSpendCents).toBe(0);
    expect(state.netBoughtQty).toBe(0);
  });

  it('does not allow gift when a refund exists', async () => {
    await createRefund(db, {
      commandId: crypto.randomUUID(),
      datasetId,
      acquisitionId,
      kind: 'refund_only',
      processedOn: '2026-11-12',
      totalCents: 2000,
      lines: [{ lineId: lineA, refundCents: 2000, returnedQuantity: 0 }],
    });

    await expect(
      updateAcquisition(db, {
        commandId: crypto.randomUUID(),
        datasetId,
        acquisitionId,
        expectedRevision: 1,
        patch: { source: 'gift' },
      }),
    ).rejects.toMatchObject({ code: 'INVALID_DRAFT' });
  });
});

describe('createRefund', () => {
  it('T03: refund-only lowers spend without changing quantity', async () => {
    await createRefund(db, {
      commandId: crypto.randomUUID(),
      datasetId,
      acquisitionId,
      kind: 'refund_only',
      processedOn: '2026-11-12',
      totalCents: 2000,
      lines: [{ lineId: lineA, refundCents: 2000, returnedQuantity: 0 }],
    });

    const state = await loadCollectionState(db, datasetId);
    expect(state.netSpendCents).toBe(22000);
    expect(state.netBoughtQty).toBe(3);
  });

  it('T04: return lowers both quantity and spend', async () => {
    await createRefund(db, {
      commandId: crypto.randomUUID(),
      datasetId,
      acquisitionId,
      kind: 'return',
      processedOn: '2026-11-12',
      totalCents: 5000,
      lines: [{ lineId: lineA, refundCents: 5000, returnedQuantity: 1 }],
    });

    const state = await loadCollectionState(db, datasetId);
    expect(state.netSpendCents).toBe(19000);
    expect(state.netBoughtQty).toBe(2);
    expect([...state.heldByStyle.values()].reduce((total, value) => total + value, 0)).toBe(2);
  });

  it('rejects a refund above the line allocation', async () => {
    await expect(
      createRefund(db, {
        commandId: crypto.randomUUID(),
        datasetId,
        acquisitionId,
        kind: 'refund_only',
        processedOn: '2026-11-12',
        totalCents: 13000,
        lines: [{ lineId: lineA, refundCents: 13000, returnedQuantity: 0 }],
      }),
    ).rejects.toMatchObject({ code: 'INVALID_DRAFT' });
  });

  it('rejects mismatched totals', async () => {
    await expect(
      createRefund(db, {
        commandId: crypto.randomUUID(),
        datasetId,
        acquisitionId,
        kind: 'refund_only',
        processedOn: '2026-11-12',
        totalCents: 5000,
        lines: [{ lineId: lineA, refundCents: 2000, returnedQuantity: 0 }],
      }),
    ).rejects.toMatchObject({ code: 'INVALID_DRAFT' });
  });
});

describe('createTransfer', () => {
  it('T05: giving away reduces holding but keeps history', async () => {
    await createTransfer(db, {
      commandId: crypto.randomUUID(),
      datasetId,
      kind: 'give_away',
      occurredOn: '2026-11-12',
      lines: [{ lineId: lineA, quantity: 2 }],
    });

    const state = await loadCollectionState(db, datasetId);
    expect([...state.heldByStyle.values()].reduce((total, value) => total + value, 0)).toBe(1);
    expect(state.netSpendCents).toBe(24000);
    expect(state.netBoughtQty).toBe(3);
  });

  it('rejects transferring more than held', async () => {
    await expect(
      createTransfer(db, {
        commandId: crypto.randomUUID(),
        datasetId,
        kind: 'sold',
        occurredOn: '2026-11-12',
        lines: [{ lineId: lineB, quantity: 2 }],
      }),
    ).rejects.toMatchObject({ code: 'INVALID_DRAFT' });
  });
});

describe('deleteAcquisition', () => {
  it('removes order, lines and derived stats', async () => {
    await createRefund(db, {
      commandId: crypto.randomUUID(),
      datasetId,
      acquisitionId,
      kind: 'refund_only',
      processedOn: '2026-11-12',
      totalCents: 2000,
      lines: [{ lineId: lineA, refundCents: 2000, returnedQuantity: 0 }],
    });

    await deleteAcquisition(db, {
      commandId: crypto.randomUUID(),
      datasetId,
      acquisitionId,
    });

    const state = await loadCollectionState(db, datasetId);
    expect(state.netSpendCents).toBe(0);
    expect(state.netBoughtQty).toBe(0);
    expect([...state.heldByStyle.values()].reduce((total, value) => total + value, 0)).toBe(0);

    const refunds = await db.refunds.where({ datasetId }).toArray();
    expect(refunds.every((refund) => refund.status === 'deleted')).toBe(true);
  });

  it('tombstones the order without physically deleting rows', async () => {
    await deleteAcquisition(db, { commandId: crypto.randomUUID(), datasetId, acquisitionId });
    const acquisition = await db.acquisitions.get([datasetId, acquisitionId]);
    expect(acquisition?.status).toBe('deleted');
    expect(await db.acquisitionLines.where({ datasetId }).count()).toBe(2);
  });
});

describe('updateCollectionProfile', () => {
  it('saves nickname and story without touching amounts', async () => {
    const { updateCollectionProfile } = await import('./commands.js');
    await updateCollectionProfile(db, {
      commandId: crypto.randomUUID(),
      datasetId,
      styleId: 'style-a',
      nickname: '小星',
      story: '第一次抽到隐藏款的那天',
    });

    const profile = await db.collectionProfiles
      .where('[datasetId+styleId]')
      .equals([datasetId, 'style-a'])
      .first();
    expect(profile?.nickname).toBe('小星');
    expect(profile?.story).toBe('第一次抽到隐藏款的那天');

    const state = await loadCollectionState(db, datasetId);
    expect(state.netSpendCents).toBe(24000);
  });

  it('rejects overly long input', async () => {
    const { updateCollectionProfile } = await import('./commands.js');
    await expect(
      updateCollectionProfile(db, {
        commandId: crypto.randomUUID(),
        datasetId,
        styleId: 'style-a',
        nickname: 'x'.repeat(31),
        story: null,
      }),
    ).rejects.toMatchObject({ code: 'INVALID_DRAFT' });
  });

  it('is idempotent by commandId', async () => {
    const { updateCollectionProfile } = await import('./commands.js');
    const commandId = crypto.randomUUID();
    const input = { commandId, datasetId, styleId: 'style-a', nickname: '星', story: null };
    await updateCollectionProfile(db, input);
    const second = await updateCollectionProfile(db, input);
    expect(second.replayed).toBe(true);
  });
});

describe('quantity editing', () => {
  it('reallocates proportionally when quantity changes', async () => {
    await updateAcquisition(db, {
      commandId: crypto.randomUUID(),
      datasetId,
      acquisitionId,
      expectedRevision: 1,
      patch: { lines: [{ lineId: lineA, quantity: 3 }] },
    });

    const lines = await db.acquisitionLines.where({ datasetId, acquisitionId }).toArray();
    const byId = new Map(lines.map((line) => [line.id, line]));
    expect(byId.get(lineA)?.quantity).toBe(3);
    expect(byId.get(lineA)?.allocatedCents).toBe(14400);
    expect(byId.get(lineB)?.allocatedCents).toBe(9600);

    const state = await loadCollectionState(db, datasetId);
    expect(state.netSpendCents).toBe(24000);
  });

  it('refuses to reduce quantity below returned units', async () => {
    await createRefund(db, {
      commandId: crypto.randomUUID(),
      datasetId,
      acquisitionId,
      kind: 'return',
      processedOn: '2026-11-12',
      totalCents: 12000,
      lines: [{ lineId: lineA, refundCents: 12000, returnedQuantity: 2 }],
    });

    await expect(
      updateAcquisition(db, {
        commandId: crypto.randomUUID(),
        datasetId,
        acquisitionId,
        expectedRevision: 1,
        patch: { lines: [{ lineId: lineA, quantity: 1 }] },
      }),
    ).rejects.toMatchObject({ code: 'INVALID_DRAFT' });
  });
});

describe('amount validation', () => {
  it('rejects a purchase without a paid amount', async () => {
    await expect(
      createAcquisition(db, {
        commandId: crypto.randomUUID(),
        datasetId,
        source: 'official',
        date: dayDate('2026-11-12'),
        paidTotalCents: null,
        lines: [
          { styleId: 'style-a', quantity: 1, allocatedCents: 6900, referenceUnitCentsSnapshot: 6900 },
        ],
      }),
    ).rejects.toMatchObject({ code: 'INVALID_DRAFT' });
  });
});

describe('repeat purchase', () => {
  it('keeps two purchase records and sums held quantity for the same style', async () => {
    await createAcquisition(db, {
      commandId: crypto.randomUUID(),
      datasetId,
      source: 'official',
      date: dayDate('2026-11-11'),
      paidTotalCents: 6900,
      lines: [
        { styleId: 'style-a', quantity: 1, allocatedCents: 6900, referenceUnitCentsSnapshot: 6900 },
      ],
    });

    const state = await loadCollectionState(db, datasetId);
    expect(state.heldByStyle.get('style-a')).toBe(3);
    expect(await db.acquisitions.where({ datasetId }).count()).toBe(2);
  });
});

describe('multi-line refund', () => {
  it('splits one refund across several lines', async () => {
    await createRefund(db, {
      commandId: crypto.randomUUID(),
      datasetId,
      acquisitionId,
      kind: 'refund_only',
      processedOn: '2026-11-12',
      totalCents: 3000,
      lines: [
        { lineId: lineA, refundCents: 2000, returnedQuantity: 0 },
        { lineId: lineB, refundCents: 1000, returnedQuantity: 0 },
      ],
    });

    const state = await loadCollectionState(db, datasetId);
    expect(state.netSpendCents).toBe(21000);
    expect(state.netBoughtQty).toBe(3);

    const refunds = await db.refunds.where({ datasetId }).toArray();
    expect(refunds).toHaveLength(1);
    expect(refunds[0]?.totalCents).toBe(3000);
  });
});
