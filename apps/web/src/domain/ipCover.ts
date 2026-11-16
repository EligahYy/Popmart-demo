export interface CoverCandidate {
  readonly url: string;
  readonly assetId: string | null;
}

function hashSeed(text: string): number {
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function sessionSeed(storage: Storage, now: number): string {
  const existing = storage.getItem('mp-session-seed');
  if (existing) return existing;
  const created = `${now}-${Math.random().toString(36).slice(2, 8)}`;
  storage.setItem('mp-session-seed', created);
  return created;
}

/**
 * 纯函数：从可用图片里挑一张，尽量避开上次用过的。
 * 同一 seed 下结果稳定（会话内不变），由调用方负责持久化上次选择。
 */
export function chooseCover(
  ipId: string,
  covers: readonly CoverCandidate[],
  seed: string,
  lastUrl: string | null,
): CoverCandidate | null {
  const candidates = covers.filter((cover) => cover.url !== '');
  if (candidates.length === 0) return null;
  if (candidates.length === 1) return candidates[0] ?? null;

  const pool = candidates.filter((cover) => cover.url !== lastUrl);
  const source = pool.length > 0 ? pool : candidates;
  return source[hashSeed(`${seed}:${ipId}`) % source.length] ?? candidates[0] ?? null;
}
