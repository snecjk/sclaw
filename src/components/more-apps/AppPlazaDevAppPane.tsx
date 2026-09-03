/**
 * AppPlazaDevAppPane — full-window app-dev workbench overlay.
 * Left: preview / Monaco code / file search; Right: project agent chat.
 * Portaled over the entire app shell (including sidebar) while active.
 */
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  AlertCircle,
  ArrowLeft,
  Code2,
  History,
  MessageCircle,
  PanelLeftClose,
  PanelLeftOpen,
  Upload,
} from 'lucide-react';
import { toast } from 'sonner';
import { useChatStore } from '@/stores/chat';
import type { ToolStatus } from '@/stores/chat';
import { useSessionDisplayMessages } from '@/stores/chat/display-selectors';
import { useChatSessionRuntimeView, useChatSessionSending } from '@/stores/chat/runtime-selectors';
import { useSessionCatalogStore } from '@/stores/session-catalog';
import { ChatStaticItemsList } from '@/components/chat/ChatStaticItemsList';
import { AssistantTurnMessage } from '@/pages/Chat/AssistantTurnMessage';
import { useChatDisplay } from '@/pages/Chat/use-chat-display';
import type { ChatDisplayItem } from '@/pages/Chat/chat-display';
import { extractText } from '@/pages/Chat/message-utils';
import { useStickToBottomInstant } from '@/hooks/use-stick-to-bottom-instant';
import { useChatSessionEngineType } from '@/hooks/use-chat-session-engine-type';
import { AppDevComposer } from '@/components/app-dev/AppDevComposer';
import { AppDevSplitBody } from '@/components/app-dev/AppDevSplitBody';
import { AppDevToolRollupLine } from '@/components/app-dev/AppDevToolRollupLine';
import { AppDevTodoCapsule } from '@/components/app-dev/AppDevTodoCapsule';
import { AppDevTurnSummaryCard } from '@/components/app-dev/AppDevTurnSummaryCard';
import {
  appDevCompletedToolsSignature,
  isAppDevToolRollupEmpty,
  normalizeAppDevTimestamp,
  resolveAppDevTurnDurationMs,
  resolveAppDevTurnTools,
  rollupAppDevTools,
} from '@/lib/app-dev-tool-rollup';
import { deriveAppDevTurnPlan } from '@/lib/app-dev-turn-plan';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { TemplatePublishConfirmDialog } from './TemplatePublishConfirmDialog';
import { TemplateProjectUploadControl } from './TemplateProjectUploadControl';
import { BuiltinTemplateDebugControl } from './BuiltinTemplateDebugControl';
import { cn } from '@/lib/utils';
import {
  stoChatColumnContentTrackClass,
  stoChatScrollContentClass,
  stoChatScrollPaneClass,
} from '@/lib/surfaces';
import { AppDevWorkbenchStage } from '@/components/app-dev/AppDevWorkbenchStage';
import { AppDevRunStatusMenu } from '@/components/app-dev/AppDevRunStatusMenu';
import { StoAppCommitDialog } from '@/components/app-dev/StoAppCommitDialog';
import { StoAppDeployControl } from '@/components/app-dev/StoAppDeployControl';
import { StoAppDeployDialog } from '@/components/app-dev/StoAppDeployDialog';
import { StoAppMenuPublishDialog } from '@/components/app-dev/StoAppMenuPublishDialog';
import { AppDevPageTypeBadge } from '@/components/app-dev/AppDevPageTypeBadge';
import { useAppDevCatalogStore } from '@/stores/app-dev-catalog';
import { useAppDevWorkbenchStore } from '@/stores/app-dev-workbench';
import {
  createAppCheckpoint,
  continueStoAppMerge,
  drainAppErrors,
  getAppDevEnvironment,
  getStoAppStatus,
  pullStoApp,
  publishAppTemplateWorkspace,
  pushStoApp,
  type StoAppStatus,
  restoreAppCheckpoint,
  type AppDevStatus,
} from '@/lib/app-dev-api';
import { useStoAppDeploy } from '@/hooks/use-sto-app-deploy';
import { useAppDevRunControl } from '@/hooks/use-app-dev-run-control';
import { useAppDevStatusPoll } from '@/hooks/use-app-dev-status-poll';
import {
  type AppPlazaDevAppTab,
  useAppPlazaShellStore,
} from '@/stores/app-plaza-shell';
import { shouldShowGitCommitAction, shouldShowStoCloudActions, canUseStoCloudPipeline } from '@/lib/app-dev-actions';
import { useAppDevChatSession } from '@/hooks/use-app-dev-chat-session';
import { openAppDevIdeWindow, useAppDevIdeOwnership } from '@/hooks/use-app-dev-ide-ownership';
import {
  isSclawBrowserEmbedChatShortcut,
  sclawBrowserEmbedChatShortcutLabel,
} from '../../../shared/sclaw-embed-browser-shortcut';

