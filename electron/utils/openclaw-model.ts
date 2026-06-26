import type { GatewayManager } from '../gateway/manager';
import { getOpenClawProviderKey } from '../services/providers/provider-runtime-sync';
import { getProviderAccount } from '../services/providers/provider-store';
import type { HostApiContext } from '../api/context';
import { listAgentsSnapshot, updateAgentModel } from './agent-config';

/** Normalize raw model id to OpenClaw qualified ref (e.g. sto/dashscope/qwen3.6-plus). */
export async function qualifyChatModelRef(
  rawModel: string,
  accountId?: string,
): Promise<string> {
  const trimmed = rawModel.trim();
  if (!trimmed) return trimmed;
  if (!accountId) return trimmed;
  const account = await getProviderAccount(accountId);
  if (!account) return trimmed;
  const providerKey = getOpenClawProviderKey(account.vendorId, account.id);
  if (trimmed.startsWith(`${providerKey}/`)) return trimmed;

  const customModels = (account.metadata?.customModels as string[] | undefined) ?? [];
  if (customModels.length > 0) {
    const bare = trimmed.includes('/')
      ? trimmed.slice(trimmed.lastIndexOf('/') + 1)
      : trimmed;
    const catalogMatch = customModels.find((catalogId) => {
      if (catalogId === trimmed) return true;
      const catalogBare = catalogId.includes('/')
        ? catalogId.slice(catalogId.lastIndexOf('/') + 1)
        : catalogId;
      return catalogBare === bare;
    });
    if (catalogMatch) {
      return `${providerKey}/${catalogMatch}`;
    }
  }

  if (trimmed.includes('/') && account.vendorId === 'sto') {
    return `${providerKey}/${trimmed}`;
  }

  return `${providerKey}/${trimmed}`;
}

export interface SessionModelOverrideResult {
  ok: boolean;
  model?: string;
  modelOverride?: string | null;
  changedModel?: boolean;
  error?: string;
}

function parseSessionModelFromToolOutput(output: unknown): SessionModelOverrideResult {
  if (!output || typeof output !== 'object') {
    return { ok: true };
  }
  const result = output as Record<string, unknown>;
  const details = (result.details && typeof result.details === 'object')
    ? result.details as Record<string, unknown>
    : result;
  const modelOverride = details.modelOverride;
  return {
    ok: details.ok !== false,
    model: typeof details.model === 'string' ? details.model : undefined,
    modelOverride: modelOverride === null || typeof modelOverride === 'string'
      ? modelOverride
      : undefined,
    changedModel: details.changedModel === true,
  };
}

function shouldRetryWithBareModel(model: string, error: string): boolean {
  return model.includes('/') && /model not allowed/i.test(error);
}

function toBareModel(model: string): string {
  const index = model.lastIndexOf('/');
  return index >= 0 ? model.slice(index + 1) : model;
}

/** Apply a per-session model override via Gateway sessions.patch (0322+) or tools.invoke fallback (5.22+). */
export async function setSessionModelViaGateway(
  gatewayManager: GatewayManager,
  opts: {
    sessionKey: string;
    model: string;
    agentId?: string;
  },
): Promise<SessionModelOverrideResult> {
  if (!gatewayManager.isConnected()) {
    return { ok: false, error: 'Gateway not connected' };
  }
  const status = gatewayManager.getStatus();
  if (status.state !== 'running') {
    return { ok: false, error: 'Gateway not running' };
  }

  const applyViaSessionsPatch = async (model: string): Promise<SessionModelOverrideResult> => {
    const patchResult = await gatewayManager.rpc<{
      ok?: boolean;
      key?: string;
      entry?: { modelOverride?: string | null; providerOverride?: string | null };
      resolved?: { model?: string; modelProvider?: string };
    }>('sessions.patch', {
      key: opts.sessionKey,
      model,
    });

    const provider = patchResult?.entry?.providerOverride ?? patchResult?.resolved?.modelProvider;
    const modelName = patchResult?.resolved?.model ?? patchResult?.entry?.modelOverride ?? model;
    const displayModel = provider && modelName && !modelName.includes('/')
      ? `${provider}/${modelName}`
      : modelName;

    return {
      ok: true,
      model: displayModel,
      modelOverride: patchResult?.entry?.modelOverride ?? displayModel,
      changedModel: true,
    };
  };

  // OpenClaw 0322: sessions.patch writes session store modelOverride (no Gateway restart).
  try {
    return await applyViaSessionsPatch(opts.model);
  } catch (patchErr) {
    const patchMessage = patchErr instanceof Error ? patchErr.message : String(patchErr);
    const patchUnsupported = /unknown method.*sessions\.patch/i.test(patchMessage);
    if (shouldRetryWithBareModel(opts.model, patchMessage)) {
      try {
        return await applyViaSessionsPatch(toBareModel(opts.model));
      } catch (retryErr) {
        const retryMessage = retryErr instanceof Error ? retryErr.message : String(retryErr);
        return { ok: false, error: retryMessage };
      }
    }
    if (!patchUnsupported) {
      return { ok: false, error: patchMessage };
    }
  }

  const invokeWithModel = async (model: string) => {
    return gatewayManager.rpc<{
      ok?: boolean;
      output?: unknown;
      error?: { message?: string };
    }>('tools.invoke', {
      name: 'session_status',
      args: {
        sessionKey: opts.sessionKey,
        model,
      },
      sessionKey: opts.sessionKey,
      ...(opts.agentId ? { agentId: opts.agentId } : {}),
    });
  };

  // OpenClaw 5.22+: session_status via tools.invoke
  let invokeResult = await invokeWithModel(opts.model);

  if (invokeResult?.ok === false) {
    const message = invokeResult.error?.message ?? 'tools.invoke failed';
    if (shouldRetryWithBareModel(opts.model, message)) {
      invokeResult = await invokeWithModel(toBareModel(opts.model));
      if (invokeResult?.ok === false) {
        return { ok: false, error: invokeResult.error?.message ?? 'tools.invoke failed' };
      }
      return parseSessionModelFromToolOutput(invokeResult?.output);
    }
    return { ok: false, error: message };
  }

  return parseSessionModelFromToolOutput(invokeResult?.output);
}

/** Persist agent default model; use agents.update when Gateway is live (no SIGUSR1). */
export async function applyAgentDefaultModel(
  ctx: HostApiContext,
  agentId: string,
  qualifiedModel: string,
) {
  const status = ctx.gatewayManager.getStatus();
  if (status.state === 'running' && ctx.gatewayManager.isConnected()) {
    await ctx.gatewayManager.rpc('agents.update', {
      agentId,
      model: qualifiedModel,
    });
    return await listAgentsSnapshot();
  }
  return await updateAgentModel(agentId, qualifiedModel);
}
