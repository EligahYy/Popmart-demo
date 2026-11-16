import { useEffect, useState } from 'react';
import { useRuntime } from '../app/RuntimeProvider.js';

/**
 * 优先使用本机 Blob，没有缓存时退回远程地址。
 * 组件卸载时释放 object URL，避免内存泄漏。
 */
export function useStyleImage(
  imageUrl: string | null,
  assetId: string | null | undefined,
): string | null {
  const { db, datasetId } = useRuntime();
  const [url, setUrl] = useState<string | null>(imageUrl);

  useEffect(() => {
    if (!assetId) {
      setUrl(imageUrl);
      return;
    }

    let cancelled = false;
    let objectUrl: string | null = null;

    db.mediaBlobs
      .get([datasetId, assetId])
      .then((row) => {
        if (cancelled) return;
        if (!row) {
          setUrl(imageUrl);
          return;
        }
        objectUrl = URL.createObjectURL(row.blob);
        setUrl(objectUrl);
      })
      .catch(() => {
        if (!cancelled) setUrl(imageUrl);
      });

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [db, datasetId, assetId, imageUrl]);

  return url;
}
