import { neon } from '@neondatabase/serverless';
import type { SharedSnapshot, SharedState } from '@my-popmart/contracts';

export interface MediaPart {
  id: string;
  part: number;
  parts: number;
  mime: string;
  bytes: string;
}
export interface SharedStore {
  read(): Promise<SharedState | null>;
  initialize(snapshot: SharedSnapshot): Promise<void>;
  compareAndSwap(revision: number, snapshot: SharedSnapshot): Promise<SharedState | null>;
  putMedia(part: MediaPart): Promise<void>;
  readMedia(id: string): Promise<MediaPart[]>;
  readMediaPart(id: string, part: number): Promise<MediaPart | undefined>;
}

/** Only Postgres is authoritative. No filesystem or process-memory persistence. */
export function createNeonStore(url: string, space = 'public'): SharedStore {
  const sql = neon(url);
  let ready: Promise<void> | undefined;
  function ensureTables(): Promise<void> {
    ready ??= (async () => {
      await sql.query(`CREATE TABLE IF NOT EXISTS popmart_shared_spaces (
        id text PRIMARY KEY, revision bigint NOT NULL DEFAULT 1,
        snapshot jsonb NOT NULL, updated_at timestamptz NOT NULL DEFAULT now()
      )`);
      await sql.query(`CREATE TABLE IF NOT EXISTS popmart_shared_media (
        space_id text NOT NULL, id text NOT NULL, part integer NOT NULL,
        parts integer NOT NULL, mime text NOT NULL, bytes text NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (space_id, id, part)
      )`);
    })().catch((error: unknown) => { ready = undefined; throw error; });
    return ready;
  }
  function state(row: Record<string, unknown> | undefined): SharedState | null {
    if (!row) return null;
    return { revision: Number(row.revision), snapshot: row.snapshot as SharedSnapshot };
  }
  return {
    async read() {
      await ensureTables();
      return state((await sql.query('SELECT revision, snapshot FROM popmart_shared_spaces WHERE id = $1', [space]))[0]);
    },
    async initialize(snapshot) {
      await ensureTables();
      await sql.query('INSERT INTO popmart_shared_spaces (id, snapshot) VALUES ($1, $2::jsonb) ON CONFLICT (id) DO NOTHING', [space, JSON.stringify(snapshot)]);
    },
    async compareAndSwap(revision, snapshot) {
      await ensureTables();
      return state((await sql.query(`UPDATE popmart_shared_spaces
        SET snapshot = $1::jsonb, revision = revision + 1, updated_at = now()
        WHERE id = $2 AND revision = $3 RETURNING revision, snapshot`, [JSON.stringify(snapshot), space, revision]))[0]);
    },
    async putMedia(item) {
      await ensureTables();
      await sql.query(`INSERT INTO popmart_shared_media (space_id, id, part, parts, mime, bytes)
        VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (space_id, id, part) DO NOTHING`,
      [space, item.id, item.part, item.parts, item.mime, item.bytes]);
    },
    async readMedia(id) {
      await ensureTables();
      const rows = await sql.query('SELECT id, part, parts, mime, bytes FROM popmart_shared_media WHERE space_id = $1 AND id = $2 ORDER BY part', [space, id]);
      return rows as MediaPart[];
    },
    async readMediaPart(id, part) {
      await ensureTables();
      const rows = await sql.query('SELECT id, part, parts, mime, bytes FROM popmart_shared_media WHERE space_id = $1 AND id = $2 AND part = $3', [space, id, part]);
      return rows[0] as MediaPart | undefined;
    },
  };
}
