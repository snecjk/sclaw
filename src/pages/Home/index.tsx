import { useEffect, useRef, useCallback } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { HomeAgentHubSurface } from './HomeAgentHubSurface';
import { HomeHero } from './HomeHero';
import { HomeSummaryCards } from './HomeSummaryCards';
import { HomeAssistant } from './HomeAssistant';
import { HomeMainConversation } from './HomeMainConversation';
import { useHomeConversationActive } from './use-home-conversation-active';
import { useAuthStore } from '@/stores/auth';
import { useChatStore } from '@/stores/chat';
import { useGatewayStore } from '@/stores/gateway';
import { useScheduledTasksStore } from '@/stores/scheduledTasks';
import { createAutoSendWatcher } from '@/stores/message-queue';
import { useHomeChatEntrySend } from './use-home-chat-entry-send';
import { useScheduledTaskToolListener } from '@/hooks/use-scheduled-task-tool-listener';
import { TaskCreateModal } from '@/pages/ScheduledTasks/components/TaskCreateModal';
import type { TaskCreateInputWithRun } from '@/pages/ScheduledTasks/components/TaskCreateModal';

/**
 * 首页：有 CRM 周报权限时为 Hero + 任务卡片 + 底部助手；无权限时为 Hero + 能力卡片 + 底部输入。
 */
export function Home() {
  const crmWeekReportSurfaceAllowed = useAuthStore((s) => s.crmWeekReportSurfaceAllowed);
  const showConversation = useHomeConversationActive();
  const cleanupEmptySession = useChatStore((s) => s.cleanupEmptySession);
  const navigate = useNavigate();
  const createTask = useScheduledTasksStore((s) => s.createTask);
  const fetchTasks = useScheduledTasksStore((s) => s.fetchTasks);

  const {
    nlModalOpen,
    nlInitialValues,
    closeNlModal,
  } = useScheduledTaskToolListener();

  const handleNlSave = useCallback(
    async (input: TaskCreateInputWithRun) => {
      try {
        const task = await createTask({
          name: input.name,
          cronExpr: input.schedule,
          description: input.message,
        });
        toast.success(`任务"${task.name}"已创建`);
        await fetchTasks().catch(() => {});
        navigate('/scheduled-tasks');
        closeNlModal();
      } catch (err) {
        const message = String(err);
        toast.error(`创建失败：${message}`);
        throw err;
      }
    },
    [createTask, fetchTasks, navigate, closeNlModal],
  );

  useEffect(() => {
    const unsub = createAutoSendWatcher();
    return unsub;
  }, []);

  useEffect(() => () => { cleanupEmptySession(); }, [cleanupEmptySession]);

  // Handle skill-plaza "Use" navigation with ?q= prompt
  const [searchParams, setSearchParams] = useSearchParams();
  const seedText = searchParams.get('q')
    ? decodeURIComponent(searchParams.get('q')!)
    : undefined;
  const { handleHubSend } = useHomeChatEntrySend();
  const gatewayStatus = useGatewayStore((s) => s.status);
  const hasAutoSentRef = useRef(false);

  useEffect(() => {
    if (!seedText || hasAutoSentRef.current) return;
    if (gatewayStatus.state !== 'running') return;

    hasAutoSentRef.current = true;
    // Clear q from URL so refresh doesn't re-trigger
    setSearchParams({}, { replace: true });
    handleHubSend(seedText);
  }, [seedText, gatewayStatus.state, handleHubSend, setSearchParams]);

  if (!crmWeekReportSurfaceAllowed) {
    return (
      <>
        <div className="mx-auto flex h-full max-h-full min-h-0 w-full flex-1 flex-col overflow-hidden px-1 pt-2 sm:px-2">
          <HomeAgentHubSurface seedText={seedText} />
        </div>
        <TaskCreateModal
          open={nlModalOpen}
          onClose={closeNlModal}
          onSave={handleNlSave}
          initialValues={nlInitialValues}
        />
      </>
    );
  }

  return (
    <>
      <div className="mx-auto flex h-full min-h-0 w-full flex-1 flex-col">
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          {showConversation ? (
            <HomeMainConversation className="min-h-0 flex-1" />
          ) : (
            <div className="flex min-h-0 flex-1 flex-col justify-center gap-8 overflow-y-auto py-6 md:gap-10">
              <HomeHero />
              <HomeSummaryCards />
            </div>
          )}
        </div>
        <div className="sticky z-10 shrink-0 bg-[var(--sto-page-bg)] pt-6 dark:bg-background">
          <HomeAssistant seedText={seedText} onSend={handleHubSend} />
        </div>
      </div>
      <TaskCreateModal
        open={nlModalOpen}
        onClose={closeNlModal}
        onSave={handleNlSave}
        initialValues={nlInitialValues}
      />
    </>
  );
}
