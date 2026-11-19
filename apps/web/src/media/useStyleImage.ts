import { useEffect, useState } from 'react';
import { useRuntime } from '../app/RuntimeProvider.js';
import { readThumbnail, thumbnailUrl, type ImageWidth } from './thumbnails.js';

/** Reuse a cached thumbnail without reloading images on unrelated shared updates. */
export function useStyleImage(
  imageUrl: string | null,
  assetId: string | null | undefined,
  width: ImageWidth = 384,
): string | null {
  const { db, datasetId } = useRuntime();
  const fallback = thumbnailUrl(imageUrl, width);
  const key = JSON.stringify([datasetId, imageUrl, assetId, width]);
  const [resolved, setResolved] = useState({ key, url: fallback });

  useEffect(() => {
    let cancelled = false;
    let objectUrl: string | null = null;
    const load = async () => {
      // The service worker serves these images directly from the same cache.
      if (!assetId && navigator.serviceWorker?.controller) return;
      const thumbnail = fallback ? await readThumbnail(fallback) : null;
      const row = !thumbnail && assetId ? await db.mediaBlobs.get([datasetId, assetId]) : null;
      const blob = thumbnail ?? row?.blob ?? (assetId && db.shared ? await db.shared.readMedia(assetId) : null);
      if (cancelled || !blob) return;
      objectUrl = URL.createObjectURL(blob);
      setResolved({ key, url: objectUrl });
    };
    void load().catch(() => undefined);
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [db, datasetId, assetId, imageUrl, width, fallback, key]);

  return resolved.key === key ? resolved.url : fallback;
}
