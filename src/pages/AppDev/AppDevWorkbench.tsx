/**
 * AppDevWorkbench — 用户应用开发工作台（app-dev-workbench）。
 * 左：项目 Agent 对话（默认注入应用 AGENTS.md 上下文）；
 * 右：所见即所得预览（预览工具栏内可打开系统浏览器）。
 */
import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  AlertCircle,
  ArrowLeft,
  History,
} from 'lucide-react';
import { toast } from 'sonner';
import { useChatStore } from '@/stores/chat';
import { useSessionCatalogStore } from '@/stores/session-catalog';
import { ensureProjectAgentForWorkspace } from '@/lib/session-catalog-api';
import { useAppDevCatalogStore } from '@/stores/app-dev-catalog';
import { ChatMessage } from '@/pages/Chat/ChatMessage';
import { AssistantTurnMessage } from '@/pages/Chat/AssistantTurnMessage';
import { useChatDisplay } from '@/pages/Chat/use-chat-display';
import { extractText } from '@/pages/Chat/message-utils';
import { useStickToBottomInstant } from '@/hooks/use-stick-to-bottom-instant';
import { HomeComposer } from '@/pages/Home/HomeComposer';
import { AppDevWorkbenchStage } from '@/components/app-dev/AppDevWorkbenchStage';
import { AppDevRunStatusMenu } from '@/components/app-dev/AppDevRunStatusMenu';
import { StoAppCommitDialog } from '@/components/app-dev/StoAppCommitDialog';
import { StoAppDeployControl } from '@/components/app-dev/StoAppDeployControl';
import { StoAppDeployDialog } from '@/components/app-dev/StoAppDeployDialog';
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
  ensureAppDevContext,
  getAppDevEnvironment,
  getAppStatus,
  getStoAppStatus,
  pullStoApp,
  pushStoApp,
  type CodeDeployEnv,
  type StoAppStatus,
  restoreAppCheckpoint,
  startApp,
  type AppDevStatus,
} from '@/lib/app-dev-api';
import { useStoAppDeploy } from '@/hooks/use-sto-app-deploy';
import { useAppDevRunControl } from '@/hooks/use-app-dev-run-control';

