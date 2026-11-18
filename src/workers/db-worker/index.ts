import { parentPort as nodeWorkerParentPort } from 'node:worker_threads';
import { attachWorkerRpcHandler, type MinimalPortLike } from '../../shared/worker-protocol';
import { DbWorkerService } from './service';

export { DbWorkerService } from './service';
export { configureSqlitePragmas, migrateGlobalDb, migrateProjectDb } from './schema';

const electronParentPort = (process as NodeJS.Process & { parentPort?: MinimalPortLike }).parentPort;
const activePort: MinimalPortLike | null = electronParentPort ?? (nodeWorkerParentPort as MinimalPortLike | null);

if (activePort) {
  const dbService = new DbWorkerService({
    storageRootDir: process.env.STUDIO_DATA_DIR,
  });
  attachWorkerRpcHandler(activePort, dbService);
}
