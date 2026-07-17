import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { isHiddenStoTaskSubitemChatSessionKey } from '@/lib/sto-task-session';
import {
  STO_TASK_PENDING_COMPOSE_KEY,
  consumeStoTaskSubitemScrollEndIntent,
} from '@/lib/sto-task-compose-storage';
import { formatMaterialDateFromEntryId } from '@/lib/sto-task-entry-label';
import { resolveSubitemFromSessionKey } from '@/lib/sto-task-subitem-resolve';
import { useChatStore } from '@/stores/chat';
import { useStoTaskSubitemsStore } from '@/stores/sto-task-subitems';
import type { FileAttachment } from '@/pages/Chat/ChatInput';
import type { DingTalkMention } from '@/types/dingtalk-mention';

export interface UseStoTaskSubitemEntryOptions {
  scrollToLatest: (behavior?: ScrollBehavior) => void;
  onSend?: (
    text: string,
    attachments?: FileAttachment[],
    targetAgentId?: string | null,
    dingTalkMentions?: DingTalkMention[],
    workflowId?: string | null,
  ) => void | Promise<void>;
}

/**
 * 内置 STO 任务子项在首页对话区的专属行为：auto-send、复用滚底、已读同步、会话标题。
 * 从 TaskSubitemChatSurface 迁移，功能不变。
 */
export function useStoTaskSubitemEntry({
  scrollToLatest,
  onSend,
}: UseStoTaskSubitemEntryOptions) {
  const { t, i18n } = useTranslation(['home', 'tasks']);
  const currentSessionKey = useChatStore((s) => s.currentSessionKey);
  const loading = useChatStore((s) => s.loading);
  const sessionKeyBySubitem = useStoTaskSubitemsStore((s) => s.sessionKeyBySubitem);
  const markSubitemReadFromActivity = useStoTaskSubitemsStore((s) => s.markSubitemReadFromActivity);
  const activityForSession = useChatStore((s) => s.sessionLastActivity[currentSessionKey] ?? 0);

  const subitemRef = resolveSubitemFromSessionKey(currentSessionKey, sessionKeyBySubitem);
  const isStoSubitemSession =
    subitemRef !== null && isHiddenStoTaskSubitemChatSessionKey(currentSessionKey);
  // 依赖数组用 primitive，避免 resolveSubitemFromSessionKey 每帧返回新对象触发 effect 死循环
  const subitemKey = subitemRef?.subitemKey ?? null;
  const subitemTaskId = subitemRef?.taskId ?? null;
  const subitemEntryId = subitemRef?.entryId ?? null;

  const [composeSeed, setComposeSeed] = useState<string | undefined>();
  const [pendingAutoSendText, setPendingAutoSendText] = useState<string | null>(null);

  const hasOneShotComposeRef = useRef(false);
  const genericScrollDoneRef = useRef('');
  const lastMarkedActivityRef = useRef(0);
  const lastComposeSubitemKeyRef = useRef('');

  useEffect(() => {
    lastMarkedActivityRef.current = 0;
  }, [currentSessionKey]);

  useLayoutEffect(() => {
    if (!isStoSubitemSession || !subitemEntryId) return;

    const materialTitle = t('tasks:sidebarMaterialTitle', {
      date: formatMaterialDateFromEntryId(subitemEntryId, i18n.language),
    });
    const chat = useChatStore.getState();
    const existingSession = chat.sessions.find((session) => session.key === currentSessionKey);
    const currentLabel =
      chat.sessionLabels[currentSessionKey] ?? existingSession?.label ?? '';

    if (!existingSession) {
      useChatStore.setState((state) => ({
        sessions: [...state.sessions, { key: currentSessionKey, label: materialTitle }],
      }));
      return;
    }

    // 标题未变时不 rename，避免 setState → 重渲染 → effect 再跑的死循环
    if (currentLabel !== materialTitle) {
      chat.renameSession(currentSessionKey, materialTitle);
    }
  }, [isStoSubitemSession, subitemEntryId, currentSessionKey, t, i18n.language]);

  useLayoutEffect(() => {
    if (!isStoSubitemSession || !subitemKey || !subitemTaskId || !subitemEntryId) return;

    if (lastComposeSubitemKeyRef.current !== subitemKey) {
      lastComposeSubitemKeyRef.current = subitemKey;
      hasOneShotComposeRef.current = false;
      setComposeSeed(undefined);
      setPendingAutoSendText(null);
      genericScrollDoneRef.current = '';
    }

    try {
      const raw = sessionStorage.getItem(STO_TASK_PENDING_COMPOSE_KEY);
      if (!raw) return;
      const o = JSON.parse(raw) as { taskId?: string; entryId?: string; cardBase?: string };
      if (o.taskId !== subitemTaskId || o.entryId !== subitemEntryId || !o.cardBase) return;
      sessionStorage.removeItem(STO_TASK_PENDING_COMPOSE_KEY);
      const prompt = t(`home:summary.${o.cardBase}.defaultComposePrompt`);
      hasOneShotComposeRef.current = true;
      setComposeSeed(prompt);
      setPendingAutoSendText(prompt);
    } catch {
      sessionStorage.removeItem(STO_TASK_PENDING_COMPOSE_KEY);
    }
  }, [isStoSubitemSession, subitemKey, subitemTaskId, subitemEntryId, t]);

  useEffect(() => {
    if (!isStoSubitemSession || !subitemKey || !subitemTaskId || !subitemEntryId || loading) {
      return;
    }

    if (consumeStoTaskSubitemScrollEndIntent(subitemTaskId, subitemEntryId)) {
      scrollToLatest('auto');
      genericScrollDoneRef.current = subitemKey;
      return;
    }
    if (hasOneShotComposeRef.current) {
      genericScrollDoneRef.current = subitemKey;
      return;
    }
    if (genericScrollDoneRef.current === subitemKey) return;
    genericScrollDoneRef.current = subitemKey;
    scrollToLatest('auto');
  }, [
    isStoSubitemSession,
    subitemKey,
    subitemTaskId,
    subitemEntryId,
    loading,
    scrollToLatest,
  ]);

  useEffect(() => {
    if (pendingAutoSendText === null || !onSend) return;
    const text = pendingAutoSendText;
    setPendingAutoSendText(null);
    scrollToLatest('auto');
    void Promise.resolve(onSend(text)).finally(() => {
      setComposeSeed(undefined);
    });
  }, [pendingAutoSendText, onSend, scrollToLatest]);

  useEffect(() => {
    if (!isStoSubitemSession || !subitemTaskId || !subitemEntryId) return;
    if (activityForSession <= 0) return;
    if (activityForSession <= lastMarkedActivityRef.current) return;
    lastMarkedActivityRef.current = activityForSession;
    markSubitemReadFromActivity(subitemTaskId, subitemEntryId, activityForSession);
  }, [
    isStoSubitemSession,
    subitemTaskId,
    subitemEntryId,
    activityForSession,
    markSubitemReadFromActivity,
  ]);

  return {
    composeSeed,
    isStoSubitemSession,
  };
}
