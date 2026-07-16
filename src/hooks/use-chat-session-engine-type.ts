import { useMemo } from 'react';
import {
  resolveChatSessionEngineType,
  type ChatEngineType,
} from '@/lib/resolve-chat-session-engine-type';
import { useChatStore } from '@/stores/chat';
import { resolveAgentById, useAgentsStore } from '@/stores/agents';

/**
 * 当前会话真实引擎类型（session.engineType > session key 前缀 > agent 默认）。
 * 思考过程解析必须用它覆盖消息形态推断，否则 Claude 混排 snapshot 会被误判为 OpenClaw。
 */
export function useChatSessionEngineType(): ChatEngineType {
  const currentSessionKey = useChatStore((s) => s.currentSessionKey);
  const currentAgentId = useChatStore((s) => s.currentAgentId);
  const sessions = useChatStore((s) => s.sessions);
  const messagesLength = useChatStore((s) => s.messages.length);
  const agents = useAgentsStore((s) => s.agents);

  return useMemo(() => {
    const session = sessions.find((item) => item.key === currentSessionKey);
    const agent = resolveAgentById(agents, currentAgentId);
    return resolveChatSessionEngineType(session, agent?.engineType, currentSessionKey, {
      messageCount: messagesLength,
    });
  }, [sessions, currentSessionKey, agents, currentAgentId, messagesLength]);
}
