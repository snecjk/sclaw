import type { GatewayManager } from '../gateway/manager';
import type { AgentEngineType, EnginePermissionProfile } from '../engines/types';
import { getAdapterForSession } from '../engines/manager';
import type { ChatRuntimePolicy } from '../../shared/chat-runtime-protocol';
import type { ModelMessageCompositionV1 } from '../../shared/model-message-composition';
import type { DingTalkMention } from '../../shared/dingtalk-send/dingtalk-mention';
import { listAgentsSnapshot } from '../utils/agent-config';
import { uploadFileToTempOSS } from '../utils/oss-temp-upload';
import { runMainChatSend } from './chat-send-service';
import {
  normalizeModelMessage,
  toEngineMedia,
  type ModelMessageMediaInput,
} from './model-message-normalizer';
import {
  clearOpenClawPendingTurnMetadata,
  setOpenClawPendingTurnMetadata,
} from './openclaw-turn-metadata';
import { logger } from '../utils/logger';

export interface SubmitModelTurnInput {
  sessionKey: string;
  message: string;
  sourceText?: string;
  deliver?: boolean;
  idempotencyKey: string;
  systemPromptAppend?: string;
  engineType?: AgentEngineType;
  media?: ModelMessageMediaInput[];
  composition?: ModelMessageCompositionV1;
  runtimePolicy?: ChatRuntimePolicy;
  permissionProfile?: EnginePermissionProfile;
  dingTalkMentions?: DingTalkMention[];
  memoryPolicy?: { skipRead?: boolean; skipWrite?: boolean };
  internal?: boolean;
}

function parseEngineType(value: unknown): AgentEngineType | undefined {
  return value === 'claude' || value === 'openclaw' || value === 'pi' ? value : undefined;
}

function agentIdFromSessionKey(sessionKey: string): string {
  if (sessionKey.startsWith('pi:')) return (sessionKey.split(':')[1] || 'main').trim().toLowerCase();
  if (!sessionKey.startsWith('agent:')) return 'main';
  return (sessionKey.split(':')[1] || 'main').trim().toLowerCase();
}

async function shouldTransformByOss(sessionKey: string): Promise<boolean> {
  const snapshot = await listAgentsSnapshot();
  const agentId = agentIdFromSessionKey(sessionKey);
  return snapshot.agents.some((agent) => (
    agent.id.trim().toLowerCase() === agentId && agent.fileTransformByOSS === true
  ));
}

export async function submitModelTurn(
  gatewayManager: GatewayManager,
  input: SubmitModelTurnInput,
) {
  const adapter = await getAdapterForSession(input.sessionKey, parseEngineType(input.engineType));
  const normalizedTurn = await normalizeModelMessage({
    message: input.message,
    composition: input.composition,
    media: input.media,
  });
  if (input.dingTalkMentions?.length) {
    normalizedTurn.hostMetadata = { dingTalkMentions: input.dingTalkMentions };
  }
  const media = normalizedTurn.legacy ? input.media : toEngineMedia(normalizedTurn);
  const context = { gatewayManager };

  logger.info('[model-message] dispatch', {
    sessionKey: input.sessionKey,
    idempotencyKey: input.idempotencyKey,
    engineType: adapter.type,
    legacy: normalizedTurn.legacy,
    canonicalModelChars: normalizedTurn.modelText.length,
    attachmentCount: normalizedTurn.attachments.length,
    selectedSkillSlugs: normalizedTurn.selectedSkillSlugs,
    workflowCount: normalizedTurn.workflows.length,
    mentions: (input.dingTalkMentions ?? []).map((mention) => ({
      type: mention.type,
      displayName: mention.displayName,
      resolved: mention.type === 'user'
        ? Boolean(mention.userId?.trim())
        : Boolean(mention.openConversationId?.trim()),
    })),
  });

  return runMainChatSend(gatewayManager, {
    sessionKey: input.sessionKey,
    message: normalizedTurn.modelText,
    sourceText: normalizedTurn.sourceText || input.sourceText,
    displayText: normalizedTurn.displayText || input.sourceText,
    deliver: input.deliver,
    idempotencyKey: input.idempotencyKey,
    systemPromptAppend: input.systemPromptAppend,
    runtimePolicy: input.runtimePolicy,
    permissionProfile: input.permissionProfile,
    engineType: adapter.type,
    normalizedTurn: input.internal ? undefined : normalizedTurn,
    media,
    memoryPolicy: input.memoryPolicy,
  }, (params, memory) => adapter.prepareMemoryInjection(params, memory), async (prepared) => {
    const selectedSkillSlugs = normalizedTurn.selectedSkillSlugs;
    if (adapter.type === 'openclaw' && selectedSkillSlugs.length) {
      await setOpenClawPendingTurnMetadata({
        sessionKey: input.sessionKey,
        idempotencyKey: input.idempotencyKey,
        selectedSkillSlugs,
        createdAt: new Date().toISOString(),
      });
    }
    try {
      if (!media?.length) return adapter.sendMessage(context, prepared);
      if (adapter.type !== 'openclaw' || !(await shouldTransformByOss(input.sessionKey))) {
        return adapter.sendMessageWithMedia(context, { ...prepared, media });
      }
      const references: string[] = [];
      for (const attachment of media) {
        const url = await uploadFileToTempOSS(attachment.filePath, attachment.fileName, { bizTypeEnum: 'LLM' });
        references.push(`[media attached: ${url} (${attachment.mimeType}) | ${url}]`);
      }
      return adapter.sendMessage(context, {
        ...prepared,
        message: [prepared.message, ...references].filter(Boolean).join('\n'),
      });
    } finally {
      if (adapter.type === 'openclaw' && selectedSkillSlugs.length) {
        await clearOpenClawPendingTurnMetadata(input.sessionKey, input.idempotencyKey);
      }
    }
  });
}
