import i18n from '@/i18n';
import {
  isClaudeScheduledTaskRunSessionKey,
  isClaudeScheduledTaskSessionKey,
  isAnyCronSessionKey,
  parseScheduledTaskAgentSessionKey,
} from '@/stores/chat/cron-session-utils';
import { isHiddenStoTaskSubitemChatSessionKey, isStoTaskSessionKey } from '@/lib/sto-task-session';
import { hostApiFetch } from '@/lib/host-api';
import { toast } from 'sonner';

export type SessionDeleteResult = {
  success: boolean;
  error?: string;
};

export type SessionDeleteEngineType = 'openclaw' | 'claude';

/** Route delete API to the backend that owns the session transcript. */
export function resolveSessionDeleteEngineType(
  sessionKey: string,
  session?: { engineType?: SessionDeleteEngineType },
  agentEngineType?: string | null,
): SessionDeleteEngineType {
  if (isAnyCronSessionKey(sessionKey)) return 'openclaw';
  if (parseScheduledTaskAgentSessionKey(sessionKey)) return 'openclaw';
  if (isStoTaskSessionKey(sessionKey) || isHiddenStoTaskSubitemChatSessionKey(sessionKey)) {
    return 'openclaw';
  }
  if (isClaudeScheduledTaskSessionKey(sessionKey) || isClaudeScheduledTaskRunSessionKey(sessionKey)) {
    return 'claude';
  }
  if (session?.engineType === 'claude' || session?.engineType === 'openclaw') {
    return session.engineType;
  }
  return agentEngineType === 'claude' ? 'claude' : 'openclaw';
}

export async function requestSessionDelete(
  sessionKey: string,
  engineType: SessionDeleteEngineType,
): Promise<SessionDeleteResult> {
  try {
    const result = await hostApiFetch<{ success?: boolean; error?: string }>('/api/sessions/delete', {
      method: 'POST',
      body: JSON.stringify({ sessionKey, engineType }),
    });
    if (result?.success === false) {
      return { success: false, error: result.error };
    }
    return { success: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: message };
  }
}

export function notifySessionDeleteFailed(error?: string): void {
  toast.error(i18n.t('common:sidebar.deleteSessionFailed'), {
    description: error?.trim() || i18n.t('common:sidebar.deleteSessionFailedHint'),
  });
}
