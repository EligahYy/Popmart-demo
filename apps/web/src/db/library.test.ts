import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { dayDate, type SeriesPreview } from '@my-popmart/contracts';
import { createDatabase, openDatabase, type PopmartDb } from './database.js';
import { commitSeriesImport, createAcquisition, initializeDatabase, putStyleForTest } from './commands.js';
import { getSeriesViews, loadCollectionState } from './queries.js';

let db: PopmartDb;
let datasetId: string;

function makePreview(styleNames: string[] = ['Stay Curious', 'The Thinker']): SeriesPreview {
  return {
    previewVersion: 2,
    candidateId: 'candidate',
    canonicalKey: 'popmart:ca:9120',
    ip: { canonicalKey: 'twinkle-twinkle', name: 'Twinkle Twinkle', aliases: [] },
    name: 'Twinkle Twinkle Live the Ordinary Series Figures',
    productKind: 'figure',
    region: 'ca',
    sourceUrl: 'https://www.popmart.com/ca/products/9120',
    fetchedAt: '2026-11-12T00:00:00.000Z',
    parserVersion: 'test',
    seriesReferenceUnitCents: null,
    priceProvenance: null,
    foreignReference: null,
    styles: styleNames.map((name, index) => ({
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

beforeEach(async () => {
  db = createDatabase(`library-test-${crypto.randomUUID()}`);
  await openDatabase(db);
  datasetId = await initializeDatabase(db);
});

afterEach(async () => {
  await db.delete();
});

describe('commitSeriesImport', () => {
  it('creates ip, series and styles on first import', async () => {
    const result = await commitSeriesImport(db, {
      commandId: crypto.randomUUID(),
      datasetId,
      preview: makePreview(),
      seriesReferenceUnitCents: 6900,
      priceProvenance: 'user_confirmed',
    });

    expect(result.createdStyles).toBe(2);
    expect(result.updatedStyles).toBe(0);

    const series = await db.series.get([datasetId, result.seriesId]);
    expect(series?.displayName).toBe('Twinkle Twinkle Live the Ordinary Series Figures');
    expect(series?.defaultUnitCents).toBe(6900);
    expect(series?.priceProvenance).toBe('user_confirmed');

    const styles = await db.styles.where({ datasetId }).toArray();
    expect(styles).toHaveLength(2);
    expect(styles.every((style) => style.mediaStatus === 'remote')).toBe(true);
    expect(styles.every((style) => style.imageUrl !== null)).toBe(true);
  });

  it('re-import updates styles without duplicating or deleting', async () => {
    const preview = makePreview();
    const first = await commitSeriesImport(db, {
      commandId: crypto.randomUUID(),
      datasetId,
      preview,
      seriesReferenceUnitCents: 6900,
      priceProvenance: 'user_confirmed',
    });

    const second = await commitSeriesImport(db, {
      commandId: crypto.randomUUID(),
      datasetId,
      preview: makePreview(['Stay Curious', 'The Thinker', 'Mind Drift']),
      seriesReferenceUnitCents: null,
      priceProvenance: null,
    });

    expect(second.seriesId).toBe(first.seriesId);
    expect(second.createdStyles).toBe(1);
    expect(second.updatedStyles).toBe(2);
    expect(await db.styles.where({ datasetId }).count()).toBe(3);

    // 未提供新价格时保留原参考价
    const series = await db.series.get([datasetId, first.seriesId]);
    expect(series?.defaultUnitCents).toBe(6900);
  });

  it('keeps user price and personal fields when re-importing', async () => {
    const preview = makePreview();
    const first = await commitSeriesImport(db, {
      commandId: crypto.randomUUID(),
      datasetId,
      preview,
      seriesReferenceUnitCents: 6900,
      priceProvenance: 'user_confirmed',
    });

    const styleId = first.styleIds['stay-curious'];
    if (!styleId) throw new Error('missing style');
    const style = await db.styles.get([datasetId, styleId]);
    await db.styles.put({ ...style!, referenceUnitCents: 9900, priceProvenance: 'user_confirmed' });

    await commitSeriesImport(db, {
      commandId: crypto.randomUUID(),
      datasetId,
      preview,
      seriesReferenceUnitCents: null,
      priceProvenance: null,
    });

    const after = await db.styles.get([datasetId, styleId]);
    expect(after?.referenceUnitCents).toBe(9900);
  });

  it('is idempotent by commandId', async () => {
    const commandId = crypto.randomUUID();
    const input = {
      commandId,
      datasetId,
      preview: makePreview(),
      seriesReferenceUnitCents: 6900,
      priceProvenance: 'user_confirmed' as const,
    };
    const first = await commitSeriesImport(db, input);
    const second = await commitSeriesImport(db, input);
    expect(second.replayed).toBe(true);
    expect(second.seriesId).toBe(first.seriesId);
    expect(await db.styles.where({ datasetId }).count()).toBe(2);
  });

  it('refuses an unsupported preview version', async () => {
    const preview = { ...makePreview(), previewVersion: 1 } as unknown as SeriesPreview;
    await expect(
      commitSeriesImport(db, {
        commandId: crypto.randomUUID(),
        datasetId,
        preview,
        seriesReferenceUnitCents: null,
        priceProvenance: null,
      }),
    ).rejects.toMatchObject({ code: 'INVALID_DRAFT' });
  });
});

describe('queries', () => {
  it('reports owned styles and held quantities after purchase', async () => {
    const preview = makePreview();
    const committed = await commitSeriesImport(db, {
      commandId: crypto.randomUUID(),
      datasetId,
      preview,
      seriesReferenceUnitCents: 6900,
      priceProvenance: 'user_confirmed',
    });
    const styleId = committed.styleIds['stay-curious'];
    if (!styleId) throw new Error('missing style');

    await createAcquisition(db, {
      commandId: crypto.randomUUID(),
      datasetId,
      source: 'official',
      date: dayDate('2026-11-12'),
      paidTotalCents: 13800,
      lines: [
        {
          styleId,
          quantity: 2,
          allocatedCents: 13800,
          referenceUnitCentsSnapshot: 6900,
        },
      ],
    });

    const views = await getSeriesViews(db, datasetId);
    expect(views).toHaveLength(1);
    expect(views[0]?.ownedStyles).toBe(1);
    expect(views[0]?.heldTotal).toBe(2);
    expect(views[0]?.styles.find((entry) => entry.style.id === styleId)?.held).toBe(2);

    const state = await loadCollectionState(db, datasetId);
    expect(state.netSpendCents).toBe(13800);
    expect(state.netBoughtQty).toBe(2);
  });

  it('tracks held quantity through gift and returns later', async () => {
    const preview = makePreview(['Only One']);
    const committed = await commitSeriesImport(db, {
      commandId: crypto.randomUUID(),
      datasetId,
      preview,
      seriesReferenceUnitCents: 6900,
      priceProvenance: 'user_confirmed',
    });
    const result = await createAcquisition(db, {
      commandId: crypto.randomUUID(),
      datasetId,
      source: 'gift',
      date: dayDate('2026-11-12'),
      paidTotalCents: null,
      lines: [
        {
          styleId: committed.styleIds['only-one']!,
          quantity: 1,
          allocatedCents: null,
          referenceUnitCentsSnapshot: null,
        },
      ],
    });

    const views = await getSeriesViews(db, datasetId);
    expect(views[0]?.heldTotal).toBe(1);

    const state = await loadCollectionState(db, datasetId);
    expect(state.netSpendCents).toBe(0);
    expect(state.netBoughtQty).toBe(0);
    expect(result.acquisitionId).not.toBe('');
  });
});
