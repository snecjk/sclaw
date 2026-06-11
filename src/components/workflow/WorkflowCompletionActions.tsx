import { FileText } from 'lucide-react';
import { artifactToPreviewFile, isPreviewableArtifactUrl, isUserFacingArtifactUrl } from '@/lib/preview-url';
import { isTerminalWorkflowRunStatus } from '@/lib/workflow-run-status';
import type { AttachedFileMeta } from '@/stores/chat';
import { useChatStore } from '@/stores/chat';

interface WorkflowCompletionActionsProps {
  runId: string;
  onPreviewArtifact?: (file: AttachedFileMeta) => void;
  onViewWorkflow?: (workflowId: string) => void;
}

export function WorkflowCompletionActions({
  runId,
  onPreviewArtifact,
}: WorkflowCompletionActionsProps) {
  const state = useChatStore((s) => s.workflowCardStates[runId]);
  if (!state || !isTerminalWorkflowRunStatus(state.status)) return null;

  const artifacts = (state.result?.artifacts ?? []).filter((a) => isUserFacingArtifactUrl(a.url));
  const primaryArtifact = artifacts.find((a) => isPreviewableArtifactUrl(a.url, a.type)) ?? artifacts[0];
  const canPreview = primaryArtifact && onPreviewArtifact
    && isPreviewableArtifactUrl(primaryArtifact.url, primaryArtifact.type);

  if (!canPreview) return null;

  return (
    <div className="mt-3 space-y-2">
      {primaryArtifact && (
        <div className="flex items-center gap-3 rounded-xl border border-[#E5E6EB] bg-white px-3.5 py-2.5">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#FFF5E6]">
            <FileText className="h-4 w-4 text-[#FF6F00]" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[13px] font-semibold text-[#1D2129]">{primaryArtifact.name}</p>
            <p className="truncate text-[11px] text-[#86909C]">{primaryArtifact.type || 'output'}</p>
          </div>
          <button
            type="button"
            onClick={() => onPreviewArtifact!(artifactToPreviewFile(primaryArtifact))}
            className="shrink-0 rounded-full border border-[#FF6F00]/30 px-3 py-1 text-[12px] font-medium text-[#FF6F00] transition-colors hover:bg-[#FFF5E6]"
          >
            查看预览
          </button>
        </div>
      )}
    </div>
  );
}

export function extractWorkflowCompletionRunId(text: string): string | null {
  if (!/工作流执行(成功|失败)/.test(text)) return null;
  const match = text.match(/run_[\w-]+/);
  return match?.[0] ?? null;
}
