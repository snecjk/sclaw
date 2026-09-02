import type { ChatSession } from '@/stores/chat/types';

const APP_DEV_SESSION_SEGMENT = ':appdev:';

export function isAppDevSessionKey(sessionKey: string | null | undefined): boolean {
  const key = (sessionKey ?? '').trim();
  return key.startsWith('agent:') && key.includes(APP_DEV_SESSION_SEGMENT);
}

export function buildAppDevSessionKey(agentId: string, workspaceId: string): string {
  const normalizedAgentId = agentId.trim() || 'main';
  const normalizedWorkspaceId = workspaceId.trim();
  if (!normalizedWorkspaceId) throw new Error('workspaceId 不能为空');
  return `agent:${normalizedAgentId}:appdev:${normalizedWorkspaceId}`;
}

export function getWorkspaceIdFromAppDevSessionKey(sessionKey: string): string | null {
  if (!isAppDevSessionKey(sessionKey)) return null;
  const parts = sessionKey.split(':');
  return parts[3]?.trim() || null;
}

export function ensureAppDevSessionEntry(input: {
  sessions: ChatSession[];
  sessionKey: string;
  engineType?: ChatSession['engineType'];
  model?: string;
  agentId?: string;
  label?: string;
}): ChatSession[] {
  const {
    sessions,
    sessionKey,
    engineType,
    model,
    agentId,
    label = '建站会话',
  } = input;
  const existing = sessions.find((session) => session.key === sessionKey);
  if (existing) {
    return sessions.map((session) => (
      session.key === sessionKey
        ? {
          ...session,
          engineType: engineType ?? session.engineType,
          model: model ?? session.model,
          agentId: agentId ?? session.agentId,
          label: session.label ?? label,
        }
        : session
    ));
  }
  return [
    ...sessions,
    {
      key: sessionKey,
      label,
      engineType,
      model,
      agentId,
    },
  ];
}
