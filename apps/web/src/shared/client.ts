import {
  MEDIA_CHUNK_BYTES, MAX_SHARED_MEDIA_BYTES,
  type SharedCommand, type SharedMedia, type SharedState,
} from '@my-popmart/contracts';
import type { PopmartDb, SharedAccess } from '../db/database.js';
import { sha256Hex } from '../media/hash.js';
import { applySnapshot } from './snapshot.js';

export class SharedClient implements SharedAccess {
  private revision = 0;
  private instanceId: string | undefined;
  private tail: Promise<unknown> = Promise.resolve();
  private media = new Map<string, SharedMedia>();
  private mediaLoads = new Map<string, Promise<Blob | null>>();
  private uploaded = new Set<string>();

  constructor(
    readonly db: PopmartDb,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly changed: (datasetId: string) => void = () => undefined,
  ) {}

  private serial<T>(work: () => Promise<T>): Promise<T> {
    const next = this.tail.then(work);
    this.tail = next.catch(() => undefined);
    return next;
  }

  private async request(path: string, init?: RequestInit): Promise<Response> {
    const response = await this.fetchImpl.call(globalThis, path, {
      ...init, cache: 'no-store', signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) {
      const body = await response.json().catch(() => null) as { message?: string; code?: string } | null;
      throw Object.assign(new Error(body?.message ?? `共享服务请求失败（${response.status}）`), { code: body?.code });
    }
    return response;
  }

  private async accept(state: SharedState): Promise<void> {
    if (state.snapshot.instanceId === this.instanceId && state.revision <= this.revision) return;
    const snapshot = structuredClone(state.snapshot);
    // Keep locally cached official thumbnails; they are not authoritative cloud records.
    for (const row of snapshot.tables.styles) {
      const previous = await this.db.styles.get([String(row.datasetId), String(row.id)]);
      if (previous?.imageAssetId && previous.imageUrl === row.imageUrl &&
        await this.db.mediaBlobs.get([previous.datasetId, previous.imageAssetId])) {
        row.imageAssetId = previous.imageAssetId;
        row.mediaStatus = 'cached';
        const asset = await this.db.assets.get([previous.datasetId, previous.imageAssetId]);
        if (asset && !snapshot.tables.assets.some((a) => a.id === asset.id && a.datasetId === asset.datasetId)) {
          snapshot.tables.assets.push({ ...asset });
        }
      }
    }
    const datasetId = await applySnapshot(this.db, snapshot, state.revision);
    const cached = (await this.db.appMeta.get('control'))?.sharedCache;
    this.media = new Map((cached?.media ?? snapshot.media).map((item) => [`${item.datasetId}:${item.id}`, item]));
    this.revision = cached?.revision ?? state.revision;
    this.instanceId = cached?.instanceId ?? snapshot.instanceId;
    this.changed(datasetId);
  }

  private async synchronize(): Promise<void> {
    const response = await this.request(`/api/shared/state?revision=${this.revision}`);
    if (response.status !== 204) await this.accept(await response.json() as SharedState);
  }

  refresh(): Promise<void> { return this.serial(() => this.synchronize()); }

  command<T>(name: SharedCommand, payload: unknown): Promise<T> {
    return this.serial(async () => {
      const body = JSON.stringify({ name, payload, requestId: crypto.randomUUID() });
      try {
        const init = { method: 'POST', headers: { 'content-type': 'application/json' }, body };
        let response: Response;
        try { response = await this.request('/api/shared/commands', init); }
        catch (error) {
          // Retrying the same request ID also handles a response lost after commit.
          if (!(error instanceof TypeError) && !(error instanceof DOMException)) throw error;
          response = await this.request('/api/shared/commands', init);
        }
        const saved = await response.json() as { result: T; state: SharedState };
        await this.accept(saved.state);
        return saved.result;
      } catch (error) {
        // A conflicting edit must not remain displayed as a successful local save.
        await this.synchronize().catch(() => undefined);
        throw error;
      }
    });
  }

  async upload(blob: Blob): Promise<SharedMedia> {
    if (!blob.size || blob.size > MAX_SHARED_MEDIA_BYTES) throw new Error('共享素材需小于等于 30MB');
    const id = await sha256Hex(await blob.arrayBuffer());
    const meta = await this.db.appMeta.get('control');
    if (!meta) throw new Error('共享空间尚未打开');
    const ref: SharedMedia = {
      id, datasetId: meta.activeDatasetId, mime: blob.type || 'application/octet-stream',
      bytes: blob.size, parts: Math.ceil(blob.size / MEDIA_CHUNK_BYTES),
    };
    if (!this.uploaded.has(id)) {
      for (let part = 0; part < ref.parts; part++) {
        const bytes = new Uint8Array(await blob.slice(part * MEDIA_CHUNK_BYTES, (part + 1) * MEDIA_CHUNK_BYTES).arrayBuffer());
        let text = '';
        for (let i = 0; i < bytes.length; i += 8192) text += String.fromCharCode(...bytes.subarray(i, i + 8192));
        await this.request(`/api/shared/media/${id}/${part}`, {
          method: 'PUT', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ parts: ref.parts, mime: ref.mime, bytes: btoa(text) }),
        });
      }
      this.uploaded.add(id);
    }
    return ref;
  }

  async readMedia(id: string): Promise<Blob | null> {
    const meta = await this.db.appMeta.get('control');
    if (!meta) return null;
    const existing = await this.db.mediaBlobs.get([meta.activeDatasetId, id]);
    if (existing) return existing.blob;
    const key = `${meta.activeDatasetId}:${id}`;
    const ref = this.media.get(key);
    if (!ref) return null;
    if (this.mediaLoads.has(key)) return this.mediaLoads.get(key) ?? null;
    const loading = (async () => {
      const parts: ArrayBuffer[] = [];
      for (let part = 0; part < ref.parts; part++) {
        parts.push(await (await this.request(`/api/shared/media/${id}/${part}`)).arrayBuffer());
      }
      const blob = new Blob(parts, { type: ref.mime });
      if (blob.size !== ref.bytes || await sha256Hex(await blob.arrayBuffer()) !== id) throw new Error('云端素材校验失败');
      await this.db.mediaBlobs.put({ datasetId: ref.datasetId, id, blob });
      return blob;
    })();
    this.mediaLoads.set(key, loading);
    try { return await loading; } finally { this.mediaLoads.delete(key); }
  }

  async hydrateMedia(): Promise<void> {
    const meta = await this.db.appMeta.get('control');
    for (const item of this.media.values()) if (item.datasetId === meta?.activeDatasetId) await this.readMedia(item.id);
  }
}
