import { useLayoutEffect } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { isStoTaskId, isYmdEntryId, taskOverviewPath, type StoTaskId } from '@/lib/sto-tasks';
import { stoChatShellPageClass } from '@/lib/surfaces';
import { cn } from '@/lib/utils';
import { useStoTaskSubitemsStore, stoTaskSubitemKey } from '@/stores/sto-task-subitems';
import { useContentHeader } from '@/components/layout/content-header-context';
import { useChatStore } from '@/stores/chat';
import { navigateToMainChatHome } from '@/lib/main-chat-navigation';

function TaskOverviewBody({ taskId }: { taskId: StoTaskId }) {
  const { t } = useTranslation('tasks');
  const p = `detail.${taskId}` as const;
  return (
    <>
      <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{t(`${p}.intro`)}</p>
      <p className="mt-6 text-sm text-muted-foreground">{t('overviewHint')}</p>
    </>
  );
}

/** 任务总览：标题走全局 ContentHeader，避免与页内 h1 重复 */
function TaskOverviewPage({ taskId }: { taskId: StoTaskId }) {
  const { t } = useTranslation('tasks');
  useContentHeader({ title: t(`detail.${taskId}.pageTitle`) });

  return (
    <div className={cn(stoChatShellPageClass, 'pb-10')}>
      <TaskOverviewBody taskId={taskId} />
    </div>
  );
}

/**
 * 旧 `/tasks/:id/:entryId` 深链：切到子项 session 后回首页对话（与侧栏定时任务一致）。
 */
function TaskSubitemRedirect({ id, entryId }: { id: StoTaskId; entryId: string }) {
  const navigate = useNavigate();

  useLayoutEffect(() => {
    useStoTaskSubitemsStore.getState().ensureSubitem(id, entryId);
    const sessionKey =
      useStoTaskSubitemsStore.getState().sessionKeyBySubitem[stoTaskSubitemKey(id, entryId)] ?? '';
    if (sessionKey) {
      navigateToMainChatHome(navigate, window.location.pathname, () => {
        useChatStore.getState().switchSession(sessionKey);
      });
    } else {
      navigate('/', { replace: true });
    }
  }, [id, entryId, navigate]);

  return null;
}

export function TaskDetail() {
  const { taskId, entryId } = useParams<{ taskId: string; entryId?: string }>();
  const listEntries = useStoTaskSubitemsStore((s) => s.listEntries);

  if (!taskId || !isStoTaskId(taskId)) {
    return <Navigate to="/" replace />;
  }

  const id = taskId;
  const entries = listEntries(id);

  if (entryId) {
    if (!isYmdEntryId(entryId) || !entries.includes(entryId)) {
      return <Navigate to={taskOverviewPath(id)} replace />;
    }
    useStoTaskSubitemsStore.getState().ensureSubitem(id, entryId);
    return <TaskSubitemRedirect id={id} entryId={entryId} />;
  }

  return <TaskOverviewPage taskId={id} />;
}
