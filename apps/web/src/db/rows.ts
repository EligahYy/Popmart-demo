import type { Cents, AcquisitionDate, YearMonth } from '@my-popmart/contracts';
import type { SharedMedia } from '@my-popmart/contracts';

export interface RowBase {
  readonly datasetId: string;
  readonly id: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly revision: number;
}

export type DatasetStatus = 'staging' | 'active' | 'retired';

export interface DatasetRow {
  readonly id: string;
  status: DatasetStatus;
  readonly schemaVersion: number;
  verifiedAt: string | null;
}

export interface AppMetaRow {
  sharedCache?: { instanceId: string; revision: number; media: SharedMedia[] };
  readonly id: 'control';
  activeDatasetId: string;
  readonly dbSchemaVersion: number;
  appDataRevision: number;
  maintenance: 'none' | 'restore';
  maintenanceOpId: string | null;
  ownerTabId: string | null;
  leaseExpiresAt: number | null;
  fencingEpoch: number;
}

export interface IpRow extends RowBase {
  readonly canonicalKey: string;
  displayName: string;
  aliases: readonly string[];
  sortOrder: number;
}

export type ProductKind = 'figure' | 'plush_pendant' | 'pop_bean' | 'accessory' | 'other';

export interface SeriesRow extends RowBase {
  /** Monotonic within a dataset, including re-imports; legacy rows may omit it. */
  importOrder?: number;
  readonly ipId: string;
  readonly canonicalKey: string;
  displayName: string;
  aliases: readonly string[];
  readonly productKind: ProductKind;
  sortOrder: number;
  defaultUnitCents: Cents | null;
  priceProvenance: string | null;
  priceUpdatedAt: string | null;
  foreignReference: unknown | null;
  sourceUrl: string | null;
  importedAt: string | null;
}

export type MediaStatus = 'remote' | 'cached' | 'missing';

export interface StyleRow extends RowBase {
  readonly seriesId: string;
  readonly canonicalKey: string;
  displayName: string;
  readonly isSecret: boolean;
  imageAssetId: string | null;
  imageUrl: string | null;
  mediaStatus: MediaStatus;
  referenceUnitCents: Cents | null;
  priceProvenance: string | null;
  priceUpdatedAt: string | null;
  sortOrder: number;
}

export type AcquisitionSource = 'official' | 'secondhand' | 'gift';
export type RecordStatus = 'active' | 'deleted';
export type AllocationMode = 'proportional' | 'manual';

export interface AcquisitionRow extends RowBase {
  readonly source: AcquisitionSource;
  readonly date: AcquisitionDate;
  readonly paidTotalCents: Cents | null;
  channel: string | null;
  note: string | null;
  status: RecordStatus;
  readonly commandId: string;
}

export interface AcquisitionLineRow extends RowBase {
  readonly acquisitionId: string;
  readonly styleId: string;
  readonly quantity: number;
  readonly allocatedCents: Cents | null;
  readonly referenceUnitCentsSnapshot: Cents | null;
  readonly allocationMode: AllocationMode;
  readonly lineOrder: number;
  status: RecordStatus;
}

export interface CollectionProfileRow extends RowBase {
  readonly styleId: string;
  readonly collectionNo: string;
  nickname: string | null;
  story: string | null;
}

export interface CommandResultRow extends RowBase {
  readonly commandId: string;
  readonly type: string;
  readonly payloadHash: string;
  readonly result: unknown;
  readonly committedAt: string;
}

export interface CounterRow extends RowBase {
  readonly key: string;
  value: number;
}

export type RefundKind = 'refund_only' | 'return';

export interface RefundRow extends RowBase {
  readonly acquisitionId: string;
  readonly kind: RefundKind;
  readonly processedOn: string;
  readonly totalCents: Cents;
  note: string | null;
  status: RecordStatus;
}

export interface RefundLineRow extends RowBase {
  readonly refundId: string;
  readonly acquisitionLineId: string;
  readonly refundCents: Cents;
  readonly returnedQuantity: number;
  status: RecordStatus;
}

export type TransferKind = 'give_away' | 'sold';

export interface TransferRow extends RowBase {
  readonly kind: TransferKind;
  readonly occurredOn: string;
  note: string | null;
  status: RecordStatus;
}

export interface TransferLineRow extends RowBase {
  readonly transferId: string;
  readonly acquisitionLineId: string;
  readonly quantity: number;
  status: RecordStatus;
}

export interface BudgetRuleRow extends RowBase {
  readonly effectiveFromMonth: YearMonth;
  amountLimitCents: Cents | null;
  quantityLimit: number | null;
}

export interface BudgetMonthRow extends RowBase {
  readonly month: YearMonth;
  amountLimitCents: Cents | null;
  quantityLimit: number | null;
  ruleId: string | null;
}

export type AssetKind =
  | 'style_image'
  | 'ip_image'
  | 'personal_image'
  | 'video'
  | 'greeting_video'
  | 'poster';

export interface AssetRow extends RowBase {
  readonly hash: string;
  readonly mime: string;
  readonly byteLength: number;
  readonly kind: AssetKind;
  readonly sourceUrl: string | null;
  readonly ownerType: 'style' | 'ip' | 'series' | 'personal';
  readonly ownerId: string;
  status: 'pending' | 'ready' | 'failed' | 'retired';
}

export interface MediaBlobRow {
  readonly datasetId: string;
  readonly id: string;
  readonly blob: Blob;
}

export interface PreferenceRow extends RowBase {
  readonly key: string;
  value: string;
}
