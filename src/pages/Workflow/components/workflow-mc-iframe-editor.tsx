import { useMemo, useState } from 'react';
import { ChevronLeft, ExternalLink, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  buildMemoryCenterWorkflowDesignerEmbedUrl,
  markMcWebAuthedInSession,
  openMemoryCenterWorkflowDesigner,
} from '@/lib/memory-center-web-url';
import { getWorkflowStoToken } from '@/lib/workflow-api';
import { useAuthStore } from '@/stores/auth';
import { workflowMcEditorShell } from '@/lib/surfaces';

interface WorkflowMcIframeEditorProps {
  workflowId: string;
  onBack: () => void;
  /** AI 创建模式：传入后 iframe URL 带 prompt，MC 端 workflow 加载后自动打开 AI 面板并发起 */
  prompt?: string;
}

/** 编辑/AI 创建流程：iframe 嵌入 MC /workflows-workbench/{workflowId}（带 prompt 时 MC 自动发起 AI 创建） */
export function WorkflowMcIframeEditor({ workflowId, onBack, prompt }: WorkflowMcIframeEditorProps) {
  const ssoEnvironment = useAuthStore((s) => s.ssoEnvironment);
  const stoToken = useAuthStore((s) => s.user?.stoToken);
  const token = useMemo(() => stoToken?.trim() || getWorkflowStoToken() || '', [stoToken]);

  const iframeSrc = useMemo(
    () => buildMemoryCenterWorkflowDesignerEmbedUrl(workflowId, token, ssoEnvironment, prompt),
    [workflowId, token, ssoEnvironment, prompt],
  );

  return (
    <div className={workflowMcEditorShell}>
      <header className="flex min-h-[48px] shrink-0 items-center gap-2 border-b border-border bg-card px-3 py-2">
        <button
          type="button"
          aria-label="返回列表"
          onClick={onBack}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-foreground/80 hover:bg-muted"
        >
          <ChevronLeft className="h-5 w-5" aria-hidden />
        </button>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">{prompt ? 'AI 创建工作流' : '编辑工作流'}</p>
          <p className="truncate text-xs text-muted-foreground" title={prompt ?? workflowId}>
            {prompt ?? workflowId}
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => openMemoryCenterWorkflowDesigner(workflowId, token, prompt)}
        >
          <ExternalLink className="mr-1 h-3.5 w-3.5" />
          在浏览器打开
        </Button>
      </header>

      <div className="relative min-h-0 flex-1">
        {/* key 随 src 变化重挂载，loading 态自动重置为 true，无需 effect */}
        <McEditorIframe key={iframeSrc} src={iframeSrc} prompt={prompt} workflowId={workflowId} token={token} />
      </div>
    </div>
  );
}

function McEditorIframe({
  src,
  prompt,
  workflowId,
  token,
}: {
  src: string;
  prompt?: string;
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
            {prompt ? '正在加载 AI 创建面板…' : '正在加载编辑器…'}
          </p>
        </div>
      ) : null}

      {loadFailed ? (
        <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
          <p className="text-sm text-muted-foreground">
            无法在应用内加载{prompt ? ' AI 创建面板' : '网页版编辑器'}（可能被安全策略拦截）。请在浏览器中打开。
          </p>
          <Button type="button" onClick={() => openMemoryCenterWorkflowDesigner(workflowId, token, prompt)}>
            在浏览器打开
          </Button>
        </div>
      ) : (
        <iframe
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
