/**
 * After a scheduled-task trigger succeeds, persist the actual execution model
 * onto the dated UI session so the chat model selector can read it.
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { GatewayManager } from '../gateway/manager';
import { upsertEngineSessionRegistryEntry } from '../engines/session-registry';
import type { AgentEngineType } from '../engines/types';
import { listAgentsSnapshot, getAgentPreferredModel } from './agent-config';
import { setSessionModelViaGateway } from './openclaw-model';
import { getOpenClawConfigDir } from './paths';
import { logger } from './logger';
import type { ClaudeScheduledTaskDefinition } from '../services/claude-scheduled-task-store';

export interface SyncTaskExecutionModelResult {
  sessionKey: string;
  model: string;
  agentId: string;
  engineType: AgentEngineType;
}

function isUsableModelLabel(raw: string | undefined | null): raw is string {
  const trimmed = raw?.trim();
  if (!trimmed) return false;
  return trimmed.toLowerCase() !== 'not configured';
}

/** Resolve OpenClaw agent primary / display model from agents snapshot. */
export async function resolveOpenClawAgentModelLabel(agentId: string): Promise<string | undefined> {
  try {
    const snapshot = await listAgentsSnapshot();
    const agent = snapshot.agents.find((item) => item.id === agentId);
    if (isUsableModelLabel(agent?.modelDisplay)) {
      return agent.modelDisplay.trim();
    }
  } catch (err) {
    logger.warn(
      `[task-execution-session-model] resolveOpenClawAgentModelLabel failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  return undefined;
}

/** Read OpenClaw cron job payload.model + description agentId from jobs.json. */
export async function resolveOpenClawCronJobExecutionModel(jobId: string): Promise<{
  model?: string;
  agentId: string;
} | null> {
  const trimmedId = jobId.trim();
  if (!trimmedId) return null;
  try {
    const jobsFile = join(getOpenClawConfigDir(), 'cron', 'jobs.json');
    const raw = await readFile(jobsFile, 'utf8');
    const data = JSON.parse(raw) as {
      jobs?: Array<{
        id?: string;
        description?: string;
        payload?: { model?: string; message?: string; text?: string };
      }>;
    };
    const job = (data.jobs ?? []).find((item) => item.id === trimmedId);
    if (!job) return null;

    let agentId = 'main';
    if (typeof job.description === 'string' && job.description.trim()) {
      try {
        const meta = JSON.parse(job.description) as { agentId?: string };
        if (typeof meta.agentId === 'string' && meta.agentId.trim()) {
          agentId = meta.agentId.trim();
        }
      } catch {
        // ignore non-JSON description
      }
    }

    const payloadModel = typeof job.payload?.model === 'string' ? job.payload.model.trim() : '';
    if (payloadModel) {
      return { model: payloadModel, agentId };
    }

    const agentModel = await resolveOpenClawAgentModelLabel(agentId);
    return { model: agentModel, agentId };
  } catch (err) {
    logger.warn(
      `[task-execution-session-model] resolveOpenClawCronJobExecutionModel failed: ${err instanceof Error ? err.message : String(err)}`,
    );
    return null;
  }
}

/** Resolve the model Claude will launch with (definition → agent preferred). */
export async function resolveClaudeTaskExecutionModel(
  task: Pick<ClaudeScheduledTaskDefinition, 'model' | 'agentId' | 'providerAccountId'> | null | undefined,
): Promise<{ model?: string; agentId: string; accountId?: string }> {
  const agentId = task?.agentId?.trim() || 'main';
  if (isUsableModelLabel(task?.model)) {
    return {
      model: task!.model!.trim(),
      agentId,
      accountId: task?.providerAccountId?.trim() || undefined,
    };
  }
  try {
    const preferred = await getAgentPreferredModel(agentId);
    if (isUsableModelLabel(preferred.model)) {
      return {
        model: preferred.model!.trim(),
        agentId,
        accountId: preferred.accountId?.trim() || task?.providerAccountId?.trim() || undefined,
      };
    }
  } catch (err) {
    logger.warn(
      `[task-execution-session-model] resolveClaudeTaskExecutionModel failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  return { agentId, accountId: task?.providerAccountId?.trim() || undefined };
}

/**
 * Persist execution model for a dated task session.
 * Always writes engine registry; OpenClaw also best-effort Gateway sessions.patch.
 * Failures are logged and swallowed by callers that must not fail the trigger.
 */
export async function syncTaskExecutionModelToDatedSession(opts: {
  sessionKey: string;
  model: string;
  engineType: AgentEngineType;
  agentId: string;
  accountId?: string;
  gatewayManager?: GatewayManager;
}): Promise<SyncTaskExecutionModelResult | null> {
  const sessionKey = opts.sessionKey.trim();
  const model = opts.model.trim();
  const agentId = opts.agentId.trim() || 'main';
  if (!sessionKey || !model) return null;

  let persistedModel = model;

  try {
    await upsertEngineSessionRegistryEntry({
      sessionKey,
      engineType: opts.engineType,
      agentId,
      model: persistedModel,
      accountId: opts.accountId?.trim() || undefined,
      updatedAt: Date.now(),
    });
  } catch (err) {
    logger.warn(
      `[task-execution-session-model] registry upsert failed for ${sessionKey}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  if (opts.engineType === 'openclaw' && opts.gatewayManager) {
    try {
      const result = await setSessionModelViaGateway(opts.gatewayManager, {
        sessionKey,
        model: persistedModel,
        agentId,
      });
      if (result.ok) {
        persistedModel = (result.modelOverride || result.model || persistedModel).trim() || persistedModel;
        await upsertEngineSessionRegistryEntry({
          sessionKey,
          engineType: 'openclaw',
          agentId,
          model: persistedModel,
          accountId: opts.accountId?.trim() || undefined,
          updatedAt: Date.now(),
        }).catch(() => {});
      } else if (result.error) {
        logger.warn(
          `[task-execution-session-model] Gateway sessions.patch failed for ${sessionKey}: ${result.error}`,
        );
      }
    } catch (err) {
      logger.warn(
        `[task-execution-session-model] Gateway sessions.patch threw for ${sessionKey}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  return {
    sessionKey,
    model: persistedModel,
    agentId,
    engineType: opts.engineType,
  };
}
