/**
 * STO Biz-Agent Auto-Sync Service
 *
 * After user login, fetches the department-based agent list from the STO
 * backend and auto-creates local OpenClaw agents for each entry that does
 * not already exist (dedup by `code` → local agent ID).
 */

import type { GatewayManager } from '../gateway/manager';
import { getStoToken } from '../utils/auth-store';
import { buildStoMemoryCenterAuthHeaders } from '../utils/sto-memory-api-auth';
import { resolveStoBaseUrl } from '../utils/sto-domain';
import { listConfiguredAgentIds, createAgentWithId, setAgentFileTransformByOSS } from '../utils/agent-config';
import { syncAllProviderAuthToRuntime } from './providers/provider-runtime-sync';
import { logger } from '../utils/logger';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface BizAgentItem {
  name: string;
  code: string;
  description: string;
  fileTransformByOSS?: boolean;
}

export interface StoBizAgentSyncResult {
  created: string[];
  skipped: string[];
  error?: string;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

const BIZ_AGENT_API_PATH = '/agent/v1/biz-agent/agents/by-department';

export class StoBizAgentSyncService {
  private gatewayManager: GatewayManager | null = null;
  private currentSync: Promise<StoBizAgentSyncResult> | null = null;

  setGatewayManager(gm: GatewayManager): void {
    this.gatewayManager = gm;
  }

  /**
   * Run a full sync cycle. Safe to call concurrently — if a sync is already
   * in progress the caller gets the same promise back.
   */
  async syncAgents(): Promise<StoBizAgentSyncResult> {
    if (this.currentSync) {
      return this.currentSync;
    }
    this.currentSync = this.doSync();
    try {
      return await this.currentSync;
    } finally {
      this.currentSync = null;
    }
  }

  private async doSync(): Promise<StoBizAgentSyncResult> {
    const result: StoBizAgentSyncResult = {
      created: [],
      skipped: [],
    };

    // Step 1 — Auth precondition
    const token = await getStoToken();
    if (!token) {
      result.error = 'no-token';
      return result;
    }

    // Step 2 — Fetch remote biz-agent list
    let remoteAgents: BizAgentItem[];
    try {
      remoteAgents = await this.fetchRemoteAgents(token);
      logger.info(`fetch-remoteAgents:${JSON.stringify(remoteAgents)}`)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.warn(`[sto-biz-agent] Failed to fetch department agents: ${message}`);
      result.error = `fetch-failed: ${message}`;
      return result;
    }

    if (remoteAgents.length === 0) {
      logger.info('[sto-biz-agent] Remote returned 0 agents, nothing to create');
      return result;
    }

    // Step 3 — Dedup against existing local agents
    const existingIds = new Set(await listConfiguredAgentIds());
    logger.info(
      `[sto-biz-agent] Remote returned ${remoteAgents.length} agents, ${existingIds.size} already exist locally`,
    );

    // Step 4 — Create missing agents
    for (const item of remoteAgents) {
      const code = item.code?.trim();
      if (!code || code === 'main') {
        logger.warn(`[sto-biz-agent] Skipping invalid code: "${item.code}"`);
        result.skipped.push(item.code ?? '(empty)');
        continue;
      }

      if (existingIds.has(code)) {
        try {
          await setAgentFileTransformByOSS(code, item.fileTransformByOSS === true);
        } catch (err) {
          logger.warn(
            `[sto-biz-agent] Failed to update fileTransformByOSS for existing agent ${code}: ${
              err instanceof Error ? err.message : String(err)
            }`,
          );
        }
        logger.info(`[sto-biz-agent] Skipping existing agent: ${code}`);
        result.skipped.push(code);
        continue;
      }

      try {
        await createAgentWithId(code, item.name, {
          inheritWorkspace: true,
          fileTransformByOSS: item.fileTransformByOSS === true,
        });
        result.created.push(code);
        existingIds.add(code);
        logger.info(`[sto-biz-agent] Created agent: id=${code}, name=${item.name}`);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        logger.warn(`[sto-biz-agent] Failed to create agent ${code}: ${message}`);
      }
    }

    // Step 5 — Post-creation housekeeping
    if (result.created.length > 0) {
      syncAllProviderAuthToRuntime().catch((err) => {
        logger.warn('[sto-biz-agent] Failed to sync provider auth after agent creation:', err);
      });

      if (this.gatewayManager) {
        this.gatewayManager.debouncedReload();
      }
    }

    logger.info(
      `[sto-biz-agent] Sync completed: created=${result.created.length}, skipped=${result.skipped.length}`,
    );
    return result;
  }

  private async fetchRemoteAgents(token: string): Promise<BizAgentItem[]> {
    const baseUrl = await resolveStoBaseUrl();
    const url = `${baseUrl}${BIZ_AGENT_API_PATH}`;
    logger.info(`[sto-biz-agent] Fetching department agents: url=${url}`);

    const response = await fetch(url, {
      headers: buildStoMemoryCenterAuthHeaders(token),
    });

    if (!response.ok) {
      throw new Error(
        `Biz-agent list request failed: ${response.status} ${response.statusText}`,
      );
    }

    const data = (await response.json()) as BizAgentItem[] | { data?: BizAgentItem[] };

    // Support both direct array and { data: [...] } wrapper
    if (Array.isArray(data)) {
      return data;
    }
    return data.data ?? [];
  }
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

let instance: StoBizAgentSyncService | null = null;

export function getStoBizAgentSyncService(): StoBizAgentSyncService {
  if (!instance) {
    instance = new StoBizAgentSyncService();
  }
  return instance;
}
