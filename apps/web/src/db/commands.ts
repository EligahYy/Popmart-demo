import {
  allocateByWeight,
  assertAllocationSumsTo,
  isCents,
  type AcquisitionDate,
  type Cents,
  type SeriesPreview,
} from '@my-popmart/contracts';
import { nowIso, type PopmartDb } from './database.js';
import type {
  AcquisitionLineRow,
  AcquisitionRow,
  AcquisitionSource,
  AllocationMode,
  AppMetaRow,
  CommandResultRow,
  CollectionProfileRow,
  CounterRow,
  DatasetRow,
  IpRow,
  RefundLineRow,
  RefundRow,
  SeriesRow,
  StyleRow,
  TransferLineRow,
  TransferRow,
} from './rows.js';

export type CommandErrorCode =
  | 'DATASET_NOT_FOUND'
  | 'MAINTENANCE'
  | 'IDEMPOTENCY_CONFLICT'
  | 'INVALID_DRAFT'
  | 'STYLE_NOT_FOUND'
  | 'OUT_OF_RANGE';

export class CommandError extends Error {
  override readonly name = 'CommandError';
  constructor(
    readonly code: CommandErrorCode,
    message: string,
  ) {
    super(message);
  }
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`;
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  return `{${keys
    .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
    .join(',')}}`;
}

/** 命令去重用的轻量哈希，不用于安全场景。 */
export function hashPayload(value: unknown): string {
  const text = stableStringify(value);
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

export interface AcquisitionLineDraft {
  readonly styleId: string;
  readonly quantity: number;
  readonly allocatedCents: Cents | null;
  readonly referenceUnitCentsSnapshot: Cents | null;
}

export interface CreateAcquisitionInput {
  readonly commandId: string;
  readonly datasetId: string;
  readonly source: AcquisitionSource;
  readonly date: AcquisitionDate;
  readonly paidTotalCents: Cents | null;
  readonly channel?: string | null;
  readonly note?: string | null;
  readonly lines: readonly AcquisitionLineDraft[];
  readonly allocationMode?: AllocationMode;
}

export interface CreateAcquisitionResult {
  readonly acquisitionId: string;
  readonly lineIds: readonly string[];
  readonly collectionNos: ReadonlyArray<{ styleId: string; collectionNo: string }>;
  readonly replayed: boolean;
}

function assertDraft(input: CreateAcquisitionInput): void {
  if (input.lines.length === 0) {
    throw new CommandError('INVALID_DRAFT', '至少需要一个款式');
  }

  const isGift = input.source === 'gift';

  for (const line of input.lines) {
    if (!Number.isSafeInteger(line.quantity) || line.quantity <= 0) {
      throw new CommandError('INVALID_DRAFT', '数量必须是正整数');
    }
    if (isGift) {
      if (line.allocatedCents !== null || line.referenceUnitCentsSnapshot !== null) {
        throw new CommandError('INVALID_DRAFT', '礼物不能带金额');
      }
    } else {
      if (line.allocatedCents === null || !isCents(line.allocatedCents)) {
        throw new CommandError('INVALID_DRAFT', '购买必须有有效分摊金额');
      }
      if (
        line.referenceUnitCentsSnapshot !== null &&
        !isCents(line.referenceUnitCentsSnapshot)
      ) {
        throw new CommandError('INVALID_DRAFT', '参考价快照必须是非负整数分');
      }
    }
  }

  if (isGift) {
    if (input.paidTotalCents !== null) {
      throw new CommandError('INVALID_DRAFT', '礼物无实付金额');
    }
    return;
  }

  if (input.paidTotalCents === null || !isCents(input.paidTotalCents)) {
    throw new CommandError('INVALID_DRAFT', '实付金额必填');
  }

  const allocations = input.lines.map((line) => line.allocatedCents ?? 0);
  try {
    assertAllocationSumsTo(input.paidTotalCents, allocations);
  } catch (error) {
    throw new CommandError(
      'INVALID_DRAFT',
      error instanceof Error ? error.message : '分摊金额与实付总额不一致',
    );
  }
}

function makeId(): string {
  return globalThis.crypto.randomUUID();
}

function formatCollectionNo(value: number): string {
  return `MP-${String(value).padStart(6, '0')}`;
}

/**
 * 创建一笔购买：订单、明细、首次拥有档案、命令结果与计数器在同一事务内完成。
 * 同一 commandId 重复提交返回原结果，不会重复入账。
 */
export async function createAcquisition(
  db: PopmartDb,
  input: CreateAcquisitionInput,
): Promise<CreateAcquisitionResult> {
  assertDraft(input);

  const payloadHash = hashPayload({
    source: input.source,
    date: input.date,
    paidTotalCents: input.paidTotalCents,
    channel: input.channel ?? null,
    note: input.note ?? null,
    lines: input.lines,
  });

  return db.transaction(
    'rw',
    [
      db.datasets,
      db.appMeta,
      db.styles,
      db.acquisitions,
      db.acquisitionLines,
      db.collectionProfiles,
      db.commandResults,
      db.counters,
    ],
    async () => {
      const dataset = await db.datasets.get(input.datasetId);
      if (!dataset || dataset.status !== 'active') {
        throw new CommandError('DATASET_NOT_FOUND', '当前数据集不可写');
      }

      const meta = await db.appMeta.get('control');
      if (!meta) {
        throw new CommandError('DATASET_NOT_FOUND', '缺少 appMeta 控制行');
      }
      if (meta.maintenance !== 'none') {
        throw new CommandError('MAINTENANCE', '数据维护中，暂停写入');
      }
      if (meta.activeDatasetId !== input.datasetId) {
        throw new CommandError('DATASET_NOT_FOUND', '数据集已切换');
      }

      const existing = await db.commandResults
        .where('[datasetId+commandId]')
        .equals([input.datasetId, input.commandId])
        .first();
      if (existing) {
        if (existing.payloadHash !== payloadHash) {
          throw new CommandError('IDEMPOTENCY_CONFLICT', '同一 commandId 的内容不同，拒绝重放');
        }
        return { ...(existing.result as CreateAcquisitionResult), replayed: true };
      }

      const styleIds = [...new Set(input.lines.map((line) => line.styleId))];
      const styleRows = await db.styles.bulkGet(
        styleIds.map((styleId) => [input.datasetId, styleId] as [string, string]),
      );
      styleRows.forEach((style, index) => {
        if (!style) {
          throw new CommandError('STYLE_NOT_FOUND', `款式不存在：${styleIds[index]}`);
        }
      });

      const timestamp = nowIso();
      const acquisitionId = makeId();

      const acquisition: AcquisitionRow = {
        datasetId: input.datasetId,
        id: acquisitionId,
        createdAt: timestamp,
        updatedAt: timestamp,
        revision: 1,
        source: input.source,
        date: input.date,
        paidTotalCents: input.paidTotalCents,
        channel: input.channel ?? null,
        note: input.note ?? null,
        status: 'active',
        commandId: input.commandId,
      };

      const lineRows: AcquisitionLineRow[] = input.lines.map((line, index) => ({
        datasetId: input.datasetId,
        id: makeId(),
        createdAt: timestamp,
        updatedAt: timestamp,
        revision: 1,
        acquisitionId,
        styleId: line.styleId,
        quantity: line.quantity,
        allocatedCents: line.allocatedCents,
        referenceUnitCentsSnapshot: line.referenceUnitCentsSnapshot,
        allocationMode: input.allocationMode ?? 'proportional',
        lineOrder: index,
        status: 'active',
      }));

      const collectionNos: Array<{ styleId: string; collectionNo: string }> = [];
      const profileRows = await db.collectionProfiles
        .where('[datasetId+styleId]')
        .anyOf(styleIds.map((styleId) => [input.datasetId, styleId]))
        .toArray();
      const profileByStyleId = new Map(profileRows.map((row) => [row.styleId, row]));

      let counterValue = 0;
      const counter = await db.counters.get([input.datasetId, 'collectionNo']);
      if (counter) counterValue = counter.value;

      const newProfiles: CollectionProfileRow[] = [];
      styleIds.forEach((styleId) => {
        const profile = profileByStyleId.get(styleId);
        if (profile) {
          collectionNos.push({ styleId, collectionNo: profile.collectionNo });
          return;
        }
        counterValue += 1;
        const collectionNo = formatCollectionNo(counterValue);
        collectionNos.push({ styleId, collectionNo });
        newProfiles.push({
          datasetId: input.datasetId,
          id: makeId(),
          createdAt: timestamp,
          updatedAt: timestamp,
          revision: 1,
          styleId,
          collectionNo,
          nickname: null,
          story: null,
        });
      });

      const result: CreateAcquisitionResult = {
        acquisitionId,
        lineIds: lineRows.map((line) => line.id),
        collectionNos,
        replayed: false,
      };

      await db.acquisitions.put(acquisition);
      await db.acquisitionLines.bulkPut(lineRows);
      if (newProfiles.length > 0) {
        await db.collectionProfiles.bulkPut(newProfiles);
      }
      if (newProfiles.length > 0) {
        const nextCounter: CounterRow = {
          datasetId: input.datasetId,
          id: 'collectionNo',
          createdAt: counter?.createdAt ?? timestamp,
          updatedAt: timestamp,
          revision: (counter?.revision ?? 0) + 1,
          key: 'collectionNo',
          value: counterValue,
        };
        await db.counters.put(nextCounter);
      }

      const commandResult: CommandResultRow = {
        datasetId: input.datasetId,
        id: makeId(),
        createdAt: timestamp,
        updatedAt: timestamp,
        revision: 1,
        commandId: input.commandId,
        type: 'createAcquisition',
        payloadHash,
        result,
        committedAt: timestamp,
      };
      await db.commandResults.put(commandResult);

      const metaPatch: AppMetaRow = { ...meta, appDataRevision: meta.appDataRevision + 1 };
      await db.appMeta.put(metaPatch);

      return result;
    },
  );
}

/** 建立初始数据集与控制行；测试与首次启动共用。 */
export async function initializeDatabase(
  db: PopmartDb,
  options: { datasetId?: string; now?: string } = {},
): Promise<string> {
  const timestamp = options.now ?? nowIso();
  const datasetId = options.datasetId ?? makeId();

  await db.transaction('rw', [db.datasets, db.appMeta], async () => {
    const meta = await db.appMeta.get('control');
    if (meta) return;
    const dataset: DatasetRow = {
      id: datasetId,
      status: 'active',
      schemaVersion: 1,
      verifiedAt: timestamp,
    };
    await db.datasets.put(dataset);
    const control: AppMetaRow = {
      id: 'control',
      activeDatasetId: datasetId,
      dbSchemaVersion: 1,
      appDataRevision: 0,
      maintenance: 'none',
      maintenanceOpId: null,
      ownerTabId: null,
      leaseExpiresAt: null,
      fencingEpoch: 0,
    };
    await db.appMeta.put(control);
  });

  const meta = await db.appMeta.get('control');
  if (!meta) throw new CommandError('DATASET_NOT_FOUND', '初始化失败');
  return meta.activeDatasetId;
}

/** 测试与导入用：写入一个款式。 */
export async function putStyleForTest(
  db: PopmartDb,
  datasetId: string,
  style: Partial<StyleRow> & { id: string; seriesId: string; canonicalKey: string; displayName: string },
): Promise<void> {
  const timestamp = nowIso();
  await db.styles.put({
    datasetId,
    createdAt: timestamp,
    updatedAt: timestamp,
    revision: 1,
    isSecret: false,
    imageAssetId: null,
    imageUrl: null,
    mediaStatus: 'missing',
    referenceUnitCents: null,
    priceProvenance: null,
    priceUpdatedAt: null,
    sortOrder: 0,
    ...style,
  });
}



export interface CommitSeriesImportInput {
  readonly commandId: string;
  readonly datasetId: string;
  readonly preview: SeriesPreview;
  readonly seriesReferenceUnitCents: Cents | null;
  readonly priceProvenance: 'user_confirmed' | 'catalog' | null;
  readonly stylePrices?: Readonly<Record<string, Cents | null>>;
}

export interface CommitSeriesImportResult {
  readonly ipId: string;
  readonly seriesId: string;
  readonly createdStyles: number;
  readonly updatedStyles: number;
  readonly styleIds: Readonly<Record<string, string>>;
  readonly replayed: boolean;
}

/**
 * 把导入预览提交为本机图库。重复导入只补新款与更新图片，不删除旧款式、
 * 不覆盖用户确认过的价格与个人内容。整个提交与命令结果在同一事务内。
 */
export async function commitSeriesImport(
  db: PopmartDb,
  input: CommitSeriesImportInput,
): Promise<CommitSeriesImportResult> {
  const preview = input.preview;
  if (preview.previewVersion !== 2) {
    throw new CommandError('INVALID_DRAFT', '导入预览版本不受支持');
  }
  if (input.seriesReferenceUnitCents !== null && !isCents(input.seriesReferenceUnitCents)) {
    throw new CommandError('INVALID_DRAFT', '参考价必须是非负整数分');
  }

  const payloadHash = hashPayload({
    canonicalKey: preview.canonicalKey,
    name: preview.name,
    price: input.seriesReferenceUnitCents,
    styles: preview.styles.map((style) => [style.canonicalKey, style.name]),
    stylePrices: input.stylePrices ?? {},
  });

  return db.transaction(
    'rw',
    [db.datasets, db.appMeta, db.ips, db.series, db.styles, db.commandResults],
    async () => {
      const dataset = await db.datasets.get(input.datasetId);
      if (!dataset || dataset.status !== 'active') {
        throw new CommandError('DATASET_NOT_FOUND', '当前数据集不可写');
      }
      const meta = await db.appMeta.get('control');
      if (!meta || meta.activeDatasetId !== input.datasetId) {
        throw new CommandError('DATASET_NOT_FOUND', '数据集已切换');
      }
      if (meta.maintenance !== 'none') {
        throw new CommandError('MAINTENANCE', '数据维护中，暂停写入');
      }

      const existingCommand = await db.commandResults
        .where('[datasetId+commandId]')
        .equals([input.datasetId, input.commandId])
        .first();
      if (existingCommand) {
        if (existingCommand.payloadHash !== payloadHash) {
          throw new CommandError('IDEMPOTENCY_CONFLICT', '同一 commandId 的内容不同，拒绝重放');
        }
        return { ...(existingCommand.result as CommitSeriesImportResult), replayed: true };
      }

      const timestamp = nowIso();

      let ip = await db.ips
        .where('[datasetId+canonicalKey]')
        .equals([input.datasetId, preview.ip.canonicalKey])
        .first();
      if (!ip) {
        const row: IpRow = {
          datasetId: input.datasetId,
          id: makeId(),
          createdAt: timestamp,
          updatedAt: timestamp,
          revision: 1,
          canonicalKey: preview.ip.canonicalKey,
          displayName: preview.ip.name,
          aliases: preview.ip.aliases,
          sortOrder: 0,
        };
        await db.ips.put(row);
        ip = row;
      } else if (preview.ip.name && ip.displayName !== preview.ip.name) {
        const updated: IpRow = {
          ...ip,
          displayName: preview.ip.name,
          updatedAt: timestamp,
          revision: ip.revision + 1,
        };
        await db.ips.put(updated);
        ip = updated;
      }

      let series = await db.series
        .where('[datasetId+canonicalKey]')
        .equals([input.datasetId, preview.canonicalKey])
        .first();

      const priceFields =
        input.seriesReferenceUnitCents !== null
          ? {
              defaultUnitCents: input.seriesReferenceUnitCents,
              priceProvenance: input.priceProvenance ?? 'user_confirmed',
              priceUpdatedAt: timestamp,
            }
          : {};

      if (!series) {
        const row: SeriesRow = {
          datasetId: input.datasetId,
          id: makeId(),
          createdAt: timestamp,
          updatedAt: timestamp,
          revision: 1,
          ipId: ip.id,
          canonicalKey: preview.canonicalKey,
          displayName: preview.name,
          aliases: [],
          productKind: preview.productKind,
          sortOrder: 0,
          defaultUnitCents: input.seriesReferenceUnitCents,
          priceProvenance: input.seriesReferenceUnitCents !== null ? (input.priceProvenance ?? 'user_confirmed') : null,
          priceUpdatedAt: input.seriesReferenceUnitCents !== null ? timestamp : null,
          foreignReference: preview.foreignReference,
          sourceUrl: preview.sourceUrl,
          importedAt: timestamp,
        };
        await db.series.put(row);
        series = row;
      } else {
        const updated: SeriesRow = {
          ...series,
          ipId: ip.id,
          displayName: preview.name,
          productKind: preview.productKind,
          sourceUrl: preview.sourceUrl,
          importedAt: timestamp,
          foreignReference: series.foreignReference ?? preview.foreignReference,
          ...priceFields,
          updatedAt: timestamp,
          revision: series.revision + 1,
        };
        await db.series.put(updated);
        series = updated;
      }

      const existingStyles = await db.styles
        .where('[datasetId+seriesId]')
        .equals([input.datasetId, series.id])
        .toArray();
      const existingByKey = new Map(existingStyles.map((style) => [style.canonicalKey, style]));

      const styleIds: Record<string, string> = {};
      const toPut: StyleRow[] = [];
      let createdStyles = 0;
      let updatedStyles = 0;

      preview.styles.forEach((incoming, index) => {
        const previous = existingByKey.get(incoming.canonicalKey);
        const imageUrl = incoming.image?.sourceUrl ?? previous?.imageUrl ?? null;
        const override = input.stylePrices?.[incoming.canonicalKey];

        if (!previous) {
          const row: StyleRow = {
            datasetId: input.datasetId,
            id: makeId(),
            createdAt: timestamp,
            updatedAt: timestamp,
            revision: 1,
            seriesId: series.id,
            canonicalKey: incoming.canonicalKey,
            displayName: incoming.name,
            isSecret: incoming.isSecret,
            imageAssetId: null,
            imageUrl,
            mediaStatus: imageUrl ? 'remote' : 'missing',
            referenceUnitCents: override ?? null,
            priceProvenance: override !== undefined && override !== null ? 'user_confirmed' : null,
            priceUpdatedAt: override !== undefined && override !== null ? timestamp : null,
            sortOrder: index,
          };
          toPut.push(row);
          styleIds[incoming.canonicalKey] = row.id;
          createdStyles += 1;
          return;
        }

        styleIds[incoming.canonicalKey] = previous.id;
        const nextPrice = override !== undefined ? override : previous.referenceUnitCents;
        const row: StyleRow = {
          ...previous,
          displayName: incoming.name,
          isSecret: incoming.isSecret,
          imageUrl: previous.mediaStatus === 'cached' ? previous.imageUrl : (imageUrl ?? previous.imageUrl),
          sortOrder: index,
          referenceUnitCents: nextPrice,
          priceProvenance:
            override !== undefined && override !== null
              ? 'user_confirmed'
              : previous.priceProvenance,
          priceUpdatedAt:
            override !== undefined && override !== null ? timestamp : previous.priceUpdatedAt,
          updatedAt: timestamp,
          revision: previous.revision + 1,
        };
        toPut.push(row);
        updatedStyles += 1;
      });

      if (toPut.length > 0) await db.styles.bulkPut(toPut);

      const result: CommitSeriesImportResult = {
        ipId: ip.id,
        seriesId: series.id,
        createdStyles,
        updatedStyles,
        styleIds,
        replayed: false,
      };

      const commandResult: CommandResultRow = {
        datasetId: input.datasetId,
        id: makeId(),
        createdAt: timestamp,
        updatedAt: timestamp,
        revision: 1,
        commandId: input.commandId,
        type: 'commitSeriesImport',
        payloadHash,
        result,
        committedAt: timestamp,
      };
      await db.commandResults.put(commandResult);

      const metaPatch: AppMetaRow = { ...meta, appDataRevision: meta.appDataRevision + 1 };
      await db.appMeta.put(metaPatch);

      return result;
    },
  );
}

export interface SetBudgetInput {
  readonly commandId: string;
  readonly datasetId: string;
  readonly month: string;
  readonly amountLimitCents: Cents | null;
  readonly quantityLimit: number | null;
}

export interface SetBudgetResult {
  readonly month: string;
  readonly amountLimitCents: Cents | null;
  readonly quantityLimit: number | null;
  readonly replayed: boolean;
}

/** 设置某月额度：同时写入当月快照与后续生效规则，不改历史月份。 */
export async function setBudget(db: PopmartDb, input: SetBudgetInput): Promise<SetBudgetResult> {
  const hasAmount = input.amountLimitCents !== null;
  const hasQuantity = input.quantityLimit !== null;

  if (!hasAmount && !hasQuantity) {
    throw new CommandError('INVALID_DRAFT', '至少启用一个限制维度');
  }
  if (hasAmount && (!isCents(input.amountLimitCents) || input.amountLimitCents === 0)) {
    throw new CommandError('INVALID_DRAFT', '金额上限必须大于零');
  }
  if (hasQuantity && (!Number.isSafeInteger(input.quantityLimit) || (input.quantityLimit ?? 0) <= 0)) {
    throw new CommandError('INVALID_DRAFT', '数量上限必须是正整数');
  }

  const payloadHash = hashPayload(input);

  return db.transaction(
    'rw',
    [db.datasets, db.appMeta, db.budgetRules, db.budgetMonths, db.commandResults],
    async () => {
      const dataset = await db.datasets.get(input.datasetId);
      if (!dataset || dataset.status !== 'active') {
        throw new CommandError('DATASET_NOT_FOUND', '当前数据集不可写');
      }
      const meta = await db.appMeta.get('control');
      if (!meta || meta.activeDatasetId !== input.datasetId) {
        throw new CommandError('DATASET_NOT_FOUND', '数据集已切换');
      }
      if (meta.maintenance !== 'none') {
        throw new CommandError('MAINTENANCE', '数据维护中，暂停写入');
      }

      const existing = await db.commandResults
        .where('[datasetId+commandId]')
        .equals([input.datasetId, input.commandId])
        .first();
      if (existing) {
        if (existing.payloadHash !== payloadHash) {
          throw new CommandError('IDEMPOTENCY_CONFLICT', '同一 commandId 的内容不同，拒绝重放');
        }
        return { ...(existing.result as SetBudgetResult), replayed: true };
      }

      const timestamp = nowIso();
      const existingRule = await db.budgetRules
        .where('[datasetId+effectiveFromMonth]')
        .equals([input.datasetId, input.month])
        .first();

      const ruleId = existingRule?.id ?? makeId();
      await db.budgetRules.put({
        datasetId: input.datasetId,
        id: ruleId,
        createdAt: existingRule?.createdAt ?? timestamp,
        updatedAt: timestamp,
        revision: (existingRule?.revision ?? 0) + 1,
        effectiveFromMonth: input.month,
        amountLimitCents: input.amountLimitCents,
        quantityLimit: input.quantityLimit,
      });

      const existingMonth = await db.budgetMonths
        .where('[datasetId+month]')
        .equals([input.datasetId, input.month])
        .first();
      await db.budgetMonths.put({
        datasetId: input.datasetId,
        id: existingMonth?.id ?? makeId(),
        createdAt: existingMonth?.createdAt ?? timestamp,
        updatedAt: timestamp,
        revision: (existingMonth?.revision ?? 0) + 1,
        month: input.month,
        amountLimitCents: input.amountLimitCents,
        quantityLimit: input.quantityLimit,
        ruleId,
      });

      const result: SetBudgetResult = {
        month: input.month,
        amountLimitCents: input.amountLimitCents,
        quantityLimit: input.quantityLimit,
        replayed: false,
      };

      await db.commandResults.put({
        datasetId: input.datasetId,
        id: makeId(),
        createdAt: timestamp,
        updatedAt: timestamp,
        revision: 1,
        commandId: input.commandId,
        type: 'setBudget',
        payloadHash,
        result,
        committedAt: timestamp,
      });

      await db.appMeta.put({ ...meta, appDataRevision: meta.appDataRevision + 1 });
      return result;
    },
  );
}

async function assertWritable(db: PopmartDb, datasetId: string): Promise<AppMetaRow> {
  const dataset = await db.datasets.get(datasetId);
  if (!dataset || dataset.status !== 'active') {
    throw new CommandError('DATASET_NOT_FOUND', '当前数据集不可写');
  }
  const meta = await db.appMeta.get('control');
  if (!meta || meta.activeDatasetId !== datasetId) {
    throw new CommandError('DATASET_NOT_FOUND', '数据集已切换');
  }
  if (meta.maintenance !== 'none') {
    throw new CommandError('MAINTENANCE', '数据维护中，暂停写入');
  }
  return meta;
}

async function findCommand(
  db: PopmartDb,
  datasetId: string,
  commandId: string,
): Promise<CommandResultRow | undefined> {
  return db.commandResults
    .where('[datasetId+commandId]')
    .equals([datasetId, commandId])
    .first();
}

function assertReplay(existing: CommandResultRow, payloadHash: string, result: unknown): unknown {
  if (existing.payloadHash !== payloadHash) {
    throw new CommandError('IDEMPOTENCY_CONFLICT', '同一 commandId 的内容不同，拒绝重放');
  }
  return { ...(existing.result as Record<string, unknown>), replayed: true };
}

function allocateForLines(
  totalCents: Cents,
  lines: readonly { id: string; quantity: number; referenceUnitCentsSnapshot: Cents | null; allocatedCents: Cents | null }[],
  refundedByLine: ReadonlyMap<string, number>,
): Cents[] {
  const weights: Cents[] = [];
  for (const line of lines) {
    if (line.referenceUnitCentsSnapshot === null) {
      if (lines.length === 1 && line.allocatedCents === null) {
        weights.push(1);
        continue;
      }
      throw new CommandError('INVALID_DRAFT', '缺少参考价，无法按比例重新分摊');
    }
    weights.push(line.referenceUnitCentsSnapshot * line.quantity);
  }

  const allocations = allocateByWeight(totalCents, weights);
  lines.forEach((line, index) => {
    const refunded = refundedByLine.get(line.id) ?? 0;
    if ((allocations[index] ?? 0) < refunded) {
      throw new CommandError('INVALID_DRAFT', '新的分摊金额小于已退款金额');
    }
  });
  return allocations;
}

export interface UpdateAcquisitionInput {
  readonly commandId: string;
  readonly datasetId: string;
  readonly acquisitionId: string;
  readonly expectedRevision: number;
  readonly patch: {
    readonly date?: AcquisitionDate;
    readonly source?: AcquisitionSource;
    readonly paidTotalCents?: Cents | null;
    readonly channel?: string | null;
    readonly note?: string | null;
    readonly lines?: ReadonlyArray<{ readonly lineId: string; readonly quantity: number }>;
  };
}

export async function updateAcquisition(
  db: PopmartDb,
  input: UpdateAcquisitionInput,
): Promise<{ acquisitionId: string; revision: number; replayed: boolean }> {
  const payloadHash = hashPayload({ id: input.acquisitionId, patch: input.patch });

  return db.transaction(
    'rw',
    [
      db.datasets,
      db.appMeta,
      db.acquisitions,
      db.acquisitionLines,
      db.refundLines,
      db.transferLines,
      db.commandResults,
    ],
    async () => {
      const meta = await assertWritable(db, input.datasetId);

      const existing = await findCommand(db, input.datasetId, input.commandId);
      if (existing) {
        return assertReplay(existing, payloadHash, null) as {
          acquisitionId: string;
          revision: number;
          replayed: boolean;
        };
      }

      const acquisition = await db.acquisitions.get([input.datasetId, input.acquisitionId]);
      if (!acquisition || acquisition.status !== 'active') {
        throw new CommandError('INVALID_DRAFT', '购买记录不存在或已删除');
      }
      if (acquisition.revision !== input.expectedRevision) {
        throw new CommandError('INVALID_DRAFT', '记录已被修改，请重新加载');
      }

      const lines = await db.acquisitionLines
        .where({ datasetId: input.datasetId, acquisitionId: acquisition.id })
        .toArray();
      const refundLines = await db.refundLines.where({ datasetId: input.datasetId }).toArray();

      const refundedByLine = new Map<string, number>();
      for (const line of refundLines) {
        if (line.status !== 'active') continue;
        refundedByLine.set(
          line.acquisitionLineId,
          (refundedByLine.get(line.acquisitionLineId) ?? 0) + line.refundCents,
        );
      }
      const totalRefunded = [...refundedByLine.values()].reduce((total, value) => total + value, 0);

      const timestamp = nowIso();
      const nextSource = input.patch.source ?? acquisition.source;
      const nextDate = input.patch.date ?? acquisition.date;
      let nextPaid = input.patch.paidTotalCents !== undefined ? input.patch.paidTotalCents : acquisition.paidTotalCents;

      if (nextSource === 'gift') {
        if (totalRefunded > 0) {
          throw new CommandError('INVALID_DRAFT', '已有退款的记录不能改为礼物');
        }
        nextPaid = null;
      } else {
        if (nextPaid === null || !isCents(nextPaid)) {
          throw new CommandError('INVALID_DRAFT', '购买必须有实付金额');
        }
        if (nextPaid < totalRefunded) {
          throw new CommandError('INVALID_DRAFT', '实付金额不能小于已退款金额');
        }
      }

      const returnedByLine = new Map<string, number>();
      for (const line of refundLines) {
        if (line.status !== 'active') continue;
        returnedByLine.set(
          line.acquisitionLineId,
          (returnedByLine.get(line.acquisitionLineId) ?? 0) + line.returnedQuantity,
        );
      }
      const transfers = await db.transferLines.where({ datasetId: input.datasetId }).toArray();
      const transferredByLine = new Map<string, number>();
      for (const line of transfers) {
        if (line.status !== 'active') continue;
        transferredByLine.set(
          line.acquisitionLineId,
          (transferredByLine.get(line.acquisitionLineId) ?? 0) + line.quantity,
        );
      }

      const quantityByLine = new Map<string, number>();
      for (const patchLine of input.patch.lines ?? []) {
        const target = lines.find((line) => line.id === patchLine.lineId);
        if (!target) throw new CommandError('INVALID_DRAFT', '要修改的明细不存在');
        if (!Number.isSafeInteger(patchLine.quantity) || patchLine.quantity <= 0) {
          throw new CommandError('INVALID_DRAFT', '数量必须是正整数');
        }
        const returned = returnedByLine.get(target.id) ?? 0;
        const transferred = transferredByLine.get(target.id) ?? 0;
        if (patchLine.quantity < returned + transferred) {
          throw new CommandError('INVALID_DRAFT', '数量不能小于已退货与已转出之和');
        }
        quantityByLine.set(target.id, patchLine.quantity);
      }

      const workingLines = lines.map((line) => ({
        ...line,
        quantity: quantityByLine.get(line.id) ?? line.quantity,
      }));

      const nextLines: AcquisitionLineRow[] = [];
      const quantityChanged = quantityByLine.size > 0;
      const allProportional = workingLines.every((line) => line.allocationMode !== 'manual');
      const shouldReallocate =
        nextSource !== 'gift' && (input.patch.paidTotalCents !== undefined || (quantityChanged && allProportional));

      if (nextSource === 'gift') {
        for (const line of workingLines) {
          nextLines.push({
            ...line,
            allocatedCents: null,
            referenceUnitCentsSnapshot: null,
            updatedAt: timestamp,
            revision: line.revision + 1,
          });
        }
      } else {
        const allocations = shouldReallocate
          ? allocateForLines(nextPaid as Cents, workingLines, refundedByLine)
          : workingLines.map((line) => {
              const refunded = refundedByLine.get(line.id) ?? 0;
              if ((line.allocatedCents ?? 0) < refunded) {
                throw new CommandError('INVALID_DRAFT', '已有退款超过该款分摊金额');
              }
              return line.allocatedCents ?? 0;
            });
        workingLines.forEach((line, index) => {
          nextLines.push({
            ...line,
            allocatedCents: allocations[index] ?? null,
            updatedAt: timestamp,
            revision: line.revision + 1,
          });
        });
      }


      const nextAcquisition: AcquisitionRow = {
        ...acquisition,
        date: nextDate,
        source: nextSource,
        paidTotalCents: nextPaid,
        channel: input.patch.channel !== undefined ? input.patch.channel : acquisition.channel,
        note: input.patch.note !== undefined ? input.patch.note : acquisition.note,
        updatedAt: timestamp,
        revision: acquisition.revision + 1,
      };

      await db.acquisitions.put(nextAcquisition);
      await db.acquisitionLines.bulkPut(nextLines);

      const result = { acquisitionId: acquisition.id, revision: nextAcquisition.revision, replayed: false };
      await db.commandResults.put({
        datasetId: input.datasetId,
        id: makeId(),
        createdAt: timestamp,
        updatedAt: timestamp,
        revision: 1,
        commandId: input.commandId,
        type: 'updateAcquisition',
        payloadHash,
        result,
        committedAt: timestamp,
      });
      await db.appMeta.put({ ...meta, appDataRevision: meta.appDataRevision + 1 });
      return result;
    },
  );
}

/** 整笔误录删除：订单、明细、关联退款与引用它的转出分配一起置为 deleted。 */
export async function deleteAcquisition(
  db: PopmartDb,
  input: { commandId: string; datasetId: string; acquisitionId: string },
): Promise<{ acquisitionId: string; replayed: boolean }> {
  const payloadHash = hashPayload({ id: input.acquisitionId });

  return db.transaction(
    'rw',
    [
      db.datasets,
      db.appMeta,
      db.acquisitions,
      db.acquisitionLines,
      db.refunds,
      db.refundLines,
      db.transfers,
      db.transferLines,
      db.commandResults,
    ],
    async () => {
      const meta = await assertWritable(db, input.datasetId);

      const existing = await findCommand(db, input.datasetId, input.commandId);
      if (existing) return assertReplay(existing, payloadHash, null) as { acquisitionId: string; replayed: boolean };

      const acquisition = await db.acquisitions.get([input.datasetId, input.acquisitionId]);
      if (!acquisition) throw new CommandError('INVALID_DRAFT', '购买记录不存在');

      const lines = await db.acquisitionLines
        .where({ datasetId: input.datasetId, acquisitionId: acquisition.id })
        .toArray();
      const lineIds = new Set(lines.map((line) => line.id));
      const timestamp = nowIso();

      await db.acquisitions.put({ ...acquisition, status: 'deleted', updatedAt: timestamp, revision: acquisition.revision + 1 });
      await db.acquisitionLines.bulkPut(
        lines.map((line) => ({ ...line, status: 'deleted', updatedAt: timestamp, revision: line.revision + 1 })),
      );

      const refunds = await db.refunds.where({ datasetId: input.datasetId }).toArray();
      const refundLines = await db.refundLines.where({ datasetId: input.datasetId }).toArray();
      const affectedRefundIds = new Set(
        refundLines.filter((line) => lineIds.has(line.acquisitionLineId)).map((line) => line.refundId),
      );

      await db.refundLines.bulkPut(
        refundLines
          .filter((line) => affectedRefundIds.has(line.refundId))
          .map((line) => ({ ...line, status: 'deleted', updatedAt: timestamp, revision: line.revision + 1 })),
      );
      await db.refunds.bulkPut(
        refunds
          .filter((refund) => affectedRefundIds.has(refund.id))
          .map((refund) => ({ ...refund, status: 'deleted', updatedAt: timestamp, revision: refund.revision + 1 })),
      );

      const transferLines = await db.transferLines.where({ datasetId: input.datasetId }).toArray();
      const affectedTransferIds = new Set(
        transferLines.filter((line) => lineIds.has(line.acquisitionLineId)).map((line) => line.transferId),
      );
      await db.transferLines.bulkPut(
        transferLines
          .filter((line) => affectedTransferIds.has(line.transferId))
          .map((line) => ({ ...line, status: 'deleted', updatedAt: timestamp, revision: line.revision + 1 })),
      );

      const transfers = await db.transfers.where({ datasetId: input.datasetId }).toArray();
      const remaining = new Map<string, number>();
      for (const line of transferLines) {
        if (line.status !== 'active' || affectedTransferIds.has(line.transferId)) continue;
        remaining.set(line.transferId, (remaining.get(line.transferId) ?? 0) + 1);
      }
      await db.transfers.bulkPut(
        transfers
          .filter((transfer) => affectedTransferIds.has(transfer.id) && (remaining.get(transfer.id) ?? 0) === 0)
          .map((transfer) => ({ ...transfer, status: 'deleted', updatedAt: timestamp, revision: transfer.revision + 1 })),
      );

      await db.commandResults.put({
        datasetId: input.datasetId,
        id: makeId(),
        createdAt: timestamp,
        updatedAt: timestamp,
        revision: 1,
        commandId: input.commandId,
        type: 'deleteAcquisition',
        payloadHash,
        result: { acquisitionId: acquisition.id, replayed: false },
        committedAt: timestamp,
      });
      await db.appMeta.put({ ...meta, appDataRevision: meta.appDataRevision + 1 });
      return { acquisitionId: acquisition.id, replayed: false };
    },
  );
}

export interface RefundLineInput {
  readonly lineId: string;
  readonly refundCents: Cents;
  readonly returnedQuantity: number;
}

export interface CreateRefundInput {
  readonly commandId: string;
  readonly datasetId: string;
  readonly acquisitionId: string;
  readonly kind: 'refund_only' | 'return';
  readonly processedOn: string;
  readonly totalCents: Cents;
  readonly note?: string | null;
  readonly lines: readonly RefundLineInput[];
}

export async function createRefund(
  db: PopmartDb,
  input: CreateRefundInput,
): Promise<{ refundId: string; replayed: boolean }> {
  const payloadHash = hashPayload(input);
  const sum = input.lines.reduce((total, line) => total + line.refundCents, 0);
  if (sum !== input.totalCents) {
    throw new CommandError('INVALID_DRAFT', '退款分配合计必须等于本次退款金额');
  }

  return db.transaction(
    'rw',
    [db.datasets, db.appMeta, db.acquisitions, db.acquisitionLines, db.refunds, db.refundLines, db.commandResults],
    async () => {
      const meta = await assertWritable(db, input.datasetId);

      const existing = await findCommand(db, input.datasetId, input.commandId);
      if (existing) return assertReplay(existing, payloadHash, null) as { refundId: string; replayed: boolean };

      const acquisition = await db.acquisitions.get([input.datasetId, input.acquisitionId]);
      if (!acquisition || acquisition.status !== 'active') {
        throw new CommandError('INVALID_DRAFT', '购买记录不存在或已删除');
      }
      if (acquisition.source === 'gift') {
        throw new CommandError('INVALID_DRAFT', '礼物不能退款');
      }

      const lines = await db.acquisitionLines
        .where({ datasetId: input.datasetId, acquisitionId: acquisition.id, status: 'active' })
        .toArray();
      const lineById = new Map(lines.map((line) => [line.id, line]));

      const existingRefunds = await db.refundLines.where({ datasetId: input.datasetId }).toArray();
      const refundedByLine = new Map<string, number>();
      const returnedByLine = new Map<string, number>();
      for (const line of existingRefunds) {
        if (line.status !== 'active') continue;
        refundedByLine.set(line.acquisitionLineId, (refundedByLine.get(line.acquisitionLineId) ?? 0) + line.refundCents);
        returnedByLine.set(line.acquisitionLineId, (returnedByLine.get(line.acquisitionLineId) ?? 0) + line.returnedQuantity);
      }

      const refundId = makeId();
      const timestamp = nowIso();
      const refundLines: RefundLineRow[] = [];

      for (const line of input.lines) {
        const row = lineById.get(line.lineId);
        if (!row) throw new CommandError('INVALID_DRAFT', '退款明细不存在');
        if (line.refundCents < 0) throw new CommandError('INVALID_DRAFT', '退款金额不能为负');
        if (line.returnedQuantity < 0) throw new CommandError('INVALID_DRAFT', '退货数量不能为负');
        if (input.kind === 'refund_only' && line.returnedQuantity !== 0) {
          throw new CommandError('INVALID_DRAFT', '仅退款不能退数量');
        }
        if (line.returnedQuantity > row.quantity - (returnedByLine.get(row.id) ?? 0)) {
          throw new CommandError('INVALID_DRAFT', '退货数量超过可退数量');
        }
        if (line.refundCents > (row.allocatedCents ?? 0) - (refundedByLine.get(row.id) ?? 0)) {
          throw new CommandError('INVALID_DRAFT', '退款金额超过该款剩余实付');
        }
        refundLines.push({
          datasetId: input.datasetId,
          id: makeId(),
          createdAt: timestamp,
          updatedAt: timestamp,
          revision: 1,
          refundId,
          acquisitionLineId: row.id,
          refundCents: line.refundCents,
          returnedQuantity: line.returnedQuantity,
          status: 'active',
        });
      }

      const refund: RefundRow = {
        datasetId: input.datasetId,
        id: refundId,
        createdAt: timestamp,
        updatedAt: timestamp,
        revision: 1,
        acquisitionId: acquisition.id,
        kind: input.kind,
        processedOn: input.processedOn,
        totalCents: input.totalCents,
        note: input.note ?? null,
        status: 'active',
      };

      await db.refunds.put(refund);
      await db.refundLines.bulkPut(refundLines);

      const result = { refundId, replayed: false };
      await db.commandResults.put({
        datasetId: input.datasetId,
        id: makeId(),
        createdAt: timestamp,
        updatedAt: timestamp,
        revision: 1,
        commandId: input.commandId,
        type: 'createRefund',
        payloadHash,
        result,
        committedAt: timestamp,
      });
      await db.appMeta.put({ ...meta, appDataRevision: meta.appDataRevision + 1 });
      return result;
    },
  );
}

export interface TransferLineInput {
  readonly lineId: string;
  readonly quantity: number;
}

export interface CreateTransferInput {
  readonly commandId: string;
  readonly datasetId: string;
  readonly kind: 'give_away' | 'sold';
  readonly occurredOn: string;
  readonly note?: string | null;
  readonly lines: readonly TransferLineInput[];
}

export async function createTransfer(
  db: PopmartDb,
  input: CreateTransferInput,
): Promise<{ transferId: string; replayed: boolean }> {
  const payloadHash = hashPayload(input);

  return db.transaction(
    'rw',
    [db.datasets, db.appMeta, db.acquisitionLines, db.refundLines, db.transferLines, db.transfers, db.commandResults],
    async () => {
      const meta = await assertWritable(db, input.datasetId);

      const existing = await findCommand(db, input.datasetId, input.commandId);
      if (existing) return assertReplay(existing, payloadHash, null) as { transferId: string; replayed: boolean };

      const lines = await db.acquisitionLines.where({ datasetId: input.datasetId }).toArray();
      const lineById = new Map(lines.map((line) => [line.id, line]));

      const refundLines = await db.refundLines.where({ datasetId: input.datasetId }).toArray();
      const transferLines = await db.transferLines.where({ datasetId: input.datasetId }).toArray();

      const returnedByLine = new Map<string, number>();
      for (const line of refundLines) {
        if (line.status !== 'active') continue;
        returnedByLine.set(line.acquisitionLineId, (returnedByLine.get(line.acquisitionLineId) ?? 0) + line.returnedQuantity);
      }
      const transferredByLine = new Map<string, number>();
      for (const line of transferLines) {
        if (line.status !== 'active') continue;
        transferredByLine.set(line.acquisitionLineId, (transferredByLine.get(line.acquisitionLineId) ?? 0) + line.quantity);
      }

      const transferId = makeId();
      const timestamp = nowIso();
      const rows: TransferLineRow[] = [];

      for (const line of input.lines) {
        const row = lineById.get(line.lineId);
        if (!row || row.status !== 'active') throw new CommandError('INVALID_DRAFT', '来源批次不存在');
        if (!Number.isSafeInteger(line.quantity) || line.quantity <= 0) {
          throw new CommandError('INVALID_DRAFT', '转出数量必须是正整数');
        }
        const held =
          row.quantity - (returnedByLine.get(row.id) ?? 0) - (transferredByLine.get(row.id) ?? 0);
        if (line.quantity > held) {
          throw new CommandError('INVALID_DRAFT', '转出数量超过当前持有');
        }
        rows.push({
          datasetId: input.datasetId,
          id: makeId(),
          createdAt: timestamp,
          updatedAt: timestamp,
          revision: 1,
          transferId,
          acquisitionLineId: row.id,
          quantity: line.quantity,
          status: 'active',
        });
      }

      await db.transfers.put({
        datasetId: input.datasetId,
        id: transferId,
        createdAt: timestamp,
        updatedAt: timestamp,
        revision: 1,
        kind: input.kind,
        occurredOn: input.occurredOn,
        note: input.note ?? null,
        status: 'active',
      });
      await db.transferLines.bulkPut(rows);

      const result = { transferId, replayed: false };
      await db.commandResults.put({
        datasetId: input.datasetId,
        id: makeId(),
        createdAt: timestamp,
        updatedAt: timestamp,
        revision: 1,
        commandId: input.commandId,
        type: 'createTransfer',
        payloadHash,
        result,
        committedAt: timestamp,
      });
      await db.appMeta.put({ ...meta, appDataRevision: meta.appDataRevision + 1 });
      return result;
    },
  );
}

export interface UpdateProfileInput {
  readonly commandId: string;
  readonly datasetId: string;
  readonly styleId: string;
  readonly nickname: string | null;
  readonly story: string | null;
}

/** 小名与收藏故事：只影响个人内容，不动数量与金额。 */
export async function updateCollectionProfile(
  db: PopmartDb,
  input: UpdateProfileInput,
): Promise<{ styleId: string; collectionNo: string; replayed: boolean }> {
  if ((input.nickname ?? '').length > 30) {
    throw new CommandError('INVALID_DRAFT', '小名最多 30 个字符');
  }
  if ((input.story ?? '').length > 500) {
    throw new CommandError('INVALID_DRAFT', '收藏故事最多 500 个字符');
  }

  const payloadHash = hashPayload({ styleId: input.styleId, nickname: input.nickname, story: input.story });

  return db.transaction(
    'rw',
    [db.datasets, db.appMeta, db.styles, db.collectionProfiles, db.counters, db.commandResults],
    async () => {
      const meta = await assertWritable(db, input.datasetId);

      const existing = await findCommand(db, input.datasetId, input.commandId);
      if (existing) {
        return assertReplay(existing, payloadHash, null) as {
          styleId: string;
          collectionNo: string;
          replayed: boolean;
        };
      }

      const style = await db.styles.get([input.datasetId, input.styleId]);
      if (!style) throw new CommandError('INVALID_DRAFT', '款式不存在');

      const timestamp = nowIso();
      const profile = await db.collectionProfiles
        .where('[datasetId+styleId]')
        .equals([input.datasetId, input.styleId])
        .first();

      let collectionNo: string;
      if (profile) {
        collectionNo = profile.collectionNo;
        await db.collectionProfiles.put({
          ...profile,
          nickname: input.nickname,
          story: input.story,
          updatedAt: timestamp,
          revision: profile.revision + 1,
        });
      } else {
        const counterRow = await db.counters.get([input.datasetId, 'collectionNo']);
        const nextValue = (counterRow?.value ?? 0) + 1;
        collectionNo = `MP-${String(nextValue).padStart(6, '0')}`;
        await db.collectionProfiles.put({
          datasetId: input.datasetId,
          id: makeId(),
          createdAt: timestamp,
          updatedAt: timestamp,
          revision: 1,
          styleId: input.styleId,
          collectionNo,
          nickname: input.nickname,
          story: input.story,
        });
        await db.counters.put({
          datasetId: input.datasetId,
          id: 'collectionNo',
          createdAt: counterRow?.createdAt ?? timestamp,
          updatedAt: timestamp,
          revision: (counterRow?.revision ?? 0) + 1,
          key: 'collectionNo',
          value: nextValue,
        });
      }

      const result = { styleId: input.styleId, collectionNo, replayed: false };
      await db.commandResults.put({
        datasetId: input.datasetId,
        id: makeId(),
        createdAt: timestamp,
        updatedAt: timestamp,
        revision: 1,
        commandId: input.commandId,
        type: 'updateCollectionProfile',
        payloadHash,
        result,
        committedAt: timestamp,
      });
      await db.appMeta.put({ ...meta, appDataRevision: meta.appDataRevision + 1 });
      return result;
    },
  );
}

export const DEFAULT_SPACE_NAME = '红彤彤收纳';

export interface SetSpaceNameInput {
  readonly commandId: string;
  readonly datasetId: string;
  readonly name: string;
}

/** 空间名称：只影响首页文案，存 preferences，随备份一起迁移。 */
export async function setSpaceName(
  db: PopmartDb,
  input: SetSpaceNameInput,
): Promise<{ name: string; replayed: boolean }> {
  const name = input.name.trim();
  if (name.length === 0) throw new CommandError('INVALID_DRAFT', '名称不能为空');
  if (name.length > 12) throw new CommandError('INVALID_DRAFT', '名称最多 12 个字符');

  const payloadHash = hashPayload({ name });

  return db.transaction(
    'rw',
    [db.datasets, db.appMeta, db.preferences, db.commandResults],
    async () => {
      const meta = await assertWritable(db, input.datasetId);

      const existing = await findCommand(db, input.datasetId, input.commandId);
      if (existing) return assertReplay(existing, payloadHash, null) as { name: string; replayed: boolean };

      const timestamp = nowIso();
      const previous = await db.preferences.get([input.datasetId, 'spaceName']);
      await db.preferences.put({
        datasetId: input.datasetId,
        id: 'spaceName',
        createdAt: previous?.createdAt ?? timestamp,
        updatedAt: timestamp,
        revision: (previous?.revision ?? 0) + 1,
        key: 'spaceName',
        value: name,
      });

      const result = { name, replayed: false };
      await db.commandResults.put({
        datasetId: input.datasetId,
        id: makeId(),
        createdAt: timestamp,
        updatedAt: timestamp,
        revision: 1,
        commandId: input.commandId,
        type: 'setSpaceName',
        payloadHash,
        result,
        committedAt: timestamp,
      });
      await db.appMeta.put({ ...meta, appDataRevision: meta.appDataRevision + 1 });
      return result;
    },
  );
}
