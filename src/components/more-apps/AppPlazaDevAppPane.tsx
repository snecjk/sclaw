/**
 * AppPlazaDevAppPane — full-window app-dev workbench overlay.
 * Left: project agent chat; Right: preview / Monaco code / file search.
 * Portaled over the entire app shell (including sidebar) while active.
 */
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  AlertCircle,
  ArrowLeft,
  PanelRightClose,
  PanelRightOpen,
  Upload,
} from 'lucide-react';
import { toast } from 'sonner';
import { useChatStore } from '@/stores/chat';
import type { ToolStatus } from '@/stores/chat';
import { getSessionDisplayMessages, useSessionDisplayMessages } from '@/stores/chat/display-selectors';
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
import { AppDevTurnSummaryCard } from '@/components/app-dev/AppDevTurnSummaryCard';
import { AppDevTurnVersionActions } from '@/components/app-dev/AppDevTurnVersionActions';
import { AppDevTunePanel } from '@/components/app-dev/AppDevTunePanel';
import { AppDevArtifactCard } from '@/components/app-dev/AppDevArtifactCard';
import { AppDevPlanCard } from '@/components/app-dev/AppDevPlanCard';
import {
  AppDevSuggestionChips,
  buildFallbackSuggestions,
  extractSclawSuggestions,
} from '@/components/app-dev/AppDevSuggestionChips';
import {
  appDevCompletedToolsSignature,
  classifyAppDevTool,
  isAppDevToolRollupEmpty,
  normalizeAppDevTimestamp,
  resolveAppDevTurnDurationMs,
  resolveAppDevTurnTools,
  rollupAppDevTools,
} from '@/lib/app-dev-tool-rollup';
import { buildTurnCheckpointSubject, excerptUserText } from '@/lib/app-dev-turn-versions';
import {
  buildPlanConfirmPrompt,
  extractSclawPlan,
  extractSclawStyles,
  shouldTriggerPlanGate,
  wrapUserTextForPlanGate,
  buildPlanFirstPrompt,
  stripPlanGatePromptForDisplay,
} from '@/lib/app-dev-plan-gate';
import {
  RESPONSIVE_AUDIT_SCRIPT,
  buildResponsiveFixPrompt,
  type AppDevResponsiveAuditResult,
} from '@/lib/app-dev-responsive-audit';
import {
  buildFollowUpQuestion,
  getAppDevTurnRating,
  setAppDevTurnRating,
  type AppDevTurnRating,
} from '@/lib/app-dev-turn-feedback';
import { useAppDevVersionRestore } from '@/hooks/use-app-dev-version-restore';
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
import { StoAppConflictDialog } from '@/components/app-dev/StoAppConflictDialog';
import { StoAppDeployControl } from '@/components/app-dev/StoAppDeployControl';
import { StoAppDeployDialog } from '@/components/app-dev/StoAppDeployDialog';
import { StoAppDeployHistoryDialog } from '@/components/app-dev/StoAppDeployHistoryDialog';
import { StoAppMenuPublishDialog } from '@/components/app-dev/StoAppMenuPublishDialog';
import { AppDevPageTypeBadge } from '@/components/app-dev/AppDevPageTypeBadge';
import { useAppDevCatalogStore } from '@/stores/app-dev-catalog';
import { useAppDevVersionsStore } from '@/stores/app-dev-versions';
import { useAppDevWorkbenchStore } from '@/stores/app-dev-workbench';
import { sendAppDevChatPrompt } from '@/lib/send-app-dev-chat-prompt';
import {
  buildElementIntentPrompt,
  type AppDevPickedElement,
} from '@/lib/app-dev-element-intent';
import {
  createAppCheckpoint,
  continueStoAppMerge,
  captureAppPreview,
  drainAppErrors,
  getAppDevEnvironment,
  getAppRuntimeStatus,
  consumeAppRuntimeEscalate,
  restartAppBackend,
  runAppRuntimeSmoke,
  getStoAppStatus,
  listStoAppConflicts,
  pullStoApp,
  publishAppTemplateWorkspace,
  resolveStoAppConflict,
  type StoAppConflictFile,
  type StoAppStatus,
  type AppDevStatus,
} from '@/lib/app-dev-api';
import { pullToastMessage } from '../../../shared/site-app-source-merge';
import { submitStoAppWithAutoPull } from '@/lib/sto-app-submit';
import { revealAppDevSourceFile } from '@/lib/app-dev-reveal-source';
import { buildStoAppConflictAiPrompt } from '@/lib/sto-app-conflict-prompt';
import { useStoAppDeploy } from '@/hooks/use-sto-app-deploy';
import { useAppDevRunControl } from '@/hooks/use-app-dev-run-control';
import { useAppDevStatusPoll } from '@/hooks/use-app-dev-status-poll';
import {
  type AppPlazaDevAppTab,
  useAppPlazaShellStore,
} from '@/stores/app-plaza-shell';
import { useAppDevArtifactsStore } from '@/stores/app-dev-artifacts';
import { shouldShowGitCommitAction, shouldShowStoCloudActions, canUseStoCloudPipeline } from '@/lib/app-dev-actions';
import { useAppDevChatSession } from '@/hooks/use-app-dev-chat-session';
import { AppDevCodeFollow } from '@/hooks/use-app-dev-code-follow';
import { useAppDevIdeOwnership } from '@/hooks/use-app-dev-ide-ownership';

