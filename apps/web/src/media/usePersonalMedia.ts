import { useEffect, useRef, useState } from 'react';
import { useRuntime } from '../app/RuntimeProvider.js';
import { getPersonalAsset, readPersonalBlob, type PersonalKind, type PersonalRole } from './personal.js';

export interface PersonalMedia {
  readonly url: string;
  readonly kind: PersonalKind;
}

/**
 * 优先读取本机缓存；共享模式下按需读取云端素材。
 */
export function usePersonalMedia(role: PersonalRole, refreshKey = 0): PersonalMedia | null {
  const { db, datasetId, sharedVersion } = useRuntime();
  const scope = JSON.stringify([db.name, datasetId, role]);
  const [resolved, setResolved] = useState<{ scope: string; assetId: string; media: PersonalMedia } | null>(null);
  const current = useRef(resolved);

  // Unrelated cloud edits must retain the URL and its video decoder. Dispose
  // the previous URL only after its replacement has committed to the DOM.
  useEffect(() => () => {
    if (resolved) URL.revokeObjectURL(resolved.media.url);
  }, [resolved]);

  useEffect(() => {
    let cancelled = false;
    getPersonalAsset(db, datasetId, role)
      .then(async (asset) => {
        if (cancelled) return;
        if (!asset) {
          current.current = null;
          setResolved(null);
          return;
        }
        if (current.current?.scope === scope && current.current.assetId === asset.assetId) return;
        const blob = await readPersonalBlob(db, datasetId, asset.assetId);
        if (!blob || cancelled) return;
        const next = { scope, assetId: asset.assetId, media: { url: URL.createObjectURL(blob), kind: asset.kind } };
        current.current = next;
        setResolved(next);
      })
      .catch(() => {
        /* 读取失败时保持占位 */
      });

    return () => {
      cancelled = true;
    };
  }, [db, datasetId, sharedVersion, role, refreshKey, scope]);

  return resolved?.scope === scope ? resolved.media : null;
}
