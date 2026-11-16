export type ProductKind = 'figure' | 'plush_pendant' | 'pop_bean' | 'accessory' | 'other';

export interface SourcePrice {
  readonly amountMinor: number;
  readonly currency: string;
  readonly basis: 'single' | 'case' | 'unknown';
  readonly region: string;
  readonly sourceUrl: string;
}

export type ImportWarning =
  | 'PRICE_UNVERIFIED'
  | 'CNY_PRICE_UNAVAILABLE'
  | 'NO_STYLES'
  | 'IMAGE_MISSING'
  | 'TITLE_FROM_SLUG';

export interface SeriesPreviewStyle {
  readonly canonicalKey: string;
  readonly name: string;
  readonly isSecret: boolean;
  readonly image: { readonly sourceUrl: string; readonly assetToken: string } | null;
  readonly referenceUnitCents: number | null;
  readonly sourcePrice: SourcePrice | null;
}

export interface SeriesPreview {
  readonly previewVersion: 2;
  readonly candidateId: string;
  readonly canonicalKey: string;
  readonly ip: { readonly canonicalKey: string; readonly name: string; readonly aliases: readonly string[] };
  readonly name: string;
  readonly productKind: ProductKind;
  readonly region: string;
  readonly sourceUrl: string;
  readonly fetchedAt: string;
  readonly parserVersion: string;
  readonly seriesReferenceUnitCents: number | null;
  readonly priceProvenance: 'user_confirmed' | 'catalog' | 'from_history' | null;
  readonly foreignReference: SourcePrice | null;
  readonly styles: readonly SeriesPreviewStyle[];
  readonly warnings: readonly ImportWarning[];
}

export interface SeriesCandidate {
  readonly candidateId: string;
  readonly canonicalKey: string;
  readonly title: string;
  readonly ipName: string | null;
  readonly productKind: ProductKind;
  readonly region: string;
  readonly sourceUrl: string;
  readonly thumbnailUrl: string | null;
  readonly matchReason: string | null;
}

export type ImportErrorCode =
  | 'INVALID_INPUT'
  | 'MINIAPP_UNRESOLVED'
  | 'UNSUPPORTED_SOURCE'
  | 'NO_MATCH'
  | 'AMBIGUOUS_MATCH'
  | 'SOURCE_UNAVAILABLE'
  | 'SOURCE_CHANGED'
  | 'MEDIA_UNAVAILABLE'
  | 'RATE_LIMITED'
  | 'TOKEN_INVALID';

export interface ImportErrorBody {
  readonly code: ImportErrorCode;
  readonly message: string;
  readonly retryable: boolean;
}

export type ResolveResponse =
  | { readonly status: 'candidates'; readonly candidates: readonly SeriesCandidate[] }
  | { readonly status: 'needs_name'; readonly reason: string };

export interface SearchResponse {
  readonly candidates: readonly SeriesCandidate[];
}
