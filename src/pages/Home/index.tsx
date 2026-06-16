import { useEffect, useRef, useCallback, useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { HomeAgentHubSurface } from './HomeAgentHubSurface';
import { HomeSiteSurface } from './HomeSiteSurface';
import { HomeHero } from './HomeHero';
import { HomeSummaryCards } from './HomeSummaryCards';
import { HomeAssistant } from './HomeAssistant';
import { HomeMainConversation } from './HomeMainConversation';
import { useHomeConversationActive } from './use-home-conversation-active';
import { useAuthStore, isSiteUser } from '@/stores/auth';
import { useChatStore } from '@/stores/chat';
import { useGatewayStore } from '@/stores/gateway';
import { useScheduledTasksStore } from '@/stores/scheduledTasks';
import { createAutoSendWatcher } from '@/stores/message-queue';
import { useHomeChatEntrySend } from './use-home-chat-entry-send';
import { useBuiltinToolListener } from '@/hooks/use-builtin-tool-listener';
import { TaskCreateModal } from '@/pages/ScheduledTasks/components/TaskCreateModal';
import type { TaskCreateInputWithRun } from '@/pages/ScheduledTasks/components/TaskCreateModal';

/**
 * 首页：网点用户为工作流引导卡片；省区白名单用户为经营管理任务卡片；其余为非网点 Agent Hub。
 */
export function Home() {
  const user = useAuthStore((s) => s.user);
  const isSite = isSiteUser(user?.categoryCode);
  const crmWeekReportSurfaceAllowed = useAuthStore((s) => s.crmWeekReportSurfaceAllowed);
  const showConversation = useHomeConversationActive();
  const cleanupEmptySession = useChatStore((s) => s.cleanupEmptySession);
  const navigate = useNavigate();
  const createTask = useScheduledTasksStore((s) => s.createTask);
  const fetchTasks = useScheduledTasksStore((s) => s.fetchTasks);

  const [nlModalOpen, setNlModalOpen] = useState(false);
  const [nlInitialValues, setNlInitialValues] = useState<import('@/hooks/use-scheduled-task-tool-listener').NlExtractedValues>({});
  const closeNlModal = useCallback(() => {
    setNlModalOpen(false);
    setNlInitialValues({});
  }, []);

  useBuiltinToolListener({
    onScheduledTaskConfirmation: (values) => {
      setNlInitialValues(values);
      setNlModalOpen(true);
    },
  });

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

  // Handle skill-plaza "Use" navigation with ?q= prompt and ?workflowId= template pick
  const [searchParams, setSearchParams] = useSearchParams();
  // searchParams.get() is already percent-decoded; decodeURIComponent again throws
  // URIError when the prompt contains a literal '%' (e.g. "完成率50%").
  const seedText = searchParams.get('q')?.trim() || undefined;
  const seedWorkflowId = searchParams.get('workflowId')?.trim() || undefined;
  const { handleHubSend } = useHomeChatEntrySend();
  const gatewayStatus = useGatewayStore((s) => s.status);
  const hasAutoSentRef = useRef(false);

  useEffect(() => {
    if (!seedText || hasAutoSentRef.current) return;
    if (gatewayStatus.state !== 'running') return;

    hasAutoSentRef.current = true;
    // Clear q and workflowId from URL so refresh doesn't re-trigger
    setSearchParams({}, { replace: true });
    handleHubSend(seedText, undefined, undefined, undefined, seedWorkflowId);
  }, [seedText, seedWorkflowId, gatewayStatus.state, handleHubSend, setSearchParams]);

  if (isSite) {
    return (
      <>
        <HomeSiteSurface seedText={seedText} />
        <TaskCreateModal
          open={nlModalOpen}
          onClose={closeNlModal}
          onSave={handleNlSave}
          initialValues={nlInitialValues}
        />
      </>
    );
  }

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
