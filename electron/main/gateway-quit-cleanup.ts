import type { GatewayManager } from '../gateway/manager';
import {
  clearOwnedGatewayProcess,
  terminateDuplicateGatewayChildren,
} from '../gateway/process-registry';
import { getListeningProcessIds, terminateOrphanedProcessIds } from '../gateway/supervisor';
import { logger } from '../utils/logger';

/** Fast quit budget: if Gateway stops within this window, skip force-kill. */
export const QUIT_GATEWAY_FAST_STOP_MS = 2_000;

export async function shutdownGatewayForQuit(gatewayManager: GatewayManager): Promise<void> {
  const port = gatewayManager.getStatus().port;
  let stopCompleted = false;

  try {
    await Promise.race([
      gatewayManager.stop().then(() => {
        stopCompleted = true;
      }),
      new Promise<never>((_, reject) => {
        setTimeout(
          () => reject(new Error('Gateway stop exceeded fast quit budget')),
          QUIT_GATEWAY_FAST_STOP_MS,
        );
      }),
    ]);
  } catch (err) {
    logger.warn('Gateway stop did not finish within fast quit budget; forcing cleanup:', err);
  }

  if (!stopCompleted) {
    try {
      const terminated = await gatewayManager.forceTerminateOwnedProcessForQuit();
      if (terminated) {
        logger.warn('Forced gateway process termination completed during quit');
      }
    } catch (err) {
      logger.warn('Forced gateway termination failed during quit:', err);
    }
  }

  if (port > 0) {
    try {
      const pids = await getListeningProcessIds(port);
      const orphans = pids.filter((pid) => pid !== String(process.pid));
      if (orphans.length > 0) {
        logger.warn(
          `Quit cleanup: terminating remaining gateway listeners on port ${port} (PIDs: ${orphans.join(', ')})`,
        );
        await terminateOrphanedProcessIds(port, orphans);
      }
    } catch (err) {
      logger.warn('Port-based gateway cleanup failed during quit:', err);
    }
  }

  try {
    await terminateDuplicateGatewayChildren({ reason: 'quit' });
  } catch (err) {
    logger.warn('Gateway child cleanup failed during quit:', err);
  }

  clearOwnedGatewayProcess();
}
