/**
 * AppDevWorkbench — 用户应用开发工作台（app-dev-workbench）。
 * 左：项目 Agent 对话（默认注入应用 AGENTS.md 上下文）；
 * 右：所见即所得预览（预览工具栏内可打开系统浏览器）。
 */
import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  AlertCircle,
  ArrowLeft,
  History,
} from 'lucide-react';
import { toast } from 'sonner';
import { useChatStore } from '@/stores/chat';
import { useSessionDisplayMessages } from '@/stores/chat/display-selectors';
import { useChatSessionRuntimeView, useChatSessionSending } from '@/stores/chat/runtime-selectors';
import { useSessionCatalogStore } from '@/stores/session-catalog';
import { useAppDevCatalogStore } from '@/stores/app-dev-catalog';
import { ChatMessage } from '@/pages/Chat/ChatMessage';
import { AssistantTurnMessage } from '@/pages/Chat/AssistantTurnMessage';
import { useChatDisplay } from '@/pages/Chat/use-chat-display';
import { extractText } from '@/pages/Chat/message-utils';
import { useStickToBottomInstant } from '@/hooks/use-stick-to-bottom-instant';
import { AppDevComposer } from '@/components/app-dev/AppDevComposer';
import { AppDevSplitBody } from '@/components/app-dev/AppDevSplitBody';
import { AppDevWorkbenchStage } from '@/components/app-dev/AppDevWorkbenchStage';
import { AppDevRunStatusMenu } from '@/components/app-dev/AppDevRunStatusMenu';
import { StoAppCommitDialog } from '@/components/app-dev/StoAppCommitDialog';
import { StoAppDeployControl } from '@/components/app-dev/StoAppDeployControl';
import { StoAppDeployDialog } from '@/components/app-dev/StoAppDeployDialog';
import { AppDevPageTypeBadge } from '@/components/app-dev/AppDevPageTypeBadge';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { cn } from '@/lib/utils';
import {
  stoChatColumnContentTrackClass,
  stoChatScrollContentClass,
  stoChatScrollPaneClass,
} from '@/lib/surfaces';
import { useMoreAppsStore } from '@/stores/more-apps';
import {
  createAppCheckpoint,
  continueStoAppMerge,
  drainAppErrors,
  getAppDevEnvironment,
  getStoAppStatus,
  pullStoApp,
  pushStoApp,
  type CodeDeployEnv,
  type StoAppStatus,
  restoreAppCheckpoint,
  type AppDevStatus,
} from '@/lib/app-dev-api';
import { useStoAppDeploy } from '@/hooks/use-sto-app-deploy';
import { useAppDevRunControl } from '@/hooks/use-app-dev-run-control';
import { useAppDevStatusPoll } from '@/hooks/use-app-dev-status-poll';
import { useAppDevChatSession } from '@/hooks/use-app-dev-chat-session';
import { shouldShowGitCommitAction, shouldShowStoCloudActions } from '@/lib/app-dev-actions';

