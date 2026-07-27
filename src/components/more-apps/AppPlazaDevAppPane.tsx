/**
 * AppPlazaDevAppPane — dev-app workbench embedded as a tab pane in AppPlazaShell.
 * Left: project agent chat; Right: live preview (collapsible).
 */
import { useEffect, useRef, useState } from 'react';
import {
  AlertCircle,
  Code2,
  ExternalLink,
  History,
  Loader2,
  PanelRightOpen,
  RotateCw,
  Wand2,
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
import { SclawBrowserFrame } from '@/components/sclaw-browser/SclawBrowserFrame';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Progress } from '@/components/ui/progress';
import { cn } from '@/lib/utils';
import {
  stoChatColumnContentTrackClass,
  stoChatScrollContentClass,
  stoChatScrollPaneClass,
} from '@/lib/surfaces';
import { openExternalUrl } from '@/lib/preview-url';
import {
  createAppCheckpoint,
  drainAppErrors,
  ensureAppDevContext,
  getAppDevEnvironment,
  getAppStatus,
  restoreAppCheckpoint,
  startApp,
  type AppDevStatus,
} from '@/lib/app-dev-api';
import type { AppPlazaDevAppTab } from '@/stores/app-plaza-shell';
import { useAppPlazaShellStore } from '@/stores/app-plaza-shell';

const PHASE_LABELS: Record<string, string> = {
  'created': '正在准备运行环境…',
  'preparing-env': '正在准备运行环境…',
  'installing': '正在安装应用组件…',
  'starting': '正在启动应用…',
  'ready': '运行中',
  'stopped': '已停止',
  'error': '出了点问题',
};

function WorkbenchChatPane({ sessionKey, appName }: { sessionKey: string; appName: string }) {
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
                已自动了解本应用的项目结构与接口文档位置。直接描述需求即可，比如"首页加一个按单号查询的搜索框"。
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
        <HomeComposer showDisclaimer={false} footerAlign="center" />
      </div>
    </div>
  );
}

interface AppPlazaDevAppPaneProps {
  tab: AppPlazaDevAppTab;
  active: boolean;
}

