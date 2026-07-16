import { useMemo, useState } from 'react';
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

interface WorkflowMcIframeEditorProps {
  workflowId: string;
  /** AI 创建模式：传入后用作 header 副标题展示文本（sto-claw 侧持有，不进 MC URL） */
  prompt?: string;
  /** AI 创建模式：MC 后端缓存 prompt 换得的短 ID，拼进 iframe/外链 URL 供 MC 取回 */
  promptCacheId?: string;
}

/** 编辑/AI 创建流程：iframe 嵌入 MC /workflows-workbench/{workflowId}（顶栏由 useWorkflowEditorContentHeader 注入） */
export function WorkflowMcIframeEditor({ workflowId, prompt, promptCacheId }: WorkflowMcIframeEditorProps) {
  const ssoEnvironment = useAuthStore((s) => s.ssoEnvironment);
  const stoToken = useAuthStore((s) => s.user?.stoToken);
  const token = useMemo(() => stoToken?.trim() || getWorkflowStoToken() || '', [stoToken]);

  const iframeSrc = useMemo(
    () => buildMemoryCenterWorkflowDesignerEmbedUrl(workflowId, token, ssoEnvironment, promptCacheId, prompt),
    [workflowId, token, ssoEnvironment, promptCacheId, prompt],
  );

  return (
    <div className={workflowMcEditorShell}>
      <div className="relative min-h-0 flex-1">
        {/* key 随 src 变化重挂载，loading 态自动重置为 true，无需 effect */}
        <McEditorIframe key={iframeSrc} src={iframeSrc} prompt={prompt} promptCacheId={promptCacheId} workflowId={workflowId} token={token} />
      </div>
    </div>
  );
}

function McEditorIframe({
  src,
  prompt,
  promptCacheId,
  workflowId,
  token,
}: {
  src: string;
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
