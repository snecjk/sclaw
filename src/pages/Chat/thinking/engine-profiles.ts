import type { RawMessage } from '@/stores/chat';
import { extractText } from '@/pages/Chat/message-utils';

/** OpenClaw / Claude 在思考过程解析上的结构差异（仅影响 parse，不碰 UI） */
export type EngineProfileName = 'openclaw' | 'claude';

export type EngineProfile = {
  name: EngineProfileName;
  /** 单 snapshot 内一批 tool 已进 currentGroup 后再遇 text → 立即 flush 成独立 phase-text（图二） */
  flushOnIntraSnapshotText: boolean;
  /** 流式 tool 先于 content block 到达时，补进 active timeline */
  useStreamingToolSupplement: boolean;
  /** 首批 tool 前的多条 text：按 tool 交错插入 vs 仅保留 opening + 队列 */
  preBatchTextStrategy: 'interleave' | 'opening-only';
};

export const OPENCLAW_ENGINE_PROFILE: EngineProfile = {
  name: 'openclaw',
  flushOnIntraSnapshotText: true,
  useStreamingToolSupplement: true,
  preBatchTextStrategy: 'opening-only',
};

export const CLAUDE_ENGINE_PROFILE: EngineProfile = {
  name: 'claude',
  flushOnIntraSnapshotText: false,
  useStreamingToolSupplement: true,
  preBatchTextStrategy: 'interleave',
};

const ENGINE_PROFILES: Record<EngineProfileName, EngineProfile> = {
  openclaw: OPENCLAW_ENGINE_PROFILE,
  claude: CLAUDE_ENGINE_PROFILE,
};

/**
 * Claude 常见形态：连续多条纯 text assistant 消息，再一次性吐 thinking/tool。
 * OpenClaw 常见形态：单条 snapshot 内 text/thinking/tool 混排。
 */
function inferEngineProfileFromMessages(messages: RawMessage[]): EngineProfile {
  let textOnlyAssistantStreak = 0;
  let hasMixedAssistantContent = false;

  for (const message of messages) {
    if (message.role !== 'assistant') continue;
    const blocks = message.content;
    if (!Array.isArray(blocks)) continue;

    const hasThinking = blocks.some((block) => (block as { type?: string }).type === 'thinking');
    const hasTool = blocks.some(
      (block) => {
        const type = (block as { type?: string }).type;
        return type === 'tool_use' || type === 'tool';
      },
    );
    const hasText = blocks.some((block) => (block as { type?: string }).type === 'text');

    if (hasThinking || hasTool) {
      if (hasText && (hasThinking || hasTool)) {
        hasMixedAssistantContent = true;
      }
      break;
    }

    if (hasText && extractText(message).trim().length > 0) {
      textOnlyAssistantStreak += 1;
    }
  }

  if (hasMixedAssistantContent || textOnlyAssistantStreak < 2) {
    return OPENCLAW_ENGINE_PROFILE;
  }
  return CLAUDE_ENGINE_PROFILE;
}

export function resolveEngineProfile(
  messages: RawMessage[],
  explicit?: EngineProfileName,
): EngineProfile {
  if (explicit) return ENGINE_PROFILES[explicit];
  return inferEngineProfileFromMessages(messages);
}
