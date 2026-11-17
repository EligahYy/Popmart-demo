import { initializeDatabase } from '../db/commands.js';
import { createDatabase, openDatabase, type PopmartDb } from '../db/database.js';
import { SharedClient } from '../shared/client.js';

export interface Runtime {
  readonly db: PopmartDb;
  readonly datasetId: string;
  readonly sharedVersion?: number;
}

let runtimePromise: Promise<Runtime> | null = null;

export function getRuntime(): Promise<Runtime> {
  if (!runtimePromise) {
    runtimePromise = (async () => {
      const response = await fetch('/api/shared/config', { cache: 'no-store' });
      if (!response.ok) throw new Error('无法连接数据服务，请检查网络后重试');
      const config = await response.json() as { mode: 'local' | 'shared'; configured: boolean };
      if (config.mode === 'shared' && !config.configured) {
        throw new Error('共享数据库尚未配置，请在 Vercel 连接 Neon 并重新部署');
      }
      // Keep the original private database intact; do not silently publish it.
      const db = createDatabase(config.mode === 'shared' ? 'my-popmart-shared-v1' : undefined);
      await openDatabase(db);
      if (config.mode === 'shared') {
        db.shared = new SharedClient(db, fetch, (datasetId) => {
          window.dispatchEvent(new CustomEvent('shared:data', { detail: { datasetId } }));
        });
        await db.shared.refresh();
        const meta = await db.appMeta.get('control');
        if (!meta) throw new Error('云端数据初始化失败');
        return { db, datasetId: meta.activeDatasetId, sharedVersion: 0 };
      }
      const datasetId = await initializeDatabase(db);
      return { db, datasetId };
    })();
  }
  return runtimePromise;
}
