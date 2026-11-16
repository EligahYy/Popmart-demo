export const BACKUP_FORMAT_NAME = 'my-popmart-backup';
export const BACKUP_FORMAT_VERSION = 1;
export const DATA_SCHEMA_VERSION = 1;

export const BACKUP_TABLES = [
  'ips',
  'series',
  'styles',
  'acquisitions',
  'acquisitionLines',
  'collectionProfiles',
  'refunds',
  'refundLines',
  'transfers',
  'transferLines',
  'budgetRules',
  'budgetMonths',
  'assets',
  'counters',
  'commandResults',
  'preferences',
] as const;

export type BackupTable = (typeof BACKUP_TABLES)[number];

export interface BackupFileEntry {
  readonly path: string;
  readonly bytes: number;
  readonly sha256: string;
}

export interface BackupManifest {
  readonly formatName: typeof BACKUP_FORMAT_NAME;
  readonly backupFormatVersion: number;
  readonly dataSchemaVersion: number;
  readonly appVersion: string;
  readonly exportedAt: string;
  readonly sourceDatasetId: string;
  readonly counts: Record<string, number>;
  readonly files: readonly BackupFileEntry[];
  readonly mediaComplete: boolean;
  readonly missingMedia: readonly string[];
}

export interface BackupInspection {
  readonly manifest: BackupManifest;
  readonly data: Record<string, unknown[]>;
  readonly media: Map<string, Uint8Array>;
}

export class BackupError extends Error {
  override readonly name = 'BackupError';
  constructor(
    readonly code:
      | 'INVALID_FORMAT'
      | 'UNSUPPORTED_VERSION'
      | 'HASH_MISMATCH'
      | 'MISSING_FILE'
      | 'INVALID_DATA'
      | 'REFERENCE_BROKEN'
      | 'RESTORE_FAILED',
    message: string,
  ) {
    super(message);
  }
}
