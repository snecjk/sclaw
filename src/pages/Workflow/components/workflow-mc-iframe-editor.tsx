import {
  forwardRef,
  useCallback,
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
} from '@/lib/memory-center-web-url';
import { getWorkflowStoToken } from '@/lib/workflow-api';
import { useAuthStore } from '@/stores/auth';
import { workflowMcEditorShell } from '@/lib/surfaces';
import {
  WORKFLOW_DRAFT_REQUEST,
  WORKFLOW_IFRAME_BRIDGE_PROTOCOL,
  createWorkflowBridgeNonce,
  isWorkflowDraftError,
  isWorkflowDraftResponse,
  type WorkflowDraftSnapshot,
} from '@/lib/workflow-iframe-bridge';
import { getMemoryCenterWebBase } from '@/lib/memory-center-web-url';

interface WorkflowMcIframeEditorProps {
  workflowId: string;
  /** AI 创建模式：传入后用作 header 副标题展示文本（sto-claw 侧持有，不进 MC URL） */
  prompt?: string;
  /** AI 创建模式：MC 后端缓存 prompt 换得的短 ID，拼进 iframe/外链 URL 供 MC 取回 */
  promptCacheId?: string;
}

export interface WorkflowMcIframeEditorHandle {
  requestDraftSnapshot: () => Promise<WorkflowDraftSnapshot>;
}

const DRAFT_REQUEST_TIMEOUT_MS = 6000;

/** 编辑/AI 创建流程：iframe 嵌入 MC /workflows-workbench/{workflowId}（顶栏由 useWorkflowEditorContentHeader 注入） */
export const WorkflowMcIframeEditor = forwardRef<WorkflowMcIframeEditorHandle, WorkflowMcIframeEditorProps>(function WorkflowMcIframeEditor({
  workflowId,
  prompt,
  promptCacheId,
}, ref) {
  const ssoEnvironment = useAuthStore((s) => s.ssoEnvironment);
  const stoToken = useAuthStore((s) => s.user?.stoToken);
  const token = useMemo(() => stoToken?.trim() || getWorkflowStoToken() || '', [stoToken]);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [bridgeNonce] = useState(createWorkflowBridgeNonce);
  const pendingRequestRef = useRef<{
    requestId: string;
    resolve: (snapshot: WorkflowDraftSnapshot) => void;
    reject: (error: Error) => void;
    timer: number;
  } | null>(null);
  const expectedOrigin = useMemo(() => new URL(getMemoryCenterWebBase(ssoEnvironment)).origin, [ssoEnvironment]);

  const iframeSrc = useMemo(
    () => buildMemoryCenterWorkflowDesignerEmbedUrl(
      workflowId,
      token,
      ssoEnvironment,
      promptCacheId,
      prompt,
      bridgeNonce,
    ),
    [workflowId, token, ssoEnvironment, promptCacheId, prompt, bridgeNonce],
  );

  const requestDraftSnapshot = useCallback(() => {
    const target = iframeRef.current?.contentWindow;
    if (!target) {
      return Promise.reject(new Error('画布尚未加载完成，请稍后重试'));
    }
    if (pendingRequestRef.current) {
      return Promise.reject(new Error('正在获取当前画布，请稍后重试'));
    }

    const requestId = createWorkflowBridgeNonce();
    return new Promise<WorkflowDraftSnapshot>((resolve, reject) => {
      const timer = window.setTimeout(() => {
        pendingRequestRef.current = null;
        reject(new Error('未能获取当前画布草稿，请刷新画布后重试'));
      }, DRAFT_REQUEST_TIMEOUT_MS);
      pendingRequestRef.current = { requestId, resolve, reject, timer };
      target.postMessage({
        protocol: WORKFLOW_IFRAME_BRIDGE_PROTOCOL,
        type: WORKFLOW_DRAFT_REQUEST,
        requestId,
        workflowId,
        nonce: bridgeNonce,
      }, expectedOrigin);
    });
  }, [bridgeNonce, expectedOrigin, workflowId]);

  useEffect(() => {
    const onMessage = (event: MessageEvent<unknown>) => {
      const pending = pendingRequestRef.current;
      if (!pending || event.origin !== expectedOrigin || event.source !== iframeRef.current?.contentWindow) return;
      const payload = event.data;
      if (isWorkflowDraftResponse(payload)) {
        if (
          payload.requestId !== pending.requestId ||
          payload.nonce !== bridgeNonce ||
          payload.workflowId !== workflowId
        ) return;
        window.clearTimeout(pending.timer);
        pendingRequestRef.current = null;
        pending.resolve(payload);
      } else if (isWorkflowDraftError(payload)) {
        if (
          payload.requestId !== pending.requestId ||
          payload.nonce !== bridgeNonce ||
          payload.workflowId !== workflowId
        ) return;
        window.clearTimeout(pending.timer);
        pendingRequestRef.current = null;
        pending.reject(new Error(payload.message));
      }
    };
    window.addEventListener('message', onMessage);
    return () => {
      window.removeEventListener('message', onMessage);
      const pending = pendingRequestRef.current;
      if (pending) {
        window.clearTimeout(pending.timer);
        pending.reject(new Error('画布已关闭，无法获取草稿'));
        pendingRequestRef.current = null;
      }
    };
  }, [bridgeNonce, expectedOrigin, workflowId]);

  useImperativeHandle(ref, () => ({ requestDraftSnapshot }), [requestDraftSnapshot]);

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
}: {
  src: string;
  iframeRef: RefObject<HTMLIFrameElement | null>;
  prompt?: string;
  promptCacheId?: string;
  workflowId: string;
  token: string;
}) {
  const [loadFailed, setLoadFailed] = useState(false);
  const [iframeLoading, setIframeLoading] = useState(true);

  const handleIframeLoad = () => {
    setIframeLoading(false);
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

      {loadFailed ? (
        <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
          <p className="text-sm text-muted-foreground">
            无法在应用内加载{prompt || promptCacheId ? ' AI 创建面板' : '网页版编辑器'}（可能被安全策略拦截）。请在浏览器中打开。
          </p>
          <Button type="button" onClick={() => openMemoryCenterWorkflowDesigner(workflowId, token, promptCacheId, prompt)}>
            在浏览器打开
          </Button>
        </div>
      ) : (
        <iframe
          ref={iframeRef}
          title="AI 记忆中心工作流编辑器"
          src={src}
          className="h-full w-full border-0 bg-background"
          onLoad={handleIframeLoad}
          onError={() => {
            setIframeLoading(false);
            setLoadFailed(true);
          }}
        />
      )}
    </>
  );
}
