/**
 * AppDevWorkbench — 用户应用开发工作台（app-dev-workbench）。
 * 左：项目 Agent 对话（默认注入应用 AGENTS.md 上下文）；
 * 右：所见即所得预览；可用系统浏览器打开预览并收起右侧面板。
 */
import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  AlertCircle,
  ArrowLeft,
  ExternalLink,
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
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { cn } from '@/lib/utils';
import {
  stoChatColumnContentTrackClass,
  stoChatScrollContentClass,
  stoChatScrollPaneClass,
} from '@/lib/surfaces';
import { openExternalUrl } from '@/lib/preview-url';
import { useMoreAppsStore } from '@/stores/more-apps';
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
        <HomeComposer showDisclaimer={false} footerAlign="center" />
      </div>
    </div>
  );
}

export default function AppDevWorkbench() {
  const { workspaceId = '' } = useParams<{ workspaceId: string }>();
  const navigate = useNavigate();
  const [status, setStatus] = useState<AppDevStatus | null>(null);
  const [pendingErrors, setPendingErrors] = useState<string[]>([]);
  const [confirmRestore, setConfirmRestore] = useState(false);
  const [gitAvailable, setGitAvailable] = useState(false);
  const sending = useChatStore((s) => s.sending);
  const currentSessionKey = useChatStore((s) => s.currentSessionKey);
  const prevSendingRef = useRef(false);
  const workspaces = useSessionCatalogStore((s) => s.workspaces);
  const appName = workspaces.find((w) => w.id === workspaceId)?.name ?? '我的应用';

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

  // 每轮对话结束：自动保存版本 + 收集报错（错误回流闭环）。
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
  };

  const phase = status?.phase ?? 'created';
  const isRunning = phase === 'ready' && Boolean(status?.previewUrl);
  const isWorking = phase === 'created' || phase === 'preparing-env' || phase === 'installing' || phase === 'starting';

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex shrink-0 items-center gap-3 border-b border-border px-4 py-2.5">
        <button
          type="button"
          onClick={() => {
            useMoreAppsStore.getState().setActiveTab('installed');
            navigate('/more-apps');
          }}
          className="flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden />
          我的应用
        </button>
        <div className="h-4 w-px bg-border" aria-hidden />
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
          onRetryStart={() => void startApp(workspaceId).catch(() => undefined)}
        />

        <section className="flex w-[400px] min-w-[340px] shrink-0 flex-col border-l border-border">
          {currentSessionKey
            ? <WorkbenchChatPane sessionKey={currentSessionKey} appName={appName} />
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
    </div>
  );
}
