import { useEffect, useState } from 'react';
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
  const [media, setMedia] = useState<PersonalMedia | null>(null);

  useEffect(() => {
    let cancelled = false;
    let objectUrl: string | null = null;

    setMedia(null);
    getPersonalAsset(db, datasetId, role)
      .then(async (asset) => {
        if (!asset || cancelled) return;
        const blob = await readPersonalBlob(db, datasetId, asset.assetId);
        if (!blob || cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setMedia({ url: objectUrl, kind: asset.kind });
      })
      .catch(() => {
        /* 读取失败时保持占位 */
      });

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [db, datasetId, sharedVersion, role, refreshKey]);

  return media;
}
