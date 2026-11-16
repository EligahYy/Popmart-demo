import type { SeriesCandidate, SeriesPreview } from '@my-popmart/contracts';

export interface ImportErrorBody {
  code: string;
  message: string;
  retryable: boolean;
}

export class ImportRequestError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly retryable = false,
  ) {
    super(message);
  }
}

async function postJson<T>(path: string, payload: unknown): Promise<T> {
  const response = await fetch(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as ImportErrorBody | null;
    throw new ImportRequestError(
      body?.code ?? 'HTTP_ERROR',
      body?.message ?? `请求失败（${response.status}）`,
      body?.retryable ?? false,
    );
  }
  return (await response.json()) as T;
}

export async function resolveLink(input: string): Promise<SeriesCandidate[] | 'needs_name'> {
  const result = await postJson<
    { status: 'candidates'; candidates: SeriesCandidate[] } | { status: 'needs_name' }
  >('/api/import/resolve', { input });
  return result.status === 'needs_name' ? 'needs_name' : result.candidates;
}

export async function searchSeries(query: string): Promise<SeriesCandidate[]> {
  const result = await postJson<{ candidates: SeriesCandidate[] }>('/api/import/search', { query });
  return result.candidates;
}

export async function fetchPreview(candidateId: string): Promise<SeriesPreview> {
  return postJson<SeriesPreview>('/api/import/preview', { candidateId });
}