const WorkbenchChatPane = memo(function WorkbenchChatPane({
  sessionKey,
  appName,
  composerSeed,
  onBeforeSend,
}: {
  sessionKey: string;
  appName: string;
  composerSeed?: { text: string; version: number } | null;
  onBeforeSend?: (text: string) => boolean;
}) {
  const messages = useSessionDisplayMessages(sessionKey);
  const showThinking = useChatStore((s) => s.showThinking);
  const clearError = useChatStore((s) => s.clearError);
  const {
    sending,
    pendingFinal,
    lastEventAt: lastChatEventAt,
    lastUserMessageAt,
    streamingMessage,
    streamingMessages,
    streamingToolResults,
    streamingTools,
    error,
  } = useChatSessionRuntimeView(sessionKey);

  const streamMsg = streamingMessage && typeof streamingMessage === 'object'
    ? streamingMessage as unknown as { role?: string; content?: unknown; timestamp?: number; id?: string }
    : null;
  const streamText = streamMsg ? extractText(streamMsg) : (typeof streamingMessage === 'string' ? streamingMessage : '');

  const { contentRef, scrollRef } = useStickToBottomInstant(sessionKey);

  const { staticItems, activeTurn } = useChatDisplay({
    messages,
    sending,
    pendingFinal,
    showThinking,
    lastChatEventAt,
    lastUserMessageAt,
    streamMsg,
    streamText,
    streamingMessages,
    streamingToolResults,
    streamingTools,
  });

  return (
    <div className="flex h-full min-w-0 flex-col">
      <div ref={scrollRef} className={cn(stoChatScrollPaneClass, 'flex-1')}>
        <div ref={contentRef} className={cn(stoChatScrollContentClass, stoChatColumnContentTrackClass('home', false))}>
          {messages.length === 0 && !activeTurn ? (
            <div className="flex h-full flex-col items-center justify-center gap-2 py-16 text-center">
              <p className="text-sm text-foreground">和 AI 一起完善「{appName}」</p>
              <p className="max-w-[280px] text-xs leading-relaxed text-muted-foreground">
                已自动了解本应用的项目结构与接口文档位置。直接描述需求即可，比如“首页加一个按单号查询的搜索框”。
              </p>
            </div>
          ) : (
            <>
              {staticItems.map((item) => {
                if (item.type === 'assistant-turn') {
                  return (
                    <AssistantTurnMessage
                      key={item.key}
                      sessionMessages={messages}
                      turnMessages={item.messages}
                      turnToolResults={item.toolResults}
                      precedingUserMessage={item.precedingUserMessage}
                      showThinking={showThinking}
                    />
                  );
                }
                if (item.type !== 'single') return null;
                return (
                  <ChatMessage
                    key={item.key}
                    message={item.message}
                    sessionMessages={messages}
                    showThinking={showThinking}
                  />
                );
              })}
              {activeTurn ? (
                <AssistantTurnMessage
                  key="active-turn"
                  sessionMessages={messages}
                  turnMessages={activeTurn.turnMessages}
                  turnToolResults={activeTurn.turnToolResults}
                  precedingUserMessage={activeTurn.precedingUserMessage}
                  showThinking={showThinking}
                  activeStream={activeTurn.activeStream}
                />
              ) : null}
            </>
          )}
        </div>
      </div>

      {error ? (
        <div className="flex items-center justify-between gap-2 border-t border-border px-4 py-2">
          <p className="flex items-center gap-2 text-sm text-destructive">
            <AlertCircle className="h-4 w-4 shrink-0" aria-hidden />
            {error}
          </p>
          <button type="button" onClick={() => clearError()} className="text-xs text-destructive/70 underline">
            知道了
          </button>
        </div>
      ) : null}

      <div className="border-t border-border px-3 py-3">
        <AppDevComposer
          key={composerSeed ? `seed-${composerSeed.version}` : 'composer'}
          seedText={composerSeed?.text}
          onBeforeSend={onBeforeSend}
        />
      </div>
    </div>
  );
});

