import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from 'react';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  buildMemoryCenterWorkflowDesignerEmbedUrl,
  markMcWebAuthedInSession,
  openMemoryCenterWorkflowDesigner,
  resolveWorkflowBridgeParentOrigin,
} from '@/lib/memory-center-web-url';
import { getWorkflowStoToken } from '@/lib/workflow-api';
import { invokeIpc } from '@/lib/api-client';
import { useAuthStore } from '@/stores/auth';
import { workflowMcEditorShell } from '@/lib/surfaces';
import {
  WORKFLOW_SAVE_DRAFT_REQUEST,
  WORKFLOW_TRY_RUN_STATE,
  WORKFLOW_DRAFT_REQUEST,
  WORKFLOW_IFRAME_BRIDGE_PROTOCOL,
  createWorkflowBridgeNonce,
  isWorkflowDraftError,
  isWorkflowDraftResponse,
  isWorkflowEditorReady,
  isWorkflowPerformanceMetric,
  isWorkflowSaveDraftError,
  isWorkflowSaveDraftResponse,
  type WorkflowDraftSnapshot,
  type WorkflowSavedDraftSnapshot,
  type WorkflowTryRunState,
} from '@/lib/workflow-iframe-bridge';
import { getMemoryCenterWebBase } from '@/lib/memory-center-web-url';
import {
  createWorkflowIframeRequestManager,
  type WorkflowIframeRequestManager,
} from '@/pages/Workflow/components/workflow-iframe-request-manager';
import {
  createWorkflowHostInitMessage,
  dispatchReadyWorkflowIframeIntent,
  isAuthenticatedWorkflowIframeEvent,
  isReadyWorkflowIframeEvent,
  resetWorkflowIframeSessionResources,
  shouldResendWorkflowHostInit,
} from '@/pages/Workflow/components/workflow-iframe-session';

export interface WorkflowMcIframeEditorProps {
  workflowId: string;
  /** AI 创建模式：传入后用作 header 副标题展示文本（sto-claw 侧持有，不进 MC URL） */
  prompt?: string;
  /** AI 创建模式：MC 后端缓存 prompt 换得的短 ID，拼进 iframe/外链 URL 供 MC 取回 */
  promptCacheId?: string;
  onEditorCapabilitiesChange?: (ready: boolean) => void;
  onTryRunRequest?: (requestId: string) => void;
  onBackRequest?: () => void;
  /** Synchronously invalidates Host attempts before iframe request managers reject on reset. */
  onEditorSessionReset?: () => void;
}

export interface WorkflowMcIframeEditorHandle {
  requestLegacyDraftSnapshot: () => Promise<WorkflowDraftSnapshot>;
  requestPersistedDraftSnapshot: (requestId: string) => Promise<WorkflowSavedDraftSnapshot>;
  sendTryRunState: (requestId: string, state: WorkflowTryRunState, message?: string) => void;
  /** @deprecated 仅供迁移期间的旧 Host 调用；请使用 requestLegacyDraftSnapshot。 */
  requestDraftSnapshot: () => Promise<WorkflowDraftSnapshot>;
}

// The iframe persists the exact canvas snapshot before replying. Allow enough
// time for a real cloud save (including slower VPN/network conditions).
const DRAFT_REQUEST_TIMEOUT_MS = 30_000;
const IFRAME_LOAD_TIMEOUT_MS = 60_000;

function createPersistedRequestManager(): WorkflowIframeRequestManager<WorkflowSavedDraftSnapshot> {
  return createWorkflowIframeRequestManager({ timeoutMs: DRAFT_REQUEST_TIMEOUT_MS });
}

function createLegacyRequestManager(): WorkflowIframeRequestManager<WorkflowDraftSnapshot> {
  return createWorkflowIframeRequestManager({
    timeoutMs: DRAFT_REQUEST_TIMEOUT_MS,
    timeoutMessage: '未能获取当前画布草稿，请刷新画布后重试',
    disposeMessage: '画布已关闭，无法获取草稿',
    concurrentMessage: '正在获取当前画布草稿，请稍后重试',
  });
}

