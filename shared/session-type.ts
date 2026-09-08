/**
 * Shared session classification utilities.
 *
 * Used by both the main process (SQLite catalog) and the renderer (UI grouping)
 * so session type / task / app metadata is inferred consistently from the
 * session key.
 */

import { BRIDGE_AI_SESSION_CATEGORY } from './bridge-ai-session';

export type CatalogSessionType =
  | 'chat'
  | 'cron'
  | 'scheduled_task'
  | 'claude_task'
  | 'app'
  | 'channel'
  | 'workflow'
  | 'bridge_ai';

export interface InferredSessionCatalogMeta {
  sessionType: CatalogSessionType;
  taskId: string | null;
  appId: string | null;
}

const APP_SESSION_PREFIX = 'session-embed-app-';
const LEGACY_EMBED_RUNTIME_SESSION_PREFIX = 'session-embed-br-';
const APP_CONV_SEPARATOR = '--';

/** Chrome Side Panel ↔ local SClaw agent. Distinct from `agent:main:main`. */
export const WEB_BRIDGE_CHAT_SESSION_KEY = 'agent:main:web-bridge';

export function isWebBridgeChatSessionKey(sessionKey: string): boolean {
  return sessionKey.trim() === WEB_BRIDGE_CHAT_SESSION_KEY;
}

/** App Plaza / embed-browser chat sessions (not workflow or channel). */
export function isEmbedAppChatSessionKey(sessionKey: string): boolean {
  const trimmed = sessionKey.trim();
  return trimmed.includes(APP_SESSION_PREFIX) || trimmed.includes(LEGACY_EMBED_RUNTIME_SESSION_PREFIX);
}

/**
 * Infer catalog metadata from the session key.
 *
 * Current conventions:
 *   - agent:{agentId}:cron:{jobId}...                         -> cron
 *   - agent:{agentId}:scheduled-task:{taskId}:{date}          -> scheduled_task
 *   - scheduled-task:{taskId}                                 -> scheduled_task
 *   - claude-task:{taskId}... / claude-task-run:{taskId}...   -> claude_task
 *   - agent:{agentId}:bridge-ai:{appId}:{conversationId}      -> bridge_ai
 *   - agent:{agentId}:session-embed-app-{appId}[--{conv}]     -> app
 *   - everything else                                         -> chat
 *
 * Channel sessions (dingtalk / wechat / …) are NOT inferred here.
 * Catalog docs require the channel create entry to pass
 * `sessionType: 'channel'` + channelType/channelId via upsertCatalogSession.
 */
export function inferSessionCatalogMeta(sessionKey: string): InferredSessionMeta {
  const trimmedKey = sessionKey.trim();

  // Cron: agent:{agentId}:cron:{jobId}[:...]
  if (trimmedKey.startsWith('agent:')) {
    const parts = trimmedKey.split(':');
    if (parts.length >= 4) {
      if (parts[2] === 'cron') {
        return {
          sessionType: 'cron',
          taskId: parts[3] || null,
          appId: null,
        };
      }
      if (parts[2] === 'scheduled-task') {
        return {
          sessionType: 'scheduled_task',
          taskId: parts[3] || null,
          appId: null,
        };
      }
      // Bridge AI: agent:{agentId}:bridge-ai:{appId}:{conversationId}
      if (parts[2] === BRIDGE_AI_SESSION_CATEGORY && parts.length >= 5) {
        return {
          sessionType: 'bridge_ai',
          taskId: null,
          appId: parts[3] || null,
        };
      }
    }
    if (parts.length >= 3 && parts[2].startsWith(APP_SESSION_PREFIX)) {
      const rest = parts[2].slice(APP_SESSION_PREFIX.length);
      const appId = rest.split(APP_CONV_SEPARATOR)[0] || null;
      return {
        sessionType: 'app',
        taskId: null,
        appId,
      };
    }
  }

  // Scheduled task summary key.
  if (trimmedKey.startsWith('scheduled-task:')) {
    const taskId = trimmedKey.slice('scheduled-task:'.length).split(':')[0] || null;
    return {
      sessionType: 'scheduled_task',
      taskId,
      appId: null,
    };
  }

  // Claude scheduled task keys.
  if (trimmedKey.startsWith('claude-task') || trimmedKey.startsWith('claude-task-run:')) {
    const taskId = trimmedKey.split(':')[1] || null;
    return {
      sessionType: 'claude_task',
      taskId,
      appId: null,
    };
  }

  if (trimmedKey.startsWith('pi-task:')) {
    return {
      sessionType: 'scheduled_task',
      taskId: trimmedKey.split(':')[1] || null,
      appId: null,
    };
  }

  return {
    sessionType: 'chat',
    taskId: null,
    appId: null,
  };
}

// Backwards-compatible alias for consumers that expect the old name.
export type InferredSessionMeta = InferredSessionCatalogMeta;