export default function AppDevWorkbench() {
  const { workspaceId = '' } = useParams<{ workspaceId: string }>();
  const navigate = useNavigate();
  const [status, setStatus] = useState<AppDevStatus | null>(null);
  const [pendingErrors, setPendingErrors] = useState<string[]>([]);
  const [composerSeed, setComposerSeed] = useState<{ text: string; version: number } | null>(null);
  const [confirmRestore, setConfirmRestore] = useState(false);
  const [gitAvailable, setGitAvailable] = useState(false);
  const [stoStatus, setStoStatus] = useState<StoAppStatus | null>(null);
  const [commitOpen, setCommitOpen] = useState(false);
  const [deployOpen, setDeployOpen] = useState(false);
  const [sourceRevision, setSourceRevision] = useState(0);
  const [statusWorkspaceId, setStatusWorkspaceId] = useState(workspaceId);
  const prevSendingRef = useRef(false);
  if (statusWorkspaceId !== workspaceId) {
    setStatusWorkspaceId(workspaceId);
    setSourceRevision(0);
  }
  const workspaces = useSessionCatalogStore((s) => s.workspaces);
  const pageType = useAppDevCatalogStore((s) => (
    s.apps.find((app) => app.workspaceId === workspaceId)?.pageType
  ));
  const appName = workspaces.find((w) => w.id === workspaceId)?.name ?? '我的应用';
  const listedApp = useAppDevCatalogStore((s) =>
    s.apps.find((app) => app.workspaceId === workspaceId),
  );
  const appDevSessionKey = useAppDevChatSession(workspaceId);
  const sending = useChatSessionSending(appDevSessionKey ?? '');
  const {
    pending: runPending,
    previewRevision,
    start: startRun,
    stop: stopRun,
    restart: restartRun,
    interceptRestartIntent,
  } = useAppDevRunControl({ workspaceId, setStatus });
  const dismissErrors = useCallback(() => setPendingErrors([]), []);
  const handleRetryStart = useCallback(() => {
    void startRun();
  }, [startRun]);
  const deploy = useStoAppDeploy({
    workspaceId,
    applicationId: stoStatus?.applicationId,
    appName,
    onFailedPrompt: (prompt) => {
      setComposerSeed((prev) => ({
        text: prompt,
        version: (prev?.version ?? 0) + 1,
      }));
    },
    onStatusRefresh: async () => {
      const next = await getStoAppStatus(workspaceId).catch(() => null);
      if (next) setStoStatus(next);
    },
  });

  useEffect(() => {
    void getAppDevEnvironment()
      .then((env) => setGitAvailable(env.gitAvailable))
      .catch(() => setGitAvailable(false));
  }, []);

  useEffect(() => {
    if (!workspaceId) return;
    void getStoAppStatus(workspaceId)
      .then((res) => setStoStatus(res))
      .catch(() => setStoStatus(null));
  }, [workspaceId]);

  useAppDevStatusPoll(workspaceId, setStatus);

  // 每轮对话结束：自动保存版本 + 收集报错 + 刷新右侧已打开代码。
  useEffect(() => {
    if (prevSendingRef.current && !sending && workspaceId) {
      void (async () => {
        await createAppCheckpoint(workspaceId, '对话修改').catch(() => undefined);
        const errors = await drainAppErrors(workspaceId).catch(() => [] as string[]);
        if (errors.length > 0) setPendingErrors(errors);
        setSourceRevision((n) => n + 1);
      })();
    }
    prevSendingRef.current = sending;
  }, [sending, workspaceId]);

  const handleFixErrors = useCallback(() => {
    const text = `右侧预览出现了以下报错，请帮我修复：\n\n${pendingErrors.slice(-10).join('\n')}`;
    setPendingErrors([]);
    setComposerSeed((prev) => ({ text, version: (prev?.version ?? 0) + 1 }));
  }, [pendingErrors]);

  const handlePreviewRuntimeError = useCallback((formattedLine: string) => {
    const line = formattedLine.trim();
    if (!line) return;
    setPendingErrors((prev) => {
      if (prev.includes(line)) return prev;
      const next = [...prev, line];
      return next.length > 20 ? next.slice(-20) : next;
    });
  }, []);

  const handleFillComposerFromDiagnostics = useCallback((text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    setComposerSeed((prev) => ({ text: trimmed, version: (prev?.version ?? 0) + 1 }));
  }, []);

  const handleRestore = async () => {
    const result = await restoreAppCheckpoint(workspaceId);
    if (result.restored) {
      setSourceRevision((n) => n + 1);
      toast.success('已恢复到上一版，页面稍后自动刷新');
    } else {
      toast.error('暂时无法恢复，请稍后再试');
    }
  };

  const handleSubmit = async (message: string) => {
    try {
      await pushStoApp(workspaceId, message);
      const nextStatus = await getStoAppStatus(workspaceId).catch(() => null);
      if (nextStatus) setStoStatus(nextStatus);
      toast.success('已提交到 STO 应用');
      setCommitOpen(false);
    } catch (error) {
      const nextStatus = await getStoAppStatus(workspaceId).catch(() => null);
      if (nextStatus) setStoStatus(nextStatus);
      toast.error(error instanceof Error ? error.message : '提交失败');
    }
  };

  const handleGitSubmit = async (message: string) => {
    try {
      const created = await createAppCheckpoint(workspaceId, message);
      if (created) {
        toast.success('代码已提交到本地 Git');
        setCommitOpen(false);
      } else {
        toast.message('没有可提交的改动');
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '提交失败');
    }
  };

  const handlePull = async () => {
    try {
      await pullStoApp(workspaceId);
      const nextStatus = await getStoAppStatus(workspaceId).catch(() => null);
      if (nextStatus) setStoStatus(nextStatus);
      setSourceRevision((n) => n + 1);
      toast.success('已拉取远端更新');
    } catch (error) {
      const nextStatus = await getStoAppStatus(workspaceId).catch(() => null);
      if (nextStatus) setStoStatus(nextStatus);
      toast.error(error instanceof Error ? error.message : '拉取失败');
    }
  };

  const handleMergeContinue = async () => {
    const revisionId = stoStatus?.revisionId?.trim();
    if (!revisionId) {
      toast.error('缺少冲突版本号，请先在对话中解决冲突后刷新状态');
      return;
    }
    try {
      await continueStoAppMerge(workspaceId, revisionId);
      const nextStatus = await getStoAppStatus(workspaceId).catch(() => null);
      if (nextStatus) setStoStatus(nextStatus);
      setSourceRevision((n) => n + 1);
      toast.success('已继续合并，可以再次提交');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '合并继续失败');
    }
  };

  const handleDeploy = (input: { env: CodeDeployEnv; deploymentVersion?: string }) => {
    setDeployOpen(false);
    deploy.start(input);
  };

  const showCloudActions = shouldShowStoCloudActions(listedApp, stoStatus);
  const showGitCommit = shouldShowGitCommitAction(listedApp, gitAvailable, stoStatus);
  const commitMode = showGitCommit ? 'git' : 'sto';
  const canDeploy = Boolean(
    showCloudActions
    && stoStatus?.available
    && (stoStatus.bound || stoStatus.applicationId),
  );

  const phase = status?.phase ?? 'created';
  const stoStatusTone = stoStatus?.available && stoStatus.bound
    ? stoStatus.syncState === 'merge-required'
      ? 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-300'
      : stoStatus.syncState === 'remote-ahead'
        ? 'border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-900/60 dark:bg-sky-950/30 dark:text-sky-300'
        : stoStatus.syncState === 'local-changes'
          ? 'border-violet-200 bg-violet-50 text-violet-700 dark:border-violet-900/60 dark:bg-violet-950/30 dark:text-violet-300'
          : 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:text-emerald-300'
    : 'border-border bg-muted/50 text-muted-foreground';

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex shrink-0 items-center gap-3 border-b border-border px-4 py-2.5">
        <button
          type="button"
          onClick={() => {
            useMoreAppsStore.getState().setActiveTab('dev-apps');
            navigate('/more-apps');
          }}
          className="flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden />
          开发应用
        </button>
        <div className="h-4 w-px bg-border" aria-hidden />
        <h1 className="min-w-0 truncate text-sm font-semibold text-foreground">{appName}</h1>
        <AppDevPageTypeBadge pageType={pageType} />
        <div className="flex-1" />
        <AppDevRunStatusMenu
          phase={phase}
          pending={runPending}
          onStart={() => void startRun()}
          onStop={() => void stopRun()}
          onRestart={() => void restartRun()}
        />

        {showCloudActions ? (
          <span
            className={cn(
              'inline-flex h-7 items-center rounded-md border px-2 text-[11px]',
              stoStatusTone,
            )}
            title={
              stoStatus?.bound
                ? `${stoStatus.syncLabel}${stoStatus.applicationId ? ` · ${stoStatus.applicationId}` : ''}`
                : '未绑定 STO 应用'
            }
          >
            {stoStatus?.bound ? `STO ${stoStatus.syncLabel}` : 'STO 未绑定'}
          </span>
        ) : null}

        {showGitCommit ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 gap-1 px-2 text-xs"
            onClick={() => setCommitOpen(true)}
          >
            提交
          </Button>
        ) : null}

        {showCloudActions ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 gap-1 px-2 text-xs"
            disabled={!stoStatus?.available || !stoStatus?.bound}
            onClick={() => setCommitOpen(true)}
          >
            提交
          </Button>
        ) : null}

        {showCloudActions && stoStatus?.bound && (stoStatus.syncState === 'remote-ahead' || stoStatus.syncState === 'merge-required') ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 gap-1 px-2 text-xs"
            onClick={() => void handlePull()}
          >
            拉取
          </Button>
        ) : null}

        {showCloudActions && stoStatus?.bound && stoStatus.syncState === 'merge-required' ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 gap-1 px-2 text-xs"
            disabled={!stoStatus.revisionId}
            title={stoStatus.revisionId ? `继续合并 ${stoStatus.revisionId}` : '缺少 revisionId'}
            onClick={() => void handleMergeContinue()}
          >
            继续合并
          </Button>
        ) : null}

        {showCloudActions ? (
          <StoAppDeployControl
            pageType={pageType ?? 'site'}
            canDeploy={canDeploy}
            job={deploy.job}
            onOpenDialog={() => setDeployOpen(true)}
            onClearTerminalJob={deploy.clear}
            onFillComposer={handleFillComposerFromDiagnostics}
          />
        ) : null}

        <Button
          type="button"
          variant="ghost"
          size="sm"
          className={cn('gap-1 text-xs', !gitAvailable && 'hidden')}
          disabled={!gitAvailable}
          onClick={() => setConfirmRestore(true)}
        >
          <History className="h-3.5 w-3.5" aria-hidden />
          恢复上一版
        </Button>
      </header>

      <AppDevSplitBody
        chat={
          appDevSessionKey
            ? (
              <WorkbenchChatPane
                sessionKey={appDevSessionKey}
                appName={appName}
                composerSeed={composerSeed}
                onBeforeSend={interceptRestartIntent}
              />
            )
            : null
        }
      >
        <AppDevWorkbenchStage
          workspaceId={workspaceId}
          appName={appName}
          status={status}
          pendingErrors={pendingErrors}
          onFixErrors={handleFixErrors}
          onDismissErrors={dismissErrors}
          onPreviewRuntimeError={handlePreviewRuntimeError}
          onRetryStart={handleRetryStart}
          onFillComposerFromDiagnostics={handleFillComposerFromDiagnostics}
          sourceRevision={sourceRevision}
          previewRevision={previewRevision}
        />
      </AppDevSplitBody>

      <ConfirmDialog
        open={confirmRestore}
        title="恢复上一版"
        message="将把应用恢复到上一次对话修改前的样子。当前内容会自动备份，可以放心恢复。"
        confirmLabel="恢复"
        confirmingLabel="恢复中…"
        variant="destructive"
        onConfirm={async () => {
          await handleRestore();
          setConfirmRestore(false);
        }}
        onCancel={() => setConfirmRestore(false)}
      />
      <StoAppCommitDialog
        open={commitOpen}
        appName={appName}
        mode={commitMode}
        initialMessage={commitMode === 'git' ? `更新: ${appName}` : `更新应用: ${appName}`}
        onCancel={() => setCommitOpen(false)}
        onConfirm={commitMode === 'git' ? handleGitSubmit : handleSubmit}
      />
      <StoAppDeployDialog
        open={deployOpen}
        appName={appName}
        workspaceId={workspaceId}
        pageType={pageType ?? 'site'}
        applicationId={stoStatus?.applicationId}
        onCancel={() => setDeployOpen(false)}
        onConfirm={handleDeploy}
      />
    </div>
  );
}