/** 编辑/AI 创建流程：iframe 嵌入 MC /workflows-workbench/{workflowId}（顶栏由 useWorkflowEditorContentHeader 注入） */
export const WorkflowMcIframeEditor = forwardRef<WorkflowMcIframeEditorHandle, WorkflowMcIframeEditorProps>(function WorkflowMcIframeEditor({
  workflowId,
  prompt,
  promptCacheId,
  onEditorCapabilitiesChange,
  onTryRunRequest,
  onBackRequest,
  onEditorSessionReset,
}, ref) {
  const ssoEnvironment = useAuthStore((s) => s.ssoEnvironment);
  const stoToken = useAuthStore((s) => s.user?.stoToken);
  const token = useMemo(() => stoToken?.trim() || getWorkflowStoToken() || '', [stoToken]);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [bridgeNonce] = useState(createWorkflowBridgeNonce);
  const [handshakeRequestId] = useState(createWorkflowBridgeNonce);
  const iframeCreatedAtRef = useRef<number | null>(null);
  const editorReadyRef = useRef(false);
  const persistedManagerRef = useRef<WorkflowIframeRequestManager<WorkflowSavedDraftSnapshot> | null>(null);
  const persistedRequestIdRef = useRef<string | null>(null);
  const legacyManagerRef = useRef<WorkflowIframeRequestManager<WorkflowDraftSnapshot> | null>(null);
  const legacyRequestIdRef = useRef<string | null>(null);
  const callbacksRef = useRef({
    onEditorCapabilitiesChange,
    onTryRunRequest,
    onBackRequest,
    onEditorSessionReset,
  });
  const expectedOrigin = useMemo(() => new URL(getMemoryCenterWebBase(ssoEnvironment)).origin, [ssoEnvironment]);
  const bridgeParentOrigin = useMemo(
    () => resolveWorkflowBridgeParentOrigin(window.location.origin, window.location.protocol),
    [],
  );

  const iframeSrc = useMemo(
    () => buildMemoryCenterWorkflowDesignerEmbedUrl(
      workflowId,
      token,
      ssoEnvironment,
      promptCacheId,
      prompt,
      bridgeNonce,
      bridgeParentOrigin,
    ),
    [workflowId, token, ssoEnvironment, promptCacheId, prompt, bridgeNonce, bridgeParentOrigin],
  );

  useEffect(() => {
    iframeCreatedAtRef.current = performance.now();
    void invokeEditorMetric({ workflowId, stage: 'iframe_created', elapsedMs: 0 });
  }, [iframeSrc, workflowId]);

  useEffect(() => {
    callbacksRef.current = {
      onEditorCapabilitiesChange,
      onTryRunRequest,
      onBackRequest,
      onEditorSessionReset,
    };
  }, [onBackRequest, onEditorCapabilitiesChange, onEditorSessionReset, onTryRunRequest]);

  const getPersistedManager = () => {
    persistedManagerRef.current ??= createPersistedRequestManager();
    return persistedManagerRef.current;
  };

  const getLegacyManager = () => {
    legacyManagerRef.current ??= createLegacyRequestManager();
    return legacyManagerRef.current;
  };

  const postHostInit = () => {
    const target = iframeRef.current?.contentWindow;
    if (!target) return false;
    try {
      target.postMessage(createWorkflowHostInitMessage({
        workflowId,
        nonce: bridgeNonce,
        handshakeRequestId,
      }), expectedOrigin);
      return true;
    } catch {
      return false;
    }
  };

  const requestLegacyDraftSnapshot = () => {
    const target = iframeRef.current?.contentWindow;
    if (!target) {
      return Promise.reject(new Error('画布尚未加载完成，请稍后重试'));
    }

    const existingRequestId = legacyRequestIdRef.current;
    const requestId = existingRequestId ?? createWorkflowBridgeNonce();
    const manager = getLegacyManager();
    const promise = manager.begin(requestId);
    if (existingRequestId) return promise;

    legacyRequestIdRef.current = requestId;
    const clearRequest = () => {
      if (legacyRequestIdRef.current === requestId) legacyRequestIdRef.current = null;
    };
    void promise.then(clearRequest, clearRequest);
    try {
      target.postMessage({
        protocol: WORKFLOW_IFRAME_BRIDGE_PROTOCOL,
        type: WORKFLOW_DRAFT_REQUEST,
        requestId,
        workflowId,
        nonce: bridgeNonce,
      }, expectedOrigin);
    } catch (error) {
      manager.reject(requestId, error instanceof Error ? error : new Error(String(error)));
    }
    return promise;
  };

  const requestPersistedDraftSnapshot = (requestId: string) => {
    const target = iframeRef.current?.contentWindow;
    if (!target) {
      return Promise.reject(new Error('画布尚未加载完成，请稍后重试'));
    }
    if (!requestId.trim()) {
      return Promise.reject(new Error('试运行请求标识无效，请重新发起'));
    }
    if (!editorReadyRef.current) {
      return Promise.reject(new Error('编辑器尚未完成试运行能力握手，请稍后重试'));
    }

    const existingRequestId = persistedRequestIdRef.current;
    const manager = getPersistedManager();
    const promise = manager.begin(requestId);
    if (existingRequestId) return promise;

    persistedRequestIdRef.current = requestId;
    const clearRequest = () => {
      if (persistedRequestIdRef.current === requestId) persistedRequestIdRef.current = null;
    };
    void promise.then(clearRequest, clearRequest);
    try {
      target.postMessage({
        protocol: WORKFLOW_IFRAME_BRIDGE_PROTOCOL,
        type: WORKFLOW_SAVE_DRAFT_REQUEST,
        requestId,
        workflowId,
        nonce: bridgeNonce,
      }, expectedOrigin);
    } catch (error) {
      manager.reject(requestId, error instanceof Error ? error : new Error(String(error)));
    }
    return promise;
  };

  const sendTryRunState = (requestId: string, state: WorkflowTryRunState, message?: string) => {
    const target = iframeRef.current?.contentWindow;
    if (!target) return;
    try {
      target.postMessage({
        protocol: WORKFLOW_IFRAME_BRIDGE_PROTOCOL,
        type: WORKFLOW_TRY_RUN_STATE,
        requestId,
        workflowId,
        nonce: bridgeNonce,
        state,
        ...(message ? { error: message } : {}),
      }, expectedOrigin);
    } catch {
      // 会话已切换时状态消息允许静默丢弃。
    }
  };

  useEffect(() => {
    editorReadyRef.current = false;
    callbacksRef.current.onEditorCapabilitiesChange?.(false);
    persistedManagerRef.current = createPersistedRequestManager();
    persistedRequestIdRef.current = null;
    legacyManagerRef.current = createLegacyRequestManager();
    legacyRequestIdRef.current = null;

    return () => {
      resetWorkflowIframeSessionResources({
        invalidateHostSession: callbacksRef.current.onEditorSessionReset,
        disposePersistedRequests: () => persistedManagerRef.current?.dispose(),
        disposeLegacyRequests: () => legacyManagerRef.current?.dispose(),
        resetCapabilities: () => {
          editorReadyRef.current = false;
          callbacksRef.current.onEditorCapabilitiesChange?.(false);
        },
      });
      persistedManagerRef.current = null;
      persistedRequestIdRef.current = null;
      legacyManagerRef.current = null;
      legacyRequestIdRef.current = null;
    };
  }, [iframeSrc, workflowId]);

  useEffect(() => {
    const onMessage = (event: MessageEvent<unknown>) => {
      const payload = event.data;
      if (isWorkflowPerformanceMetric(payload)) {
        if (!isAuthenticatedWorkflowIframeEvent(event, {
          expectedOrigin,
          expectedSource: iframeRef.current?.contentWindow ?? null,
          workflowId,
          nonce: bridgeNonce,
        })) return;
        void invokeEditorMetric({
          workflowId,
          stage: payload.stage,
          elapsedMs: performance.now() - (iframeCreatedAtRef.current ?? performance.now()),
          embeddedElapsedMs: payload.elapsedMs,
          error: payload.error,
        });
        if (shouldResendWorkflowHostInit(event, {
          expectedOrigin,
          expectedSource: iframeRef.current?.contentWindow ?? null,
          workflowId,
          nonce: bridgeNonce,
        }, editorReadyRef.current)) {
          try {
            iframeRef.current?.contentWindow?.postMessage(createWorkflowHostInitMessage({
              workflowId,
              nonce: bridgeNonce,
              handshakeRequestId,
            }), expectedOrigin);
          } catch {
            // iframe 正在重载时由下一次 load 继续握手。
          }
        }
        return;
      }

      if (isWorkflowEditorReady(payload) && isReadyWorkflowIframeEvent(event, {
        expectedOrigin,
        expectedSource: iframeRef.current?.contentWindow ?? null,
        workflowId,
        nonce: bridgeNonce,
        handshakeRequestId,
      })) {
        editorReadyRef.current = true;
        callbacksRef.current.onEditorCapabilitiesChange?.(true);
        return;
      }

      if (!isAuthenticatedWorkflowIframeEvent(event, {
        expectedOrigin,
        expectedSource: iframeRef.current?.contentWindow ?? null,
        workflowId,
        nonce: bridgeNonce,
      })) return;

      if (dispatchReadyWorkflowIframeIntent(event, {
        expectedOrigin,
        expectedSource: iframeRef.current?.contentWindow ?? null,
        workflowId,
        nonce: bridgeNonce,
      }, editorReadyRef.current, callbacksRef.current)) {
        return;
      }
      if (isWorkflowSaveDraftResponse(payload)) {
        persistedManagerRef.current?.resolve(payload.requestId, payload);
        return;
      }
      if (isWorkflowSaveDraftError(payload)) {
        persistedManagerRef.current?.reject(payload.requestId, new Error(payload.message));
        return;
      }
      if (isWorkflowDraftResponse(payload)) {
        legacyManagerRef.current?.resolve(payload.requestId, payload);
      } else if (isWorkflowDraftError(payload)) {
        legacyManagerRef.current?.reject(payload.requestId, new Error(payload.message));
      }
    };
    window.addEventListener('message', onMessage);
    return () => {
      window.removeEventListener('message', onMessage);
    };
  }, [bridgeNonce, expectedOrigin, handshakeRequestId, workflowId]);

  useImperativeHandle(ref, () => ({
    requestLegacyDraftSnapshot,
    requestPersistedDraftSnapshot,
    sendTryRunState,
    requestDraftSnapshot: requestLegacyDraftSnapshot,
  }));

  const handleIframeLoad = () => {
    resetWorkflowIframeSessionResources({
      invalidateHostSession: callbacksRef.current.onEditorSessionReset,
      disposePersistedRequests: () => persistedManagerRef.current?.dispose(),
      disposeLegacyRequests: () => legacyManagerRef.current?.dispose(),
      resetCapabilities: () => {
        editorReadyRef.current = false;
        callbacksRef.current.onEditorCapabilitiesChange?.(false);
      },
    });
    persistedManagerRef.current = createPersistedRequestManager();
    persistedRequestIdRef.current = null;
    legacyManagerRef.current = createLegacyRequestManager();
    legacyRequestIdRef.current = null;
    postHostInit();
    void invokeEditorMetric({
      workflowId,
      stage: 'iframe_load',
      elapsedMs: performance.now() - (iframeCreatedAtRef.current ?? performance.now()),
    });
  };

  return (
    <div className={workflowMcEditorShell}>
      <div className="relative min-h-0 flex-1">
        {/* key 随 src 变化重挂载，loading 态自动重置为 true，无需 effect */}
        <McEditorIframe
          key={iframeSrc}
          iframeRef={iframeRef}
          src={iframeSrc}
          prompt={prompt}
          promptCacheId={promptCacheId}
          workflowId={workflowId}
          token={token}
          onIframeLoad={handleIframeLoad}
        />
      </div>
    </div>
  );
});