const CAPTURED_TURN_SUMMARY_LIMIT = 30;

type AssistantTurnDisplayItem = Extract<ChatDisplayItem, { type: 'assistant-turn' }>;

interface CapturedTurnSummary {
  tools: ToolStatus[];
  durationMs: number | null;
  interrupted: boolean;
}

const WorkbenchChatPane = memo(function WorkbenchChatPane({
  sessionKey,
  workspaceId,
  appName,
  composerSeed,
  onBeforeSend,
  onEditMessage,
  onOpenPreview,
  onOpenPublish,
  onPickSuggestion,
  auditsByTurn,
  onFixResponsive,
}: {
  sessionKey: string;
  workspaceId: string;
  appName: string;
  composerSeed?: { text: string; version: number } | null;
  onBeforeSend?: (text: string) => boolean | string | void;
  /** T05：用户消息「编辑重发」——点击后由外层把文本回填 composer */
  onEditMessage?: (text: string) => void;
  onOpenPreview?: () => void;
  onOpenPublish?: () => void;
  onPickSuggestion?: (prompt: string) => void;
  auditsByTurn?: Record<string, AppDevResponsiveAuditResult>;
  onFixResponsive?: (result: AppDevResponsiveAuditResult) => void;
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
    phase,
  });

  // ── T02 生成过程可视化 ──

  // 工具聚合：streamingTools 高频更新，按 completed 子集签名 memo，避免每 token 全量重算
  const rollupSig = appDevCompletedToolsSignature(streamingTools);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const toolRollup = useMemo(() => rollupAppDevTools(streamingTools), [rollupSig]);

  // 轮结束快照：汇总卡的中断标记 / 耗时 / 工具清单在轮结束瞬间捕获，
  // 静态列表 remount（transcript 接管）后仍可对齐到同一 turnKey
  const capturedSummariesRef = useRef<Map<string, CapturedTurnSummary>>(new Map());
  const prevSendingRef = useRef(sending);
  const abortingSeenRef = useRef(false);
  const liveTurnSnapshotRef = useRef<{
    turnKey: string | null;
    tools: ToolStatus[];
    anchorAt: number | null;
    precedingUserMessage: AssistantTurnDisplayItem['precedingUserMessage'] | null;
  }>({ turnKey: null, tools: [], anchorAt: null, precedingUserMessage: null });
  const activeTurnStableKey = activeTurn?.turnStableKey ?? null;
  const activeTurnPrecedingUserMessage = activeTurn?.precedingUserMessage ?? null;

  // 生成中持续记录最新快照（ref 写入放在 effect，避免渲染期副作用）
  useEffect(() => {
    if (!sending) return;
    if (phase === 'aborting') abortingSeenRef.current = true;
    liveTurnSnapshotRef.current = {
      turnKey: activeTurnStableKey ?? liveTurnSnapshotRef.current.turnKey,
      tools: streamingTools,
      anchorAt: turnAnchorAt,
      precedingUserMessage: activeTurnPrecedingUserMessage
        ?? liveTurnSnapshotRef.current.precedingUserMessage,
    };
  }, [sending, phase, activeTurnStableKey, streamingTools, turnAnchorAt, activeTurnPrecedingUserMessage]);

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
      // T04：登记 pending 轮次（turnKey + 用户消息摘要），outer pane 建完
      // checkpoint 后按 FIFO 补 hash 落 turn↔commit 映射；中断轮同样登记。
      useAppDevVersionsStore.getState().recordPendingTurn(workspaceId, {
        turnKey: snapshot.turnKey,
        userTextExcerpt: excerptUserText(
          snapshot.precedingUserMessage ? extractText(snapshot.precedingUserMessage) : '',
        ),
        endedAt: Date.now(),
      });
      abortingSeenRef.current = false;
    }
    prevSendingRef.current = sending;
  }, [sending, workspaceId]);

  // 轮次汇总卡注入（ChatStaticItemsList renderTurnFooter；T04 操作按钮 / T09 产物卡亦经此挂载）
  const artifactsByWorkspace = useAppDevArtifactsStore((s) => s.byWorkspace[workspaceId]);
  const toggleFavorite = useAppDevArtifactsStore((s) => s.toggleFavorite);
  const [dismissedPlans, setDismissedPlans] = useState<Record<string, true>>({});
  const [ratings, setRatings] = useState<Record<string, AppDevTurnRating>>({});

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
    const assistantText = item.messages.map((m) => extractText(m)).join('\n');
    const plan = extractSclawPlan(assistantText);
    const stylePresets = extractSclawStyles(assistantText);
    const audit = auditsByTurn?.[item.key] ?? null;
    if (tools.length === 0 && !captured?.interrupted && !plan && !audit) return null;
    const durationMs = captured?.durationMs ?? resolveAppDevTurnDurationMs({
      tools,
      anchorAt: normalizeAppDevTimestamp(item.precedingUserMessage?.timestamp),
      endedAt: normalizeAppDevTimestamp(item.messages[item.messages.length - 1]?.timestamp),
    });
    const artifact = (artifactsByWorkspace ?? []).find((x) => x.turnKey === item.key) ?? null;
    const fromAgent = extractSclawSuggestions(assistantText);
    const suggestions = fromAgent.length > 0
      ? fromAgent
      : (artifact?.suggestions ?? []);
    const hasFileOps = tools.some((tool) => classifyAppDevTool(tool.name) === 'file');
    const showPlan = Boolean(plan && !hasFileOps && !dismissedPlans[item.key]);
    const followUp = buildFollowUpQuestion(suggestions[0]?.label);
    const rating = ratings[item.key] ?? getAppDevTurnRating(workspaceId, item.key);

    return (
      <div className="mt-2 space-y-0">
        {showPlan && plan ? (
          <AppDevPlanCard
            key={item.key}
            plan={plan}
            stylePresets={stylePresets}
            onDismiss={() => setDismissedPlans((prev) => ({ ...prev, [item.key]: true }))}
            onConfirm={(next, style) => {
              setDismissedPlans((prev) => ({ ...prev, [item.key]: true }));
              const prompt = buildPlanConfirmPrompt(next, { style });
              onPickSuggestion?.(prompt);
              void useChatStore.getState().sendMessage({
                text: prompt,
                sessionKey,
              }).catch(() => undefined);
            }}
          />
        ) : null}
        {(tools.length > 0 || captured?.interrupted) ? (
          <AppDevTurnSummaryCard
            tools={tools}
            durationMs={durationMs}
            interrupted={captured?.interrupted ?? false}
            responsiveAudit={audit}
            onFixResponsive={audit && !audit.ok && onFixResponsive
              ? () => onFixResponsive(audit)
              : undefined}
            followUpQuestion={followUp}
            rating={rating}
            onRate={(next) => {
              setAppDevTurnRating(workspaceId, item.key, next);
              setRatings((prev) => ({ ...prev, [item.key]: next }));
            }}
            actions={(
              <AppDevTurnVersionActions
                workspaceId={workspaceId}
                turnKey={item.key}
                turnEndedAt={normalizeAppDevTimestamp(item.messages[item.messages.length - 1]?.timestamp)}
              />
            )}
          />
        ) : null}
        {artifact ? (
          <AppDevArtifactCard
            artifact={artifact}
            onOpenPreview={() => onOpenPreview?.()}
            onPublish={onOpenPublish}
            onToggleFavorite={() => void toggleFavorite(workspaceId, artifact.id)}
          />
        ) : null}
        {suggestions.length > 0 ? (
          <AppDevSuggestionChips
            suggestions={suggestions}
            onPick={(prompt) => onPickSuggestion?.(prompt)}
          />
        ) : null}
      </div>
    );
  }, [
    sessionKey,
    workspaceId,
    engineType,
    artifactsByWorkspace,
    toggleFavorite,
    onOpenPreview,
    onOpenPublish,
    onPickSuggestion,
    auditsByTurn,
    onFixResponsive,
    dismissedPlans,
    ratings,
  ]);

  const priorUserMessageCount = useMemo(
    () => messages.filter((m) => m.role === 'user').length,
    [messages],
  );

  const handleBeforeSend = useCallback((text: string): boolean | string => {
    if (onBeforeSend?.(text) === true) return true;
    const wrapped = wrapUserTextForPlanGate({
      userText: text,
      priorUserMessageCount,
    });
    return wrapped ?? false;
  }, [onBeforeSend, priorUserMessageCount]);

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
                onEditMessage={onEditMessage}
                enableEditMessage
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
        <AppDevComposer
          key={composerSeed ? `seed-${composerSeed.version}` : 'composer'}
          seedText={composerSeed?.text}
          onBeforeSend={handleBeforeSend}
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
  const [gitAvailable, setGitAvailable] = useState(false);
  const stageCollapsed = useAppDevWorkbenchStore((s) => s.stageCollapsed);
  const toggleStageCollapsed = useAppDevWorkbenchStore((s) => s.toggleStageCollapsed);
  const tuneMode = useAppDevWorkbenchStore((s) => s.tuneMode);
  const setTuneMode = useAppDevWorkbenchStore((s) => s.setTuneMode);
  const inspectActive = useAppDevWorkbenchStore((s) => s.inspectActive);
  const setInspectActive = useAppDevWorkbenchStore((s) => s.setInspectActive);
  const setMode = useAppDevWorkbenchStore((s) => s.setMode);
  const device = useAppDevWorkbenchStore((s) => s.device);
  const [previewBridge, setPreviewBridge] = useState<{
    executeJS: (code: string) => Promise<unknown>;
    getWebContentsId: () => number | null;
  } | null>(null);
  const [tunePickedElements, setTunePickedElements] = useState<AppDevPickedElement[]>([]);
  const [auditsByTurn, setAuditsByTurn] = useState<Record<string, AppDevResponsiveAuditResult>>({});
  const [stoStatus, setStoStatus] = useState<StoAppStatus | null>(null);
  const [commitOpen, setCommitOpen] = useState(false);
  const [conflictOpen, setConflictOpen] = useState(false);
  const [conflicts, setConflicts] = useState<StoAppConflictFile[]>([]);
  const [conflictBusyPath, setConflictBusyPath] = useState<string | null>(null);
  const [conflictAskingAi, setConflictAskingAi] = useState(false);
  const [mergeContinuing, setMergeContinuing] = useState(false);
  const [deployOpen, setDeployOpen] = useState(false);
  const [menuPublishOpen, setMenuPublishOpen] = useState(false);
  const [deployHistoryOpen, setDeployHistoryOpen] = useState(false);
  const [initialDeploymentId, setInitialDeploymentId] = useState<string>();
  const [templatePublishConfirm, setTemplatePublishConfirm] = useState(false);
  const [templatePublishing, setTemplatePublishing] = useState(false);
  const [sourceRevision, setSourceRevision] = useState(0);
  const [isBuiltinTemplateDebug, setIsBuiltinTemplateDebug] = useState<boolean | null>(null);
  const [statusWorkspaceId, setStatusWorkspaceId] = useState(workspaceId);
  const prevSendingRef = useRef(false);
  /** True after auto-heal injected a repair turn; success toast only when this clears via smoke.ok. */
  const healPendingRef = useRef(false);
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
  const clearDevAppPendingPrompt = useAppPlazaShellStore((s) => s.clearDevAppPendingPrompt);

  useEffect(() => {
    setInspectActive(false);
  }, [workspaceId, setInspectActive]);

  // P5 W2-1：对话式创建后自动发送首条。气泡用原文，模型侧强制走 Plan 闸门。
  useEffect(() => {
    const prompt = stripPlanGatePromptForDisplay(tab.pendingPrompt ?? '').trim();
    if (!active || !prompt || !appDevSessionKey || sending) return;
    clearDevAppPendingPrompt(tab.id);
    setTuneMode('chat');
    setComposerSeed((prev) => ({ text: prompt, version: (prev?.version ?? 0) + 1 }));
    void useChatStore.getState().sendMessage({
      text: prompt,
      sessionKey: appDevSessionKey,
      gatewayText: buildPlanFirstPrompt(prompt),
    }).catch((error) => {
      toast.error(error instanceof Error ? error.message : String(error));
    });
  }, [
    active,
    tab.id,
    tab.pendingPrompt,
    appDevSessionKey,
    sending,
    clearDevAppPendingPrompt,
    setTuneMode,
  ]);
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
    },
    onSuccess: () => setMenuPublishOpen(true),
    onStatusRefresh: async () => {
      const next = await getStoAppStatus(workspaceId).catch(() => null);
      if (next) setStoStatus(next);
      await useAppDevCatalogStore.getState().refresh().catch(() => undefined);
    },
  });

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

  // DoD-3：后端 escalate → 自动发修复回合（业务用户零操作）
  useEffect(() => {
    if (!active || !workspaceId || !appDevSessionKey || sending) return;
    let cancelled = false;
    const tick = async () => {
      const runtime = await getAppRuntimeStatus(workspaceId).catch(() => null);
      if (cancelled || !runtime?.status.escalateNeeded) return;
      const escalate = await consumeAppRuntimeEscalate(workspaceId).catch(() => null);
      if (cancelled || !escalate) return;
      if (escalate.melted) {
        healPendingRef.current = false;
        toast.error('还没修好，你可以直接再说一句需求继续让我修');
        return;
      }
      if (!escalate.prompt) return;
      healPendingRef.current = true;
      toast.message('出了点问题，正在自动修复…');
      setComposerSeed((prev) => ({
        text: escalate.prompt!,
        version: (prev?.version ?? 0) + 1,
      }));
      try {
        await useChatStore.getState().sendMessage({
          text: escalate.prompt,
          sessionKey: appDevSessionKey,
        });
      } catch {
        healPendingRef.current = false;
        toast.error('自动修复未能发出，请再说一句「帮我修一下后端」');
      }
    };
    const timer = setInterval(() => { void tick(); }, 4000);
    void tick();
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [active, workspaceId, appDevSessionKey, sending]);

  useEffect(() => {
    if (!workspaceId) return;
    void useAppDevArtifactsStore.getState().load(workspaceId).catch(() => undefined);
  }, [workspaceId]);

  const parseResponsiveAudit = useCallback((raw: unknown): AppDevResponsiveAuditResult | null => {
    let value: unknown = raw;
    if (typeof raw === 'string') {
      try {
        value = JSON.parse(raw);
      } catch {
        return null;
      }
    }
    if (!value || typeof value !== 'object') return null;
    const obj = value as Partial<AppDevResponsiveAuditResult>;
    if (typeof obj.ok !== 'boolean') return null;
    return {
      ok: obj.ok,
      hasViewport: Boolean(obj.hasViewport),
      docOverflow: Boolean(obj.docOverflow),
      overflowCount: typeof obj.overflowCount === 'number' ? obj.overflowCount : 0,
      topOverflows: Array.isArray(obj.topOverflows)
        ? obj.topOverflows.filter((item): item is AppDevResponsiveAuditResult['topOverflows'][number] => (
          Boolean(item)
          && typeof item === 'object'
          && typeof (item as { selector?: unknown }).selector === 'string'
        ))
        : [],
    };
  }, []);

  const runResponsiveAudit = useCallback(async (turnKey: string | null) => {
    if (!previewBridge || !turnKey) return;
    try {
      const raw = await previewBridge.executeJS(RESPONSIVE_AUDIT_SCRIPT);
      const result = parseResponsiveAudit(raw);
      if (!result) return;
      setAuditsByTurn((prev) => ({ ...prev, [turnKey]: result }));
    } catch {
      // preview 未就绪时忽略
    }
  }, [previewBridge, parseResponsiveAudit]);

  // T11：切到移动端预览时立刻体检，结果挂到最近一轮。
  useEffect(() => {
    if (device !== 'mobile' || !previewBridge) return;
    const pending = useAppDevVersionsStore.getState().peekPendingTurn(workspaceId);
    const versions = useAppDevVersionsStore.getState().versionsByWorkspace[workspaceId] ?? {};
    const latestTurnKey = pending?.turnKey
      ?? Object.entries(versions).sort((a, b) => b[1].turnEndedAt - a[1].turnEndedAt)[0]?.[0]
      ?? null;
    void runResponsiveAudit(latestTurnKey);
  }, [device, previewBridge, workspaceId, runResponsiveAudit]);

  useEffect(() => {
    if (prevSendingRef.current && !sending && workspaceId) {
      void (async () => {
        // T04：checkpoint subject 带用户消息摘要；hash 回传后补全 turn↔commit 映射。
        // pending 队列由 WorkbenchChatPane 轮结束 effect 登记（子组件 effect 先于本 effect），
        // created 与 clean-head/failed 两条路径都精确消费队首一个，保证多轮 FIFO 不错位。
        const versionsStore = useAppDevVersionsStore.getState();
        const pending = versionsStore.peekPendingTurn(workspaceId);
        const subject = buildTurnCheckpointSubject(pending?.userTextExcerpt);
        const result = await createAppCheckpoint(workspaceId, subject).catch(() => null);
        if (result?.created && result.hash) {
          versionsStore.completePendingTurn(workspaceId, { hash: result.hash, subject });
        } else {
          versionsStore.discardPendingTurn(workspaceId);
        }

        // T09：轮结束截图 + 产物卡（失败降级无缩略图；建议 chips 在 footer 再解析助手文本）
        if (pending?.turnKey) {
          const webContentsId = previewBridge?.getWebContentsId() ?? null;
          let thumbnailDataUrl: string | undefined;
          if (webContentsId) {
            await new Promise((r) => setTimeout(r, 800));
            const shot = await captureAppPreview(workspaceId, webContentsId).catch(() => null);
            thumbnailDataUrl = shot?.dataUrl;
          }
          const title = (pending.userTextExcerpt || '本轮产物').slice(0, 12);
          void useAppDevArtifactsStore.getState().upsert(workspaceId, {
            id: `${pending.turnKey}-${Date.now()}`,
            turnKey: pending.turnKey,
            commitHash: result?.hash,
            title,
            thumbnailDataUrl,
            previewUrl: status?.previewUrl,
            createdAt: new Date().toISOString(),
            favorite: false,
            suggestions: buildFallbackSuggestions({
              changedStyles: /style|css|theme|颜色|样式|配色/i.test(title),
              changedData: /接口|数据|列表|查询|api/i.test(title),
            }),
          });

          // T11：轮结束响应式体检（mobile 设备或任意轮次均跑，结果挂汇总卡）
          await runResponsiveAudit(pending.turnKey);
        }

        const errors = await drainAppErrors(workspaceId).catch(() => [] as string[]);
        if (errors.length > 0) setPendingErrors(errors);
        setSourceRevision((n) => n + 1);

        // 全栈：回合结束后重启后端 + smoke。仅在自愈链路中提示「已修好」；失败再自动塞修复回合。
        const runtime = await getAppRuntimeStatus(workspaceId).catch(() => null);
        if (runtime?.fullstack) {
          try {
            await restartAppBackend(workspaceId);
            const smoke = await runAppRuntimeSmoke(workspaceId);
            if (smoke.ok) {
              if (healPendingRef.current) {
                healPendingRef.current = false;
                toast.success('已修好，可以继续用');
              }
            } else if (smoke.prompt) {
              healPendingRef.current = true;
              toast.message('复检未通过，继续自动修复…');
              setComposerSeed((prev) => ({
                text: smoke.prompt!,
                version: (prev?.version ?? 0) + 1,
              }));
              if (appDevSessionKey) {
                void useChatStore.getState().sendMessage({
                  text: smoke.prompt,
                  sessionKey: appDevSessionKey,
                }).catch(() => {
                  healPendingRef.current = false;
                });
              }
            }
          } catch {
            // ignore — escalate poll will pick up hard crashes
          }
        }
      })();
    }
    prevSendingRef.current = sending;
  }, [sending, workspaceId, previewBridge, status?.previewUrl, runResponsiveAudit, appDevSessionKey]);

  const handleFixErrors = useCallback(() => {
    const text = [
      '下面是预览里「页面上看不到、只在后台/控制台出现」的失败信息，请据此修复：',
      '',
      ...pendingErrors.slice(-10),
    ].join('\n');
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

  const handleSubmitElementIntent = useCallback(async (
    intent: string,
    elements: AppDevPickedElement[],
  ) => {
    const trimmed = intent.trim();
    if (!trimmed || !appDevSessionKey) return;
    if (interceptRestartIntent(trimmed)) return;
    setTuneMode('chat');
    const packed = buildElementIntentPrompt(trimmed, elements);
    const priorUserMessageCount = getSessionDisplayMessages(appDevSessionKey)
      .filter((message) => message.role === 'user').length;
    const gatewayText = shouldTriggerPlanGate({ userText: trimmed, priorUserMessageCount })
      ? buildPlanFirstPrompt(packed)
      : undefined;
    try {
      await sendAppDevChatPrompt(appDevSessionKey, packed, gatewayText ? { gatewayText } : undefined);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    }
  }, [appDevSessionKey, interceptRestartIntent, setTuneMode]);

  // T05：用户消息「编辑重发」——点击编辑后回填 composer（复用 composerSeed），
  // 用户改完手动发送，即作为新一轮对话发出（不截断历史，与主会话 handleEditMessage 语义一致）
  const handleEditMessage = useCallback((text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    setComposerSeed((prev) => ({ text: trimmed, version: (prev?.version ?? 0) + 1 }));
  }, []);

  // T04：消息级「恢复版本」——汇总卡按钮 → store 请求 → 二次确认 → 回滚 + 刷新。
  const versionRestore = useAppDevVersionRestore({
    workspaceId,
    onRestored: () => setSourceRevision((n) => n + 1),
  });

  const handleBack = () => {
    closeDevAppTab(tab.id);
  };

  const handleSubmit = async (message: string) => {
    if (stoStatus?.syncState === 'merge-required' && (stoStatus.conflicts?.length || conflicts.length)) {
      toast.error('还有未解决的冲突，无法提交');
      setConflicts(stoStatus.conflicts?.length ? stoStatus.conflicts : conflicts);
      setConflictOpen(true);
      return;
    }
    const outcome = await submitStoAppWithAutoPull(workspaceId, message);
    if (outcome.status) setStoStatus(outcome.status);
    await useAppDevCatalogStore.getState().refresh().catch(() => undefined);
    setSourceRevision((n) => n + 1);

    if (outcome.kind === 'submitted') {
      if (outcome.pulledAction === 'merged' || outcome.pulledAction === 'applied') {
        toast.success('已同步远端并提交到 STO 应用');
      } else {
        toast.success('已提交到 STO 应用');
      }
      setCommitOpen(false);
      setConflicts([]);
      return;
    }

    if (outcome.kind === 'conflicts') {
      setConflicts(outcome.conflicts);
      setConflictOpen(true);
      setCommitOpen(false);
      toast.message(outcome.message);
      return;
    }

    toast.error(outcome.message);
  };

  const handleGitSubmit = async (message: string) => {
    try {
      const { created } = await createAppCheckpoint(workspaceId, message);
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

  const refreshConflicts = useCallback(async () => {
    const items = await listStoAppConflicts(workspaceId).catch(() => [] as StoAppConflictFile[]);
    setConflicts(items);
    return items;
  }, [workspaceId]);

  const handlePull = async () => {
    try {
      const result = await pullStoApp(workspaceId);
      const nextStatus = await getStoAppStatus(workspaceId).catch(() => null);
      if (nextStatus) setStoStatus(nextStatus);
      setSourceRevision((n) => n + 1);
      const action = result.json && typeof result.json === 'object'
        ? (result.json as { action?: string; conflicts?: StoAppConflictFile[] }).action
        : undefined;
      const nextConflicts = result.json && typeof result.json === 'object'
        ? (result.json as { conflicts?: StoAppConflictFile[] }).conflicts
        : undefined;
      if (action === 'conflicts') {
        const items = nextConflicts ?? await refreshConflicts();
        setConflicts(items);
        setConflictOpen(true);
      } else if (nextStatus?.syncState === 'merge-required') {
        await refreshConflicts();
        setConflictOpen(true);
      }
      const toastInfo = pullToastMessage(action, nextConflicts?.length ?? conflicts.length);
      if (toastInfo.kind === 'message') toast.message(toastInfo.text);
      else toast.success(toastInfo.text);
    } catch (error) {
      const nextStatus = await getStoAppStatus(workspaceId).catch(() => null);
      if (nextStatus) setStoStatus(nextStatus);
      toast.error(error instanceof Error ? error.message : '拉取失败');
    }
  };

  const handleMergeContinue = async () => {
    const revisionId = (
      stoStatus?.mergeTheirsRevisionId
      ?? stoStatus?.remoteRevisionId
      ?? stoStatus?.revisionId
      ?? ''
    ).trim();
    if (!revisionId) {
      toast.error('缺少冲突版本号，请先拉取远端更新');
      return;
    }
    setMergeContinuing(true);
    try {
      await continueStoAppMerge(workspaceId, revisionId);
      const nextStatus = await getStoAppStatus(workspaceId).catch(() => null);
      if (nextStatus) setStoStatus(nextStatus);
      setConflicts([]);
      setConflictOpen(false);
      setSourceRevision((n) => n + 1);
      toast.success('冲突已处理，可以提交');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '合并继续失败');
      await refreshConflicts().catch(() => undefined);
    } finally {
      setMergeContinuing(false);
    }
  };

  const handleResolveConflict = async (path: string, choice: 'ours' | 'theirs') => {
    setConflictBusyPath(path);
    try {
      const remaining = await resolveStoAppConflict(workspaceId, path, choice);
      setConflicts(remaining);
      const nextStatus = await getStoAppStatus(workspaceId).catch(() => null);
      if (nextStatus) setStoStatus(nextStatus);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '处理冲突失败');
    } finally {
      setConflictBusyPath(null);
    }
  };

  const handleOpenConflictFile = useCallback((path: string) => {
    revealAppDevSourceFile(path);
    setConflictOpen(false);
  }, []);

  const handleAskAiForConflicts = useCallback(async (paths: string[]) => {
    const prompt = buildStoAppConflictAiPrompt(paths);
    const first = paths.find((path) => path.trim());
    if (first) revealAppDevSourceFile(first);
    setTuneMode('chat');
    setConflictOpen(false);
    setComposerSeed((prev) => ({ text: prompt, version: (prev?.version ?? 0) + 1 }));
    setConflictAskingAi(true);
    try {
      const sent = await sendAppDevChatPrompt(appDevSessionKey, prompt);
      if (!sent) toast.message('已写入输入框，请确认后发送');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '提交给 AI 失败');
    } finally {
      setConflictAskingAi(false);
    }
  }, [appDevSessionKey, setTuneMode]);

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
      <AppDevCodeFollow sessionKey={appDevSessionKey} />
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
              title="提交前会自动拉取远端并检查冲突"
              onClick={() => setCommitOpen(true)}
            >
              提交
            </Button>
          ) : null}

          {showCloudActions && stoStatus?.bound ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 gap-1 px-2 text-xs"
              title="手动拉取远端最新代码"
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
              onClick={() => {
                void refreshConflicts().then((items) => {
                  setConflicts(items.length ? items : stoStatus.conflicts ?? []);
                  setConflictOpen(true);
                });
              }}
            >
              处理冲突
            </Button>
          ) : null}

          {showCloudActions && stoStatus?.bound && stoStatus.syncState === 'merge-required' ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 gap-1 px-2 text-xs"
              disabled={!(stoStatus.mergeTheirsRevisionId || stoStatus.remoteRevisionId || stoStatus.revisionId)}
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
              onPublishMenu={() => setMenuPublishOpen(true)}
              onOpenHistory={() => {
                setInitialDeploymentId(undefined);
                setDeployHistoryOpen(true);
              }}
            />
          ) : null}

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
              <PanelRightOpen className="h-3.5 w-3.5" aria-hidden />
            ) : (
              <PanelRightClose className="h-3.5 w-3.5" aria-hidden />
            )}
            {stageCollapsed ? '展开工作区' : '收起工作区'}
          </Button>
        </div>
      </header>

      <AppDevSplitBody
        stageCollapsed={stageCollapsed}
        chat={
          ideOwnership.open
            ? (
              <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
                <p className="text-sm text-foreground">编程会话已在独立编辑器窗口</p>
                <p className="max-w-[280px] text-xs leading-relaxed text-muted-foreground">
                  广场窗口继续预览即可。请在独立编辑器窗口继续改代码。
                </p>
              </div>
            )
            : tuneMode === 'tune'
            ? (
              <AppDevTunePanel
                workspaceId={workspaceId}
                executeJS={previewBridge ? (code) => previewBridge.executeJS(code) : null}
                pickedElements={tunePickedElements}
                onClose={() => setTuneMode('chat')}
                onPersisted={() => setSourceRevision((n) => n + 1)}
              />
            )
            : appDevSessionKey
            ? (
              <WorkbenchChatPane
                sessionKey={appDevSessionKey}
                workspaceId={workspaceId}
                appName={appName}
                composerSeed={composerSeed}
                onBeforeSend={interceptRestartIntent}
                onEditMessage={handleEditMessage}
                onOpenPreview={() => {
                  setMode('preview');
                  setTuneMode('chat');
                }}
                onOpenPublish={canDeploy ? () => setDeployOpen(true) : undefined}
                onPickSuggestion={(prompt) => {
                  setComposerSeed((prev) => ({ text: prompt, version: (prev?.version ?? 0) + 1 }));
                  setTuneMode('chat');
                }}
                auditsByTurn={auditsByTurn}
                onFixResponsive={(audit) => {
                  setComposerSeed((prev) => ({
                    text: buildResponsiveFixPrompt(audit),
                    version: (prev?.version ?? 0) + 1,
                  }));
                  setTuneMode('chat');
                }}
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
          onPreviewBridgeChange={setPreviewBridge}
          onOpenTune={() => {
            if (tuneMode === 'tune') {
              setTuneMode('chat');
              return;
            }
            setTuneMode('tune');
          }}
          tuneActive={tuneMode === 'tune'}
          onToggleInspect={() => {
            const next = !inspectActive;
            setInspectActive(next);
          }}
          inspectActive={inspectActive}
          onSubmitElementIntent={handleSubmitElementIntent}
          onPickedElementsChange={setTunePickedElements}
          sourceRevision={sourceRevision}
          previewRevision={previewRevision}
          canDeploy={canDeploy}
          cloudPush={showCloudActions && !isTemplateWorkspace}
          recordsRevision={sourceRevision + (deploy.history?.[0]?.updatedAt ?? 0)}
          deployRunning={deploy.running}
          deployHistory={deploy.history ?? []}
          onOpenDeploy={() => setDeployOpen(true)}
          onOpenDeployHistory={(deploymentId) => {
            setInitialDeploymentId(deploymentId);
            setDeployHistoryOpen(true);
          }}
        />
      </AppDevSplitBody>

      <ConfirmDialog
        open={versionRestore.target != null}
        title="恢复版本"
        message={`将把应用恢复到该轮对话结束时的版本（${versionRestore.target?.label ?? ''}）。当前未提交的改动会自动备份，可以放心恢复。`}
        confirmLabel="恢复"
        confirmingLabel="恢复中…"
        variant="destructive"
        onConfirm={versionRestore.confirm}
        onCancel={versionRestore.cancel}
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
        initialMessage={
          commitMode === 'git'
            ? `更新: ${appName}`
            : stoStatus?.syncState === 'local-changes'
              ? '合并远端更新'
              : `更新应用: ${appName}`
        }
        onCancel={() => setCommitOpen(false)}
        onConfirm={commitMode === 'git' ? handleGitSubmit : handleSubmit}
      />
      <StoAppConflictDialog
        open={conflictOpen}
        conflicts={conflicts.length ? conflicts : stoStatus?.conflicts ?? []}
        busyPath={conflictBusyPath}
        continuing={mergeContinuing}
        askingAi={conflictAskingAi}
        onClose={() => setConflictOpen(false)}
        onOpenFile={handleOpenConflictFile}
        onAskAi={handleAskAiForConflicts}
        onResolve={handleResolveConflict}
        onContinue={handleMergeContinue}
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
      <StoAppDeployHistoryDialog
        open={deployHistoryOpen}
        workspaceId={workspaceId}
        appCode={stoStatus?.appCode}
        history={deploy.history ?? []}
        initialDeploymentId={initialDeploymentId}
        onOpenChange={setDeployHistoryOpen}
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
