import type {
  BridgeAiMemoryMode,
  BridgeAiProfile,
  BridgeAiResponseFormat,
  ChatCompleteParams,
} from '../../../../shared/jsbridge/bridge-ai-protocol';
import { BRIDGE_AI_DEFAULT_QUOTA } from '../../../../shared/jsbridge/bridge-ai-protocol';

export interface ResolvedBridgeAiInvocationPlan {
  agentId: string;
  responseFormat: BridgeAiResponseFormat;
  memoryMode: BridgeAiMemoryMode;
  quota: { perMinute: number; concurrent: number };
  skillSlugs: string[];
  systemPrompt?: string;
  skipMemoryRead: boolean;
  skipMemoryWrite: boolean;
}

function normalizeSlugList(values: string[] | undefined): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values ?? []) {
    const slug = value.trim().toLowerCase();
    if (!slug || seen.has(slug)) continue;
    seen.add(slug);
    result.push(slug);
  }
  return result;
}

export function resolveBridgeAiQuota(profile: BridgeAiProfile): { perMinute: number; concurrent: number } {
  const perMinute = profile.quota?.perMinute ?? BRIDGE_AI_DEFAULT_QUOTA.perMinute;
  const concurrent = profile.quota?.concurrent ?? BRIDGE_AI_DEFAULT_QUOTA.concurrent;
  return {
    perMinute: Math.max(1, Math.floor(perMinute)),
    concurrent: Math.max(1, Math.floor(concurrent)),
  };
}

export function resolveBridgeAiMemoryMode(profile: BridgeAiProfile): BridgeAiMemoryMode {
  return profile.memory?.mode ?? 'none';
}

export function resolveBridgeAiMemoryPolicy(mode: BridgeAiMemoryMode): {
  skipMemoryRead: boolean;
  skipMemoryWrite: boolean;
} {
  switch (mode) {
    case 'user-read':
      return { skipMemoryRead: false, skipMemoryWrite: true };
    case 'app':
      // App-scoped memory storage is not wired yet; isolate from global user memory.
      return { skipMemoryRead: true, skipMemoryWrite: true };
    case 'none':
    default:
      return { skipMemoryRead: true, skipMemoryWrite: true };
  }
}

export function resolveBridgeAiSkillSlugs(
  profile: BridgeAiProfile,
  params: Pick<ChatCompleteParams, 'skillSlugs'>,
): string[] {
  const allowed = new Set(normalizeSlugList(profile.allowedSkillSlugs));
  const requested = normalizeSlugList(params.skillSlugs);
  const unauthorized = requested.filter((slug) => !allowed.has(slug));
  if (unauthorized.length > 0) {
    const error = new Error(`skill not allowed: ${unauthorized.join(', ')}`);
    throw Object.assign(error, { code: 'AI_SKILL_NOT_ALLOWED' });
  }
  return normalizeSlugList([
    ...(profile.skills ?? []),
    ...requested,
  ]);
}

export function appendBridgeAiSkillPrompt(
  systemPromptAppend: string | undefined,
  skillSlugs: string[],
): string | undefined {
  if (skillSlugs.length === 0) return systemPromptAppend;
  const block = [
    '## Skills',
    'The following skills are available for this invocation. Use Skill("<slug>") when a skill is relevant:',
    ...skillSlugs.map((slug) => `- ${slug}`),
  ].join('\n');
  return systemPromptAppend ? `${systemPromptAppend}\n\n${block}` : block;
}

export function resolveBridgeAiInvocationPlan(
  profile: BridgeAiProfile,
  params: ChatCompleteParams,
): ResolvedBridgeAiInvocationPlan {
  const memoryMode = resolveBridgeAiMemoryMode(profile);
  const memoryPolicy = resolveBridgeAiMemoryPolicy(memoryMode);
  return {
    agentId: params.agentId?.trim() || profile.agentId?.trim() || 'main',
    responseFormat: params.responseFormat ?? profile.responseFormat ?? 'text',
    memoryMode,
    quota: resolveBridgeAiQuota(profile),
    skillSlugs: resolveBridgeAiSkillSlugs(profile, params),
    systemPrompt: profile.systemPrompt,
    ...memoryPolicy,
  };
}