function McEditorIframe({
  src,
  iframeRef,
  prompt,
  promptCacheId,
  workflowId,
  token,
  onIframeLoad,
}: {
  src: string;
  iframeRef: RefObject<HTMLIFrameElement | null>;
  prompt?: string;
  promptCacheId?: string;
  workflowId: string;
  token: string;
  onIframeLoad: () => void;
}) {
  const [loadIssue, setLoadIssue] = useState<'timeout' | 'error' | null>(null);
  const [iframeLoading, setIframeLoading] = useState(true);
  const [loadAttempt, setLoadAttempt] = useState(0);

  useEffect(() => {
    if (!iframeLoading || loadIssue) return;
    const timer = window.setTimeout(() => {
      setIframeLoading(false);
      setLoadIssue('timeout');
    }, IFRAME_LOAD_TIMEOUT_MS);
    return () => window.clearTimeout(timer);
  }, [iframeLoading, loadAttempt, loadIssue]);

  const handleIframeLoad = () => {
    setIframeLoading(false);
    setLoadIssue(null);
    onIframeLoad();
    if (src.includes('/workflows-workbench/')) {
      markMcWebAuthedInSession();
    }
  };

  return (
    <>
      {iframeLoading ? (
        <div className="absolute inset-0 z-[1] flex flex-col items-center justify-center gap-2 bg-background/80">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            {prompt || promptCacheId ? '正在加载 AI 创建面板…' : '正在加载编辑器…'}
          </p>
        </div>
      ) : null}

      {loadIssue ? (
        <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
          <p className="text-sm text-muted-foreground">
            {loadIssue === 'timeout'
              ? `${prompt || promptCacheId ? 'AI 创建面板' : '编辑器'}加载时间过长，请检查网络后重试。`
              : `无法在应用内加载${prompt || promptCacheId ? ' AI 创建面板' : '网页版编辑器'}，可能被安全策略拦截。`}
          </p>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              onClick={() => {
                setLoadIssue(null);
                setIframeLoading(true);
                setLoadAttempt((attempt) => attempt + 1);
              }}
            >
              重新加载
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => openMemoryCenterWorkflowDesigner(workflowId, token, promptCacheId, prompt)}
            >
              在浏览器打开
            </Button>
          </div>
        </div>
      ) : (
        <iframe
          key={loadAttempt}
          ref={iframeRef}
          title="AI 记忆中心工作流编辑器"
          src={src}
          className="h-full w-full border-0 bg-background"
          onLoad={handleIframeLoad}
          onError={() => {
            setIframeLoading(false);
            setLoadIssue('error');
          }}
        />
      )}
    </>
  );
}

async function invokeEditorMetric(metric: Record<string, unknown>): Promise<void> {
  try {
    await invokeIpc('workflow-editor:metric', metric);
  } catch {
    // 性能日志不可用不应影响画布编辑。
  }
}