const CAPTURED_TURN_SUMMARY_LIMIT = 30;

type AssistantTurnDisplayItem = Extract<ChatDisplayItem, { type: 'assistant-turn' }>;

interface CapturedTurnSummary {
  tools: ToolStatus[];
  durationMs: number | null;
  interrupted: boolean;
}

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
  const engineType = useChatSessionEngineType();
  const {
    sending,
    pendingFinal,
    transcriptPending,
    lastEventAt: lastChatEventAt,
    turnAnchorAt,
    streamingMessage,
    streamingMessages,
    streamingToolResults,
    streamingTools,
    phase,
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
    transcriptPending,
    showThinking,
    lastChatEventAt,
    turnAnchorAt,
    streamMsg,
    streamText,
    streamingMessages,
    streamingToolResults,
    streamingTools,
  });

  // ── T02 生成过程可视化 ──

  // 工具聚合：streamingTools 高频更新，按 completed 子集签名 memo，避免每 token 全量重算
  const rollupSig = appDevCompletedToolsSignature(streamingTools);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const toolRollup = useMemo(() => rollupAppDevTools(streamingTools), [rollupSig]);

  // 待办胶囊：流式阶段叙述 + 工具进度派生
  const turnPlanTexts = useMemo(() => {
    const texts = streamingMessages
      .map((message) => extractText(message))
      .filter((text) => text.trim().length > 0);
    if (streamText.trim()) texts.push(streamText);
    return texts;
  }, [streamingMessages, streamText]);
  const turnPlan = useMemo(
    () => deriveAppDevTurnPlan({ texts: turnPlanTexts, tools: streamingTools, sending }),
    [turnPlanTexts, streamingTools, sending],
  );

  // 轮结束快照：汇总卡的中断标记 / 耗时 / 工具清单在轮结束瞬间捕获，
  // 静态列表 remount（transcript 接管）后仍可对齐到同一 turnKey
  const capturedSummariesRef = useRef<Map<string, CapturedTurnSummary>>(new Map());
  const prevSendingRef = useRef(sending);
  const abortingSeenRef = useRef(false);
  const liveTurnSnapshotRef = useRef<{
    turnKey: string | null;
    tools: ToolStatus[];
    anchorAt: number | null;
  }>({ turnKey: null, tools: [], anchorAt: null });
  const activeTurnStableKey = activeTurn?.turnStableKey ?? null;

  // 生成中持续记录最新快照（ref 写入放在 effect，避免渲染期副作用）
  useEffect(() => {
    if (!sending) return;
    if (phase === 'aborting') abortingSeenRef.current = true;
    liveTurnSnapshotRef.current = {
      turnKey: activeTurnStableKey ?? liveTurnSnapshotRef.current.turnKey,
      tools: streamingTools,
      anchorAt: turnAnchorAt,
    };
  }, [sending, phase, activeTurnStableKey, streamingTools, turnAnchorAt]);

  useEffect(() => {
    if (prevSendingRef.current && !sending) {
      const snapshot = liveTurnSnapshotRef.current;
      if (snapshot.turnKey && snapshot.tools.length > 0) {
        capturedSummariesRef.current.set(snapshot.turnKey, {
          tools: snapshot.tools,
          durationMs: resolveAppDevTurnDurationMs({
            anchorAt: snapshot.anchorAt,
            tools: snapshot.tools,
          }),
          interrupted: abortingSeenRef.current,
        });
        if (capturedSummariesRef.current.size > CAPTURED_TURN_SUMMARY_LIMIT) {
          const oldest = capturedSummariesRef.current.keys().next().value;
          if (oldest) capturedSummariesRef.current.delete(oldest);
        }
      }
      abortingSeenRef.current = false;
    }
    prevSendingRef.current = sending;
  }, [sending]);

  // 轮次汇总卡注入（ChatStaticItemsList renderTurnFooter；T04 操作按钮亦经此挂载）
  const renderTurnFooter = useCallback((item: AssistantTurnDisplayItem) => {
    const captured = capturedSummariesRef.current.get(item.key);
    const tools = captured?.tools ?? resolveAppDevTurnTools({
      sessionKey,
      turnKey: item.key,
      turnMessages: item.messages,
      toolResults: item.toolResults,
      precedingUserMessage: item.precedingUserMessage,
      engineType,
    });
    if (tools.length === 0 && !captured?.interrupted) return null;
    const durationMs = captured?.durationMs ?? resolveAppDevTurnDurationMs({
      tools,
      anchorAt: normalizeAppDevTimestamp(item.precedingUserMessage?.timestamp),
      endedAt: normalizeAppDevTimestamp(item.messages[item.messages.length - 1]?.timestamp),
    });
    return (
      <AppDevTurnSummaryCard
        tools={tools}
        durationMs={durationMs}
        interrupted={captured?.interrupted ?? false}
        className="mt-2"
      />
    );
  }, [sessionKey, engineType]);

  return (
    <div className="flex h-full min-w-0 flex-col">
      <div ref={scrollRef} className={cn(stoChatScrollPaneClass, 'flex-1')}>
        <div ref={contentRef} className={cn(stoChatScrollContentClass, stoChatColumnContentTrackClass('home', false))}>
          {messages.length === 0 && !activeTurn ? (
            <div className="flex h-full flex-col items-center justify-center gap-2 py-16 text-center">
              <p className="text-sm text-foreground">和 AI 一起完善「{appName}」</p>
              <p className="max-w-[280px] text-xs leading-relaxed text-muted-foreground">
                已自动了解本应用的项目结构与接口文档位置。直接描述需求即可，比如"首页加一个按单号查询的搜索框"。
              </p>
            </div>
          ) : (
            <>
              <ChatStaticItemsList
                items={staticItems}
                messages={messages}
                showThinking={showThinking}
                scrollRef={scrollRef}
                variant="home"
                sessionKey={sessionKey}
                renderTurnFooter={renderTurnFooter}
                onReachStart={() => {
                  void useChatStore.getState().loadOlderHistory(sessionKey);
                }}
              />
              {activeTurn ? (
                <>
                  <AssistantTurnMessage
                    key="active-turn"
                    sessionMessages={messages}
                    turnMessages={activeTurn.turnMessages}
                    turnToolResults={activeTurn.turnToolResults}
                    precedingUserMessage={activeTurn.precedingUserMessage}
                    showThinking={showThinking}
                    activeStream={activeTurn.activeStream}
                  />
                  {!isAppDevToolRollupEmpty(toolRollup) ? (
                    <AppDevToolRollupLine rollup={toolRollup} className="mt-2" />
                  ) : null}
                </>
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

      <div className="relative border-t border-border px-3 py-3">
        <AppDevTodoCapsule
          plan={turnPlan}
          sending={sending}
          className="absolute inset-x-0 top-0 z-10 -translate-y-[calc(100%+12px)]"
        />
        <AppDevComposer
          key={composerSeed ? `seed-${composerSeed.version}` : 'composer'}
          seedText={composerSeed?.text}
          onBeforeSend={onBeforeSend}
          composerDraftSessionKey={sessionKey}
        />
      </div>
    </div>
  );
});

interface AppPlazaDevAppPaneProps {
  tab: AppPlazaDevAppTab;
  active: boolean;
}

export function AppPlazaDevAppPane({ tab, active }: AppPlazaDevAppPaneProps) {
  const workspaceId = tab.workspaceId;
  const [status, setStatus] = useState<AppDevStatus | null>(null);
  const [pendingErrors, setPendingErrors] = useState<string[]>([]);
  const [composerSeed, setComposerSeed] = useState<{ text: string; version: number } | null>(null);
  const [confirmRestore, setConfirmRestore] = useState(false);
  const [gitAvailable, setGitAvailable] = useState(false);
  const [chatOpen, setChatOpen] = useState(true);
  const stageCollapsed = useAppDevWorkbenchStore((s) => s.stageCollapsed);
  const toggleStageCollapsed = useAppDevWorkbenchStore((s) => s.toggleStageCollapsed);
  const [stoStatus, setStoStatus] = useState<StoAppStatus | null>(null);
  const [commitOpen, setCommitOpen] = useState(false);
  const [deployOpen, setDeployOpen] = useState(false);
  const [menuPublishOpen, setMenuPublishOpen] = useState(false);
  const [templatePublishConfirm, setTemplatePublishConfirm] = useState(false);
  const [templatePublishing, setTemplatePublishing] = useState(false);
  const [sourceRevision, setSourceRevision] = useState(0);
  const [isBuiltinTemplateDebug, setIsBuiltinTemplateDebug] = useState<boolean | null>(null);
  const [statusWorkspaceId, setStatusWorkspaceId] = useState(workspaceId);
  const prevSendingRef = useRef(false);
  if (statusWorkspaceId !== workspaceId) {
    setStatusWorkspaceId(workspaceId);
    setSourceRevision(0);
    setIsBuiltinTemplateDebug(null);
  }
  const workspaces = useSessionCatalogStore((s) => s.workspaces);
  const pageType = useAppDevCatalogStore((s) => (
    s.apps.find((app) => app.workspaceId === workspaceId)?.pageType
  ));
  const appName = workspaces.find((w) => w.id === workspaceId)?.name ?? tab.title;
  const isTemplateWorkspace = tab.kind === 'template';
  const listedApp = useAppDevCatalogStore((s) =>
    s.apps.find((app) => app.workspaceId === workspaceId),
  );
  const ideOwnership = useAppDevIdeOwnership(workspaceId);
  const appDevSessionKey = useAppDevChatSession(
    workspaceId,
    active && ideOwnership.ready && !ideOwnership.open,
  );
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
  const closeDevAppTab = useAppPlazaShellStore((s) => s.closeDevAppTab);
  const showCloudActions = !isTemplateWorkspace && shouldShowStoCloudActions(listedApp, stoStatus);
  const showGitCommit = shouldShowGitCommitAction(listedApp, gitAvailable, stoStatus);
  const stoCloudPipelineReady = !isTemplateWorkspace && canUseStoCloudPipeline(listedApp, stoStatus);
  const canDeploy = stoCloudPipelineReady;
  const deploy = useStoAppDeploy({
    workspaceId: isTemplateWorkspace ? '' : workspaceId,
    appCode: stoStatus?.appCode,
    appName,
    pageType,
    onFailedPrompt: (prompt) => {
      setComposerSeed((prev) => ({
        text: prompt,
        version: (prev?.version ?? 0) + 1,
      }));
      setChatOpen(true);
    },
    onSuccess: () => setMenuPublishOpen(true),
    onStatusRefresh: async () => {
      const next = await getStoAppStatus(workspaceId).catch(() => null);
      if (next) setStoStatus(next);
      await useAppDevCatalogStore.getState().refresh().catch(() => undefined);
    },
  });

  const platform = window.electron?.platform
    ?? (navigator.platform.toLowerCase().includes('mac') ? 'darwin' : 'win32');
  const chatShortcutLabel = sclawBrowserEmbedChatShortcutLabel(platform);

  useEffect(() => {
    if (!active) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (!isSclawBrowserEmbedChatShortcut(event, platform)) return;
      event.preventDefault();
      event.stopPropagation();
      setChatOpen((open) => !open);
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [active, platform]);

  useEffect(() => {
    void getAppDevEnvironment()
      .then((env) => setGitAvailable(env.gitAvailable))
      .catch(() => setGitAvailable(false));
  }, []);

  useEffect(() => {
    if (!workspaceId || isTemplateWorkspace) {
      setStoStatus(null);
      return;
    }
    void getStoAppStatus(workspaceId)
      .then((res) => setStoStatus(res))
      .catch(() => setStoStatus(null));
  }, [workspaceId, isTemplateWorkspace]);

  useAppDevStatusPoll(workspaceId, setStatus, active);

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
    const text = [
      '下面是预览里「页面上看不到、只在后台/控制台出现」的失败信息，请据此修复：',
      '',
      ...pendingErrors.slice(-10),
    ].join('\n');
    setPendingErrors([]);
    setComposerSeed((prev) => ({ text, version: (prev?.version ?? 0) + 1 }));
    setChatOpen(true);
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
    setChatOpen(true);
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

  const handleBack = () => {
    closeDevAppTab(tab.id);
  };

  const handleSubmit = async (message: string) => {
    try {
      await pushStoApp(workspaceId, message);
      const nextStatus = await getStoAppStatus(workspaceId).catch(() => null);
      if (nextStatus) setStoStatus(nextStatus);
      await useAppDevCatalogStore.getState().refresh().catch(() => undefined);
      toast.success('已提交到 STO 应用');
      setCommitOpen(false);
      setSourceRevision((n) => n + 1);
    } catch (error) {
      const nextStatus = await getStoAppStatus(workspaceId).catch(() => null);
      if (nextStatus) setStoStatus(nextStatus);
      await useAppDevCatalogStore.getState().refresh().catch(() => undefined);
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

  const commitMode = isTemplateWorkspace || showGitCommit ? 'git' : 'sto';

  const phase = status?.phase ?? 'created';
  const stoStatusTone = stoStatus?.available && stoStatus.bound
    ? stoStatus.syncState === 'merge-required'
      ? 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-300'
      : stoStatus.syncState === 'remote-ahead'
        ? 'border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-900/60 dark:bg-sky-950/30 dark:text-sky-300'
        : stoStatus.syncState === 'local-changes'
          ? 'border-violet-200 bg-violet-50 text-violet-700 dark:border-violet-900/60 dark:bg-violet-950/30 dark:text-violet-300'
          : 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:text-emerald-300'
    : stoCloudPipelineReady && stoStatus?.syncLabel === '待首次提交'
      ? 'border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-900/60 dark:bg-sky-950/30 dark:text-sky-300'
      : 'border-border bg-muted/50 text-muted-foreground';
  const stoStatusLabel = stoStatus?.bound
    ? `STO ${stoStatus.syncLabel}`
    : stoStatus?.syncLabel === '待首次提交'
      ? 'STO 待首次提交'
      : 'STO 未绑定';
  const stoStatusTitle = stoStatus?.bound
    ? `${stoStatus.syncLabel}${stoStatus.appCode ? ` · ${stoStatus.appCode}` : ''}`
    : stoStatus?.syncLabel === '待首次提交'
      ? '尚未注册云端应用，首次提交后将自动注册'
      : '未绑定 STO 应用';

  const isMac = window.electron?.platform === 'darwin';

  const overlay = (
    <div
      className="flex h-full min-h-0 w-full flex-col bg-background"
      data-app-dev-overlay={active ? 'active' : 'inactive'}
    >
      <header
        className={cn(
          'flex shrink-0 items-center gap-3 border-b border-border drag-region',
          isMac
            ? 'h-[var(--sto-header-h)] pl-20 pr-4'
            : 'px-4 py-2.5',
        )}
      >
        <button
          type="button"
          onClick={handleBack}
          className="no-drag inline-flex h-8 items-center gap-1.5 rounded-md px-2 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden />
          返回
        </button>
        <div className="h-4 w-px bg-border" aria-hidden />
        <h1 className="min-w-0 truncate text-sm font-semibold text-foreground">{appName}</h1>
        {isTemplateWorkspace ? (
          <span className="rounded-md bg-violet-500/10 px-2 py-0.5 text-[11px] text-violet-600 dark:text-violet-300">
            应用模板
          </span>
        ) : <AppDevPageTypeBadge pageType={pageType} />}
        <div className="flex-1" />
        <AppDevRunStatusMenu
          phase={phase}
          pending={runPending}
          onStart={() => void startRun()}
          onStop={() => void stopRun()}
          onRestart={() => void restartRun()}
        />

        <div className="no-drag flex items-center gap-1">
          {showCloudActions ? (
            <span
              className={cn(
                'mr-1 inline-flex h-7 items-center rounded-md border px-2 text-[11px]',
                stoStatusTone,
              )}
              title={stoStatusTitle}
            >
              {stoStatusLabel}
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

          {isTemplateWorkspace && gitAvailable ? (
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

          {isTemplateWorkspace ? (
            <BuiltinTemplateDebugControl
              workspaceId={workspaceId}
              onStatusChange={setIsBuiltinTemplateDebug}
              onReloaded={() => setSourceRevision((value) => value + 1)}
            />
          ) : null}

          {isTemplateWorkspace ? (
            <TemplateProjectUploadControl
              workspaceId={workspaceId}
              onApplied={() => {
                setSourceRevision((value) => value + 1);
                toast.success('项目已上传，预览正在刷新');
              }}
            />
          ) : null}

          {isTemplateWorkspace && isBuiltinTemplateDebug === false ? (
            <Button
              type="button"
              size="sm"
              className="h-7 gap-1 px-2 text-xs"
              disabled={templatePublishing}
              onClick={() => setTemplatePublishConfirm(true)}
            >
              <Upload className="h-3.5 w-3.5" aria-hidden />
              {templatePublishing ? '发布中…' : '发布模板'}
            </Button>
          ) : null}

          {showCloudActions ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 gap-1 px-2 text-xs"
              disabled={!stoCloudPipelineReady}
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
              onClick={() => {
                void pullStoApp(workspaceId)
                  .then(async () => {
                    const next = await getStoAppStatus(workspaceId).catch(() => null);
                    if (next) setStoStatus(next);
                    setSourceRevision((n) => n + 1);
                    toast.success('已拉取远端更新');
                  })
                  .catch(async (error) => {
                    const next = await getStoAppStatus(workspaceId).catch(() => null);
                    if (next) setStoStatus(next);
                    toast.error(error instanceof Error ? error.message : '拉取失败');
                  });
              }}
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
              onClick={() => {
                const revisionId = stoStatus.revisionId?.trim();
                if (!revisionId) {
                  toast.error('缺少冲突版本号');
                  return;
                }
                void continueStoAppMerge(workspaceId, revisionId)
                  .then(async () => {
                    const next = await getStoAppStatus(workspaceId).catch(() => null);
                    if (next) setStoStatus(next);
                    setSourceRevision((n) => n + 1);
                    toast.success('已继续合并');
                  })
                  .catch((error) => {
                    toast.error(error instanceof Error ? error.message : '合并继续失败');
                  });
              }}
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
              onPublishMenu={() => setMenuPublishOpen(true)}
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

          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 gap-1 px-2 text-xs"
            title="在独立编辑器窗口打开（代码 + 加宽对话）"
            onClick={() => {
              void openAppDevIdeWindow(workspaceId, appName).catch((error) => {
                toast.error(error instanceof Error ? error.message : '无法打开编辑器');
              });
            }}
          >
            <Code2 className="h-3.5 w-3.5" aria-hidden />
            {ideOwnership.open ? '回到编辑器' : '在编辑器打开'}
          </Button>

          <Button
            type="button"
            variant="ghost"
            size="sm"
            className={cn(
              'h-7 gap-1 px-2 text-xs',
              stageCollapsed && 'bg-muted text-foreground',
            )}
            aria-pressed={stageCollapsed}
            title={stageCollapsed ? '展开工作区' : '收起工作区'}
            onClick={toggleStageCollapsed}
          >
            {stageCollapsed ? (
              <PanelLeftOpen className="h-3.5 w-3.5" aria-hidden />
            ) : (
              <PanelLeftClose className="h-3.5 w-3.5" aria-hidden />
            )}
            {stageCollapsed ? '展开工作区' : '收起工作区'}
          </Button>

          <Button
            type="button"
            variant="ghost"
            size="sm"
            className={cn(
              'h-7 gap-1 px-2 text-xs',
              chatOpen && 'bg-muted text-foreground',
            )}
            aria-pressed={chatOpen}
            title={`AI 会话 (${chatShortcutLabel})`}
            onClick={() => setChatOpen((open) => !open)}
          >
            <MessageCircle className="h-3.5 w-3.5" aria-hidden />
            会话
          </Button>
        </div>
      </header>

      <AppDevSplitBody
        chatOpen={chatOpen}
        stageCollapsed={stageCollapsed}
        chat={
          ideOwnership.open
            ? (
              <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
                <p className="text-sm text-foreground">编程会话已在独立编辑器窗口</p>
                <p className="max-w-[280px] text-xs leading-relaxed text-muted-foreground">
                  广场窗口继续预览即可。点击「回到编辑器」继续改代码。
                </p>
              </div>
            )
            : appDevSessionKey
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
          onCancelSetup={() => void stopRun()}
          onFillComposerFromDiagnostics={handleFillComposerFromDiagnostics}
          sourceRevision={sourceRevision}
          previewRevision={previewRevision}
          canDeploy={canDeploy}
          cloudPush={showCloudActions && !isTemplateWorkspace}
          recordsRevision={sourceRevision + (deploy.history?.[0]?.updatedAt ?? 0)}
          deployRunning={deploy.running}
          deployHistory={deploy.history ?? []}
          onOpenDeploy={() => setDeployOpen(true)}
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
      <TemplatePublishConfirmDialog
        open={templatePublishConfirm}
        onConfirm={async () => {
          setTemplatePublishing(true);
          try {
            const result = await publishAppTemplateWorkspace(workspaceId);
            toast.success(`模板 v${result.version} 已发布`);
            setTemplatePublishConfirm(false);
          } catch (error) {
            toast.error(error instanceof Error ? error.message : '模板发布失败');
          } finally {
            setTemplatePublishing(false);
          }
        }}
        onCancel={() => setTemplatePublishConfirm(false)}
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
        appCode={stoStatus?.appCode}
        onCancel={() => setDeployOpen(false)}
        onConfirm={(input) => {
          setDeployOpen(false);
          deploy.start(input);
        }}
      />
      <StoAppMenuPublishDialog
        open={menuPublishOpen}
        workspaceId={workspaceId}
        appName={appName}
        appCode={stoStatus?.appCode}
        pageType={pageType ?? 'site'}
        onClose={() => setMenuPublishOpen(false)}
      />
    </div>
  );

  return createPortal(
    <div
      className={cn(
        'fixed inset-0 flex flex-col bg-background',
        !active && 'pointer-events-none invisible',
      )}
      style={{ zIndex: active ? 240 : -1 }}
      aria-hidden={!active}
    >
      {overlay}
    </div>,
    document.body,
  );
}