export function AppPlazaDevAppPane({ tab, active }: AppPlazaDevAppPaneProps) {
  const workspaceId = tab.workspaceId;
  const [status, setStatus] = useState<AppDevStatus | null>(null);
  const [pendingErrors, setPendingErrors] = useState<string[]>([]);
  const [confirmRestore, setConfirmRestore] = useState(false);
  const [gitAvailable, setGitAvailable] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(true);
  const sending = useChatStore((s) => s.sending);
  const currentSessionKey = useChatStore((s) => s.currentSessionKey);
  const prevSendingRef = useRef(false);
  const workspaces = useSessionCatalogStore((s) => s.workspaces);
  const appName = workspaces.find((w) => w.id === workspaceId)?.name ?? tab.title;

  // Init: hide from sidebar, ensure agent + context, reuse existing session.
  useEffect(() => {
    if (!workspaceId) return;
    useAppDevCatalogStore.getState().registerWorkspaceId(workspaceId);
    void useAppDevCatalogStore.getState().refresh().catch(() => undefined);

    void (async () => {
      await useSessionCatalogStore.getState().selectProject(workspaceId).catch(() => undefined);
      await ensureProjectAgentForWorkspace({ workspaceId }).catch(() => undefined);
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

  // Status polling: auto-start pipeline; reduce frequency once ready.
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

  // After each chat turn: checkpoint + collect errors.
  useEffect(() => {
    if (prevSendingRef.current && !sending && workspaceId) {
      void (async () => {
        await createAppCheckpoint(workspaceId, '对话修改').catch(() => undefined);
        const errors = await drainAppErrors(workspaceId).catch(() => [] as string[]);
        if (errors.length > 0) setPendingErrors(errors);
      })();
    }
    prevSendingRef.current = sending;
  }, [sending, workspaceId]);

  const handleFixErrors = () => {
    const text = `右侧预览出现了以下报错，请帮我修复：\n\n${pendingErrors.slice(-10).join('\n')}`;
    setPendingErrors([]);
    void useChatStore.getState().sendMessage({ text });
  };

  const handleRestore = async () => {
    const result = await restoreAppCheckpoint(workspaceId);
    if (result.restored) {
      toast.success('已恢复到上一版，页面稍后自动刷新');
    } else {
      toast.error('暂时无法恢复，请稍后再试');
    }
  };

  const handleOpenInSystemBrowser = () => {
    if (!status?.previewUrl) {
      toast.message('预览还没准备好，稍后再试');
      return;
    }
    openExternalUrl(status.previewUrl);
    setPreviewOpen(false);
  };

  const phase = status?.phase ?? 'created';
  const isRunning = phase === 'ready' && Boolean(status?.previewUrl);
  const isWorking = phase === 'created' || phase === 'preparing-env' || phase === 'installing' || phase === 'starting';

  return (
    <div className="app-plaza-dev-app-pane flex h-full min-h-0 flex-col bg-background" hidden={!active}>
      <header className="flex shrink-0 items-center gap-3 border-b border-border px-4 py-2.5">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Code2 className="h-4 w-4" aria-hidden />
        </div>
        <h1 className="min-w-0 flex-1 truncate text-sm font-semibold text-foreground">{appName}</h1>
        <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <span
            className={cn(
              'inline-block h-2 w-2 rounded-full',
              isRunning && 'bg-[var(--sto-functional-success)]',
              isWorking && 'bg-[var(--sto-functional-warning)]',
              phase === 'error' && 'bg-[var(--sto-functional-error)]',
              phase === 'stopped' && 'bg-muted-foreground/50',
            )}
            aria-hidden
          />
          {PHASE_LABELS[phase] ?? phase}
        </span>

        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 gap-1 px-2 text-xs"
          title="在系统浏览器中打开预览"
          disabled={!isRunning}
          onClick={handleOpenInSystemBrowser}
        >
          <ExternalLink className="h-3.5 w-3.5" aria-hidden />
          系统浏览器预览
        </Button>

        {!previewOpen ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 gap-1 px-2 text-xs"
            title="重新打开右侧预览"
            onClick={() => setPreviewOpen(true)}
          >
            <PanelRightOpen className="h-3.5 w-3.5" aria-hidden />
            打开预览
          </Button>
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

      <div className="flex min-h-0 flex-1">
        <section
          className={cn(
            'flex min-w-0 flex-col',
            previewOpen ? 'w-[400px] min-w-[340px] shrink-0 border-r border-border' : 'flex-1',
          )}
        >
          {currentSessionKey
            ? <WorkbenchChatPane sessionKey={currentSessionKey} appName={appName} />
            : null}
        </section>

        {previewOpen ? (
          <section className="relative flex min-w-0 flex-1 flex-col bg-muted/30">
            {pendingErrors.length > 0 ? (
              <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border bg-[var(--sto-functional-warning)]/10 px-4 py-2">
                <p className="flex min-w-0 items-center gap-2 text-sm text-foreground">
                  <AlertCircle className="h-4 w-4 shrink-0 text-[var(--sto-functional-warning)]" aria-hidden />
                  <span className="truncate">页面运行出现了一点问题</span>
                </p>
                <div className="flex shrink-0 items-center gap-2">
                  <Button type="button" size="sm" className="gap-1 text-xs" onClick={handleFixErrors}>
                    <Wand2 className="h-3.5 w-3.5" aria-hidden />
                    让 AI 修复
                  </Button>
                  <button type="button" className="text-xs text-muted-foreground underline" onClick={() => setPendingErrors([])}>
                    忽略
                  </button>
                </div>
              </div>
            ) : null}

            {isRunning && status?.previewUrl ? (
              <SclawBrowserFrame url={status.previewUrl} title={appName} embedRuntimeId={null} />
            ) : (
              <div className="flex flex-1 items-center justify-center p-8">
                <div className="w-full max-w-sm text-center">
                  {phase === 'error' ? (
                    <>
                      <AlertCircle className="mx-auto mb-4 h-10 w-10 text-[var(--sto-functional-error)]" aria-hidden />
                      <p className="mb-2 text-sm font-medium text-foreground">应用启动遇到了问题</p>
                      <p className="mb-6 text-xs leading-relaxed text-muted-foreground">
                        可以重试一次；如果仍然失败，可在左侧告诉 AI「应用启动失败了，帮我看看」。
                      </p>
                      <Button
                        type="button"
                        size="sm"
                        className="gap-1"
                        onClick={() => void startApp(workspaceId).catch(() => undefined)}
                      >
                        <RotateCw className="h-3.5 w-3.5" aria-hidden />
                        重试
                      </Button>
                    </>
                  ) : (
                    <>
                      <Loader2 className="mx-auto mb-4 h-8 w-8 animate-spin text-muted-foreground" aria-hidden />
                      <p className="mb-4 text-sm font-medium text-foreground">{PHASE_LABELS[phase]}</p>
                      <Progress value={status?.progress ?? 0} className="mb-3" />
                      <p className="text-xs leading-relaxed text-muted-foreground">
                        首次创建需要准备运行环境，通常在一两分钟内完成。你可以先在左侧描述想做的功能。
                      </p>
                    </>
                  )}
                </div>
              </div>
            )}
          </section>
        ) : null}
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
    </div>
  );
}
