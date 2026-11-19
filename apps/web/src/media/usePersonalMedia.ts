import { useEffect, useRef, useState } from 'react';
import { useRuntime } from '../app/RuntimeProvider.js';
import { getPersonalAsset, readPersonalBlob, type PersonalKind, type PersonalRole } from './personal.js';

export interface PersonalMedia {
  readonly url: string;
  readonly kind: PersonalKind;
}

interface MediaStatus {
  readonly scope: string;
  readonly hasAsset: boolean;
  readonly settled: boolean;
}

/** Load media in the app shell so the object URL survives route changes. */
export function usePersonalMedia(role: PersonalRole, refreshKey: string, enabled = true) {
  const { db, datasetId, sharedVersion } = useRuntime();
  const scope = JSON.stringify([db.name, datasetId, role]);
  const [resolved, setResolved] = useState<{ scope: string; assetId: string; media: PersonalMedia } | null>(null);
  const [status, setStatus] = useState<MediaStatus | null>(null);
  const current = useRef(resolved);

  // Unrelated cloud edits must retain the URL and its video decoder. Dispose
  // the previous URL only after its replacement has committed to the DOM.
  useEffect(() => () => {
    if (resolved) URL.revokeObjectURL(resolved.media.url);
  }, [resolved]);

  useEffect(() => {
    let cancelled = false;
    let retryTimer: number | undefined;
    let retryDelay = 500;

    async function load() {
      let hasAsset = false;
      try {
        const asset = await getPersonalAsset(db, datasetId, role);
        if (cancelled) return;
        if (!asset) {
          current.current = null;
          setResolved(null);
          setStatus({ scope, hasAsset: false, settled: true });
          return;
        }
        hasAsset = true;
        if (current.current?.scope === scope && current.current.assetId === asset.assetId) {
          setStatus({ scope, hasAsset: true, settled: true });
          return;
        }
        if (retryTimer === undefined) setStatus({ scope, hasAsset: true, settled: false });
        // Discover the greeting immediately so a tap on the poster can queue
        // playback while the shell gives the smaller poster download priority.
        if (!enabled) return;
        const blob = await readPersonalBlob(db, datasetId, asset.assetId);
        if (cancelled) return;
        if (!blob) throw new Error('素材暂时不可用');
        const next = { scope, assetId: asset.assetId, media: { url: URL.createObjectURL(blob), kind: asset.kind } };
        current.current = next;
        setResolved(next);
        setStatus({ scope, hasAsset: true, settled: true });
      } catch {
        if (cancelled) return;
        setStatus({ scope, hasAsset, settled: true });
        if (db.shared) {
          retryTimer = window.setTimeout(load, retryDelay);
          retryDelay = Math.min(30_000, retryDelay * 2);
        }
      }
    }
    void load();

    return () => {
      cancelled = true;
      window.clearTimeout(retryTimer);
    };
  }, [db, datasetId, sharedVersion, role, refreshKey, scope, enabled]);

  return {
    media: resolved?.scope === scope ? resolved.media : null,
    hasAsset: status?.scope === scope && status.hasAsset,
    settled: status?.scope === scope && status.settled,
  };
}
