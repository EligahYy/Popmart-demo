import Dexie, { type DexieOptions, type Table } from 'dexie';
import type { SharedCommand, SharedMedia } from '@my-popmart/contracts';
import type {
  AcquisitionLineRow,
  AcquisitionRow,
  AppMetaRow,
  AssetRow,
  BudgetMonthRow,
  BudgetRuleRow,
  CollectionProfileRow,
  CommandResultRow,
  CounterRow,
  DatasetRow,
  IpRow,
  MediaBlobRow,
  PreferenceRow,
  RefundLineRow,
  RefundRow,
  SeriesRow,
  StyleRow,
  TransferLineRow,
  TransferRow,
} from './rows.js';

export const DB_NAME = 'my-popmart';
export const DB_SCHEMA_VERSION = 2;

export interface SharedAccess {
  command<T>(name: SharedCommand, payload: unknown): Promise<T>;
  refresh(): Promise<void>;
  upload(blob: Blob): Promise<SharedMedia>;
  readMedia(id: string): Promise<Blob | null>;
  hydrateMedia(): Promise<void>;
}

export class PopmartDb extends Dexie {
  shared?: SharedAccess;
  datasets!: Table<DatasetRow, string>;
  appMeta!: Table<AppMetaRow, string>;
  ips!: Table<IpRow, [string, string]>;
  series!: Table<SeriesRow, [string, string]>;
  styles!: Table<StyleRow, [string, string]>;
  acquisitions!: Table<AcquisitionRow, [string, string]>;
  acquisitionLines!: Table<AcquisitionLineRow, [string, string]>;
  collectionProfiles!: Table<CollectionProfileRow, [string, string]>;
  refunds!: Table<RefundRow, [string, string]>;
  refundLines!: Table<RefundLineRow, [string, string]>;
  transfers!: Table<TransferRow, [string, string]>;
  transferLines!: Table<TransferLineRow, [string, string]>;
  budgetRules!: Table<BudgetRuleRow, [string, string]>;
  budgetMonths!: Table<BudgetMonthRow, [string, string]>;
  assets!: Table<AssetRow, [string, string]>;
  mediaBlobs!: Table<MediaBlobRow, [string, string]>;
  preferences!: Table<PreferenceRow, [string, string]>;
  commandResults!: Table<CommandResultRow, [string, string]>;
  counters!: Table<CounterRow, [string, string]>;

  constructor(name = DB_NAME, options?: DexieOptions) {
    super(name, options);
    this.version(1).stores({
      datasets: 'id, status',
      appMeta: 'id',
      ips: '[datasetId+id], datasetId, &[datasetId+canonicalKey]',
      series: '[datasetId+id], datasetId, ipId, [datasetId+ipId], &[datasetId+canonicalKey]',
      styles: '[datasetId+id], datasetId, seriesId, [datasetId+seriesId], &[datasetId+canonicalKey]',
      acquisitions: '[datasetId+id], datasetId, date.month, date.day',
      acquisitionLines: '[datasetId+id], datasetId, acquisitionId, styleId, [datasetId+styleId], status',
      collectionProfiles: '[datasetId+id], datasetId, &[datasetId+styleId], &[datasetId+collectionNo]',
      refunds: '[datasetId+id], datasetId, acquisitionId',
      refundLines: '[datasetId+id], datasetId, refundId, acquisitionLineId',
      transfers: '[datasetId+id], datasetId',
      transferLines: '[datasetId+id], datasetId, transferId, acquisitionLineId',
      budgetRules: '[datasetId+id], datasetId, &[datasetId+effectiveFromMonth]',
      budgetMonths: '[datasetId+id], datasetId, &[datasetId+month]',
      assets: '[datasetId+id], datasetId, hash, [datasetId+ownerType+ownerId]',
      mediaBlobs: '[datasetId+id], datasetId',
      preferences: '[datasetId+id], datasetId, &[datasetId+key]',
      commandResults: '[datasetId+id], datasetId, &[datasetId+commandId]',
      counters: '[datasetId+id], datasetId',
    });
    // Style names/keys are unique within a series, not across the entire space.
    // This only replaces an index; existing records and their IDs are preserved.
    this.version(DB_SCHEMA_VERSION).stores({
      styles: '[datasetId+id], datasetId, seriesId, [datasetId+seriesId], &[datasetId+seriesId+canonicalKey]',
    });
  }
}

export function createDatabase(name?: string): PopmartDb {
  return new PopmartDb(name);
}

export async function openDatabase(db: PopmartDb): Promise<void> {
  if (!db.isOpen()) await db.open();
}

export function nowIso(): string {
  return new Date().toISOString();
}
