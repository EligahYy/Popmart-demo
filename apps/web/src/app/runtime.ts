import { initializeDatabase } from '../db/commands.js';
import { createDatabase, openDatabase, type PopmartDb } from '../db/database.js';

export interface Runtime {
  readonly db: PopmartDb;
  readonly datasetId: string;
}

let runtimePromise: Promise<Runtime> | null = null;

export function getRuntime(): Promise<Runtime> {
  if (!runtimePromise) {
    runtimePromise = (async () => {
      const db = createDatabase();
      await openDatabase(db);
      const datasetId = await initializeDatabase(db);
      return { db, datasetId };
    })();
  }
  return runtimePromise;
}
