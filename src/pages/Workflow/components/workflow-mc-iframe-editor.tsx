import { useEffect, useMemo, useState } from 'react';
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
}

/** 编辑已有流程：iframe 嵌入 MC /workflows-workbench/{workflowId} */
export function WorkflowMcIframeEditor({ workflowId, onBack }: WorkflowMcIframeEditorProps) {
  const ssoEnvironment = useAuthStore((s) => s.ssoEnvironment);
  const stoToken = useAuthStore((s) => s.user?.stoToken);
  const [loadFailed, setLoadFailed] = useState(false);
  const [iframeLoading, setIframeLoading] = useState(true);

  const token = useMemo(() => stoToken?.trim() || getWorkflowStoToken() || '', [stoToken]);

  const iframeSrc = useMemo(
    () => buildMemoryCenterWorkflowDesignerEmbedUrl(workflowId, token, ssoEnvironment),
    [workflowId, token, ssoEnvironment],
  );

  useEffect(() => {
    setLoadFailed(false);
    setIframeLoading(true);
  }, [iframeSrc]);

  const handleIframeLoad = () => {
    setIframeLoading(false);
    if (iframeSrc.includes('/workflows-workbench/')) {
      markMcWebAuthedInSession();
    }
  };

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
          <p className="truncate text-sm font-semibold">编辑工作流</p>
          <p className="truncate text-xs text-muted-foreground">{workflowId}</p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => openMemoryCenterWorkflowDesigner(workflowId, token)}
        >
          <ExternalLink className="mr-1 h-3.5 w-3.5" />
          在浏览器打开
        </Button>
      </header>

      <div className="relative min-h-0 flex-1">
        {iframeLoading ? (
          <div className="absolute inset-0 z-[1] flex flex-col items-center justify-center gap-2 bg-background/80">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            <p className="text-sm text-muted-foreground">正在加载编辑器…</p>
          </div>
        ) : null}

        {loadFailed ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
            <p className="text-sm text-muted-foreground">
              无法在应用内加载网页版编辑器（可能被安全策略拦截）。请在浏览器中打开。
            </p>
            <Button type="button" onClick={() => openMemoryCenterWorkflowDesigner(workflowId, token)}>
              在浏览器打开
            </Button>
          </div>
        ) : (
          <iframe
            key={iframeSrc}
            title="AI 记忆中心工作流编辑器"
            src={iframeSrc}
            className="h-full w-full border-0 bg-background"
            onLoad={handleIframeLoad}
            onError={() => {
              setIframeLoading(false);
              setLoadFailed(true);
            }}
          />
        )}
      </div>
    </div>
  );
}
