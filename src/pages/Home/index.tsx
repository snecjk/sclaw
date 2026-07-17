import { useEffect, useRef, useCallback, useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { HomeAgentHubSurface } from './HomeAgentHubSurface';
import { HomeSiteSurface } from './HomeSiteSurface';
import { HomeHero } from './HomeHero';
import { HomeSummaryCards } from './HomeSummaryCards';
import { HomeComposer } from './HomeComposer';
import { HomeMainConversation } from './HomeMainConversation';
import { homeHubFooterShellClass, homeHubMainScrollClass, homeHubMainScrollHostClass } from './home-hub-surface-styles';
import { useHomeConversationActive } from './use-home-conversation-active';
import { useAuthStore, isSiteUser } from '@/stores/auth';
import { useChatStore } from '@/stores/chat';
import { useGatewayStore } from '@/stores/gateway';
import { useScheduledTasksStore } from '@/stores/scheduledTasks';
import { createAutoSendWatcher } from '@/stores/message-queue';
import { cn } from '@/lib/utils';
import { useSplitGridPassthroughClass } from '@/hooks/use-split-grid-passthrough-class';
import { useHomeChatEntrySend } from './use-home-chat-entry-send';
import { useBuiltinToolListener } from '@/hooks/use-builtin-tool-listener';
import { TaskCreateModal } from '@/pages/ScheduledTasks/components/TaskCreateModal';
import type { TaskCreateInputWithRun } from '@/pages/ScheduledTasks/components/TaskCreateModal';

/**
 * 首页：网点用户为工作流引导卡片；省区白名单用户为经营管理任务卡片；其余为非网点 Agent Hub。
 */
export function Home() {
  const user = useAuthStore((s) => s.user);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const siteDepartmentTypes = useAuthStore((s) => s.siteDepartmentTypes);
  const isSite =
    siteDepartmentTypes !== null && isSiteUser(user?.categoryCode);
  const crmWeekReportSurfaceAllowed = useAuthStore((s) => s.crmWeekReportSurfaceAllowed);
  const showConversation = useHomeConversationActive();
  const { isSplitGridPassthrough, splitGridPassthroughClass } =
    useSplitGridPassthroughClass(showConversation);
  const cleanupEmptySession = useChatStore((s) => s.cleanupEmptySession);
  const navigate = useNavigate();
  const createTask = useScheduledTasksStore((s) => s.createTask);
  const fetchTasks = useScheduledTasksStore((s) => s.fetchTasks);

  const [nlModalOpen, setNlModalOpen] = useState(false);
  const [nlInitialValues, setNlInitialValues] = useState<
    import('@/hooks/use-scheduled-task-tool-listener').NlExtractedValues
  >({});
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
    [createTask, fetchTasks, navigate, closeNlModal]
  );

  useEffect(() => {
    const unsub = createAutoSendWatcher();
    return unsub;
  }, []);

  useEffect(
    () => () => {
      cleanupEmptySession();
    },
    [cleanupEmptySession]
  );

  // Handle skill-plaza "Use" (?skill=) and legacy ?q= / ?workflowId= deep links
  const [searchParams, setSearchParams] = useSearchParams();
  const seedSkillSlug = searchParams.get('skill')?.trim() || undefined;
  // searchParams.get() is already percent-decoded; decodeURIComponent again throws
  // URIError when the prompt contains a literal '%' (e.g. "完成率50%").
  const querySeedText = searchParams.get('q')?.trim() || undefined;
  const seedWorkflowId = searchParams.get('workflowId')?.trim() || undefined;
  const { handleHubSend } = useHomeChatEntrySend();
  const gatewayStatus = useGatewayStore((s) => s.status);
  const hasAutoSentRef = useRef(false);

  useEffect(() => {
    if (!seedSkillSlug) return;
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.delete('skill');
      return next;
    }, { replace: true });
  }, [seedSkillSlug, setSearchParams]);

  // Deep-link handoff for `?q=` (workflow「立即运行」/官方安装等).
  // Skills use `?skill=` only and must not block this path — a prior merge
  // incorrectly required sticky initialSkillSlug, which dropped pure-q run-now.
  useEffect(() => {
    if (!querySeedText || hasAutoSentRef.current) return;
    if (gatewayStatus.state !== 'running') return;

    hasAutoSentRef.current = true;
    // Clear q and workflowId from URL so refresh doesn't re-trigger
    setSearchParams({}, { replace: true });
    handleHubSend(querySeedText, undefined, undefined, undefined, seedWorkflowId);
  }, [querySeedText, seedWorkflowId, gatewayStatus.state, handleHubSend, setSearchParams]);

  // Wait for site-department-types before choosing HQ vs site homepage.
  if (isAuthenticated && siteDepartmentTypes === null) {
    return null;
  }

  // 网点用户看到 首页 UI
  if (isSite) {
    return (
      <>
        <HomeSiteSurface seedSkillSlug={seedSkillSlug} />
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
        <div
          className={cn(
            isSplitGridPassthrough
              ? splitGridPassthroughClass
              : 'mx-auto flex h-full max-h-full min-h-0 w-full flex-1 flex-col overflow-hidden px-1 pt-2 sm:px-2',
          )}
        >
          <HomeAgentHubSurface seedSkillSlug={seedSkillSlug} />
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
      <div
        className={cn(
          isSplitGridPassthrough
            ? splitGridPassthroughClass
            : 'mx-auto flex h-full min-h-0 w-full flex-1 flex-col',
        )}
      >
        <div
          className={cn(
            isSplitGridPassthrough
              ? splitGridPassthroughClass
              : 'flex min-h-0 flex-1 flex-col overflow-hidden',
            !showConversation && !isSplitGridPassthrough && 'px-4 sm:px-6',
          )}
        >
          {showConversation ? (
            <HomeMainConversation
              className="min-h-0 flex-1"
              seedSkillSlug={seedSkillSlug}
              onSend={handleHubSend}
            />
          ) : (
            <div className={homeHubMainScrollHostClass}>
              <div className={homeHubMainScrollClass}>
                <HomeHero />
                <HomeSummaryCards />
              </div>
            </div>
          )}
        </div>
        {!showConversation ? (
          <div className={homeHubFooterShellClass}>
            <HomeComposer seedSkillSlug={seedSkillSlug} onSend={handleHubSend} />
          </div>
        ) : null}
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