function WorkbenchChatPane({
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
  const messages = useChatStore((s) => s.messages);
  const sending = useChatStore((s) => s.sending);
  const showThinking = useChatStore((s) => s.showThinking);
  const error = useChatStore((s) => s.error);
  const clearError = useChatStore((s) => s.clearError);
  const streamingMessage = useChatStore((s) => s.streamingMessage);
  const streamingMessages = useChatStore((s) => s.streamingMessages);
  const streamingToolResults = useChatStore((s) => s.streamingToolResults);
  const streamingTools = useChatStore((s) => s.streamingTools);
  const pendingFinal = useChatStore((s) => s.pendingFinal);
  const lastChatEventAt = useChatStore((s) => s.lastChatEventAt);

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
                      turnMessages={item.messages}
                      turnToolResults={item.toolResults}
                      precedingUserMessage={item.precedingUserMessage}
                      showThinking={showThinking}
                    />
                  );
                }
                return <ChatMessage key={item.key} message={item.message} showThinking={showThinking} />;
              })}
              {activeTurn ? (
                <AssistantTurnMessage
                  key="active-turn"
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
        <HomeComposer
          key={composerSeed ? `seed-${composerSeed.version}` : 'composer'}
          seedText={composerSeed?.text}
          onBeforeSend={onBeforeSend}
          showDisclaimer={false}
          footerAlign="center"
        />
      </div>
    </div>
  );
}

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
  const sending = useChatStore((s) => s.sending);
  const currentSessionKey = useChatStore((s) => s.currentSessionKey);
  const prevSendingRef = useRef(false);
  const workspaces = useSessionCatalogStore((s) => s.workspaces);
  const appName = workspaces.find((w) => w.id === workspaceId)?.name ?? '我的应用';
  const runControl = useAppDevRunControl({ workspaceId, setStatus });
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
    setSourceRevision(0);
  }, [workspaceId]);

  // 进入工作台：立刻从侧栏隐藏 + 确保 Agent/上下文 + 复用已有会话（避免堆「新对话」）。
  useEffect(() => {
    if (!workspaceId) return;
    useAppDevCatalogStore.getState().registerWorkspaceId(workspaceId);
    void useAppDevCatalogStore.getState().refresh().catch(() => undefined);

    void (async () => {
      await useSessionCatalogStore.getState().selectProject(workspaceId).catch(() => undefined);
      await ensureProjectAgentForWorkspace({ workspaceId }).catch(() => undefined);
      // OpenClaw seed may overwrite AGENTS.md — re-apply our app context after ensure.
      await ensureAppDevContext(workspaceId).catch(() => undefined);

      const catalog = useSessionCatalogStore.getState();
      const chat = useChatStore.getState();
      const existing = chat.sessions
        .filter((session) => catalog.sessionWorkspaceByKey[session.key] === workspaceId)
        .sort((a, b) => {
          const aAt = chat.sessionLastActivity[a.key] ?? 0;
          const bAt = chat.sessionLastActivity[b.key] ?? 0;
          return bAt - aAt;
        });

      if (existing[0]) {
        chat.switchSession(existing[0].key);
      } else {
        chat.newSession({ projectId: workspaceId, materialize: true });
      }
    })();
  }, [workspaceId]);

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

  // 状态轮询：未运行时自动拉起流水线；ready 后降频探测崩溃。
  useEffect(() => {
    if (!workspaceId) return;
    let cancelled = false;
    let startedOnce = false;
    const tick = async () => {
      const next = await getAppStatus(workspaceId).catch(() => null);
      if (cancelled) return;
      if ((!next || next.phase === 'stopped') && !startedOnce) {
        startedOnce = true;
        void startApp(workspaceId).catch(() => undefined);
      } else if (next && next.phase !== 'stopped') {
        // A manually stopped app must stay stopped; do not let this initial
        // auto-start guard bring it back on the next poll.
        startedOnce = true;
      }
      if (next) setStatus(next);
    };
    void tick();
    const timer = setInterval(() => void tick(), 1500);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [workspaceId]);

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

  const handleFixErrors = () => {
    const text = `右侧预览出现了以下报错，请帮我修复：\n\n${pendingErrors.slice(-10).join('\n')}`;
    setPendingErrors([]);
    setComposerSeed((prev) => ({ text, version: (prev?.version ?? 0) + 1 }));
  };

  const handleFillComposerFromDiagnostics = (text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    setComposerSeed((prev) => ({ text: trimmed, version: (prev?.version ?? 0) + 1 }));
  };

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

  const canDeploy = Boolean(
    stoStatus?.available
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
        <h1 className="min-w-0 flex-1 truncate text-sm font-semibold text-foreground">{appName}</h1>
        <AppDevRunStatusMenu
          phase={phase}
          pending={runControl.pending}
          onStart={() => void runControl.start()}
          onStop={() => void runControl.stop()}
          onRestart={() => void runControl.restart()}
        />

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

        {stoStatus?.bound && (stoStatus.syncState === 'remote-ahead' || stoStatus.syncState === 'merge-required') ? (
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

        {stoStatus?.bound && stoStatus.syncState === 'merge-required' ? (
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

        <StoAppDeployControl
          canDeploy={canDeploy}
          job={deploy.job}
          onOpenDialog={() => setDeployOpen(true)}
          onClearTerminalJob={deploy.clear}
          onFillComposer={handleFillComposerFromDiagnostics}
        />

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

      <div className="flex min-h-0 flex-1">
        <AppDevWorkbenchStage
          workspaceId={workspaceId}
          appName={appName}
          status={status}
          pendingErrors={pendingErrors}
          onFixErrors={handleFixErrors}
          onDismissErrors={() => setPendingErrors([])}
          onRetryStart={() => void runControl.start()}
          onFillComposerFromDiagnostics={handleFillComposerFromDiagnostics}
          sourceRevision={sourceRevision}
          previewRevision={runControl.previewRevision}
        />

        <section className="flex w-[400px] min-w-[340px] shrink-0 flex-col border-l border-border">
          {currentSessionKey
            ? (
              <WorkbenchChatPane
                sessionKey={currentSessionKey}
                appName={appName}
                composerSeed={composerSeed}
                onBeforeSend={runControl.interceptRestartIntent}
              />
            )
            : null}
        </section>
      </div>

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
        initialMessage={`更新应用: ${appName}`}
        onCancel={() => setCommitOpen(false)}
        onConfirm={handleSubmit}
      />
      <StoAppDeployDialog
        open={deployOpen}
        appName={appName}
        applicationId={stoStatus?.applicationId}
        onCancel={() => setDeployOpen(false)}
        onConfirm={handleDeploy}
      />
    </div>
  );
}
