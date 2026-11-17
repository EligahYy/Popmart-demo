/** One public, shared collection, persisted by the server. */
export const SHARED_TABLES = [
  'datasets', 'appMeta', 'ips', 'series', 'styles', 'acquisitions',
  'acquisitionLines', 'collectionProfiles', 'refunds', 'refundLines',
  'transfers', 'transferLines', 'budgetRules', 'budgetMonths', 'assets',
  'preferences', 'commandResults', 'counters',
] as const;

export const SHARED_COMMANDS = [
  'commitSeriesImport', 'createAcquisition', 'setBudget', 'updateAcquisition',
  'deleteAcquisition', 'createRefund', 'createTransfer', 'updateCollectionProfile',
  'setSpaceName', 'savePersonalAsset', 'clearPersonalAssets', 'restoreBackup',
] as const;

export const MEDIA_CHUNK_BYTES = 512 * 1024;
export const MAX_SHARED_MEDIA_BYTES = 30 * 1024 * 1024;

export type SharedTable = (typeof SHARED_TABLES)[number];
export type SharedCommand = (typeof SHARED_COMMANDS)[number];
export interface SharedMedia {
  readonly id: string;
  readonly datasetId: string;
  readonly mime: string;
  readonly bytes: number;
  readonly parts: number;
}
export interface SharedSnapshot {
  readonly schemaVersion: 1;
  readonly instanceId: string;
  readonly tables: Record<SharedTable, Array<Record<string, unknown>>>;
  readonly media: SharedMedia[];
  readonly receipts: Array<{ id: string; result: unknown }>;
}
export interface SharedState {
  readonly revision: number;
  readonly snapshot: SharedSnapshot;
}
