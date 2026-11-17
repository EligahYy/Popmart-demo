import { nowIso, type PopmartDb } from '../db/database.js';
import { sha256Hex } from './hash.js';

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_VIDEO_BYTES = 30 * 1024 * 1024;

export type PersonalKind = 'image' | 'video';
export type PersonalRole = 'idle' | 'greeting' | 'greetingPoster';

const OWNER_BY_ROLE: Record<PersonalRole, string> = {
  idle: 'home',
  greeting: 'greeting',
  greetingPoster: 'greeting_poster',
};

export interface PersonalAssetRef {
  readonly assetId: string;
  readonly kind: PersonalKind;
}

function ownerId(role: PersonalRole): string {
  return OWNER_BY_ROLE[role];
}

/**
 * 共享模式上传云端；本机模式只写入浏览器。
 * idle：首页常态形象（图片或循环视频）；greeting：点击时播放一次的打招呼视频。
 */
export async function savePersonalAsset(
  db: PopmartDb,
  datasetId: string,
  file: File,
  role: PersonalRole = 'idle',
): Promise<{ hash: string; kind: PersonalKind }> {
  const isVideo = file.type.startsWith('video/');
  const isImage = file.type.startsWith('image/');
  if (!isVideo && !isImage) throw new Error('只支持图片或视频');
  if (role === 'greeting' && !isVideo) throw new Error('打招呼素材需要视频');
  if (isVideo && file.size > MAX_VIDEO_BYTES) throw new Error('视频超过 30MB');
  if (isImage && file.size > MAX_IMAGE_BYTES) throw new Error('图片超过 10MB');

  if (db.shared) {
    const uploaded = await db.shared.upload(file);
    return db.shared.command('savePersonalAsset', { datasetId, hash: uploaded.id, mime: file.type, role });
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  const hash = await sha256Hex(bytes);
  const timestamp = nowIso();
  const owner = ownerId(role);

  await db.transaction('rw', [db.assets, db.mediaBlobs], async () => {
    const previous = await db.assets
      .where('[datasetId+ownerType+ownerId]')
      .equals([datasetId, 'personal', owner])
      .toArray();
    for (const asset of previous) {
      if (asset.status === 'ready') {
        await db.assets.put({ ...asset, status: 'retired', updatedAt: timestamp, revision: asset.revision + 1 });
      }
    }

    await db.mediaBlobs.put({ datasetId, id: hash, blob: new Blob([bytes], { type: file.type }) });
    await db.assets.put({
      datasetId,
      id: hash,
      createdAt: timestamp,
      updatedAt: timestamp,
      revision: 1,
      hash,
      mime: file.type,
      byteLength: file.size,
      kind:
        role === 'greeting'
          ? 'greeting_video'
          : isVideo
            ? 'video'
            : 'personal_image',
      sourceUrl: null,
      ownerType: 'personal',
      ownerId: owner,
      status: 'ready',
    });
  });

  return { hash, kind: isVideo ? 'video' : 'image' };
}

export async function getPersonalAsset(
  db: PopmartDb,
  datasetId: string,
  role: PersonalRole = 'idle',
): Promise<PersonalAssetRef | null> {
  const assets = await db.assets
    .where('[datasetId+ownerType+ownerId]')
    .equals([datasetId, 'personal', ownerId(role)])
    .toArray();
  const latest = assets
    .filter((asset) => asset.status === 'ready')
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0];
  if (!latest) return null;
  return {
    assetId: latest.id,
    kind: latest.kind === 'video' || latest.kind === 'greeting_video' ? 'video' : 'image',
  };
}

export async function clearPersonalAssets(
  db: PopmartDb,
  datasetId: string,
  role: PersonalRole = 'idle',
): Promise<void> {
  if (db.shared) return db.shared.command('clearPersonalAssets', { datasetId, role });
  const assets = await db.assets
    .where('[datasetId+ownerType+ownerId]')
    .equals([datasetId, 'personal', ownerId(role)])
    .toArray();
  const timestamp = nowIso();
  await db.assets.bulkPut(
    assets
      .filter((asset) => asset.status !== 'retired')
      .map((asset) => ({ ...asset, status: 'retired' as const, updatedAt: timestamp, revision: asset.revision + 1 })),
  );
}

export async function readPersonalBlob(
  db: PopmartDb,
  datasetId: string,
  assetId: string,
): Promise<Blob | null> {
  const row = await db.mediaBlobs.get([datasetId, assetId]);
  return row?.blob ?? (db.shared ? db.shared.readMedia(assetId) : null);
}
