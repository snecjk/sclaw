import { useTranslation } from 'react-i18next';
import { artifactToPreviewFile, isPreviewableArtifactUrl, isUserFacingArtifactUrl } from '@/lib/preview-url';
import { isTerminalWorkflowRunStatus } from '@/lib/workflow-run-status';
import type { AttachedFileMeta } from '@/stores/chat';
import { useChatStore } from '@/stores/chat';
import { ArtifactProductCard, buildArtifactMetaLine } from '@/components/chat/artifact-product-card';

interface WorkflowCompletionActionsProps {
  runId: string;
  onPreviewArtifact?: (file: AttachedFileMeta) => void;
}

export function WorkflowCompletionActions({
  runId,
  onPreviewArtifact,
}: WorkflowCompletionActionsProps) {
  const { t } = useTranslation('chat');
  const state = useChatStore((s) => s.workflowCardStates[runId]);
  if (!state || !isTerminalWorkflowRunStatus(state.status)) return null;

  const artifacts = (state.result?.artifacts ?? []).filter((a) => isUserFacingArtifactUrl(a.url));
  const primaryArtifact = artifacts.find((a) => isPreviewableArtifactUrl(a.url, a.type)) ?? artifacts[0];
  const canPreview = primaryArtifact && onPreviewArtifact
    && isPreviewableArtifactUrl(primaryArtifact.url, primaryArtifact.type);

  if (!canPreview || !primaryArtifact) return null;

  return (
    <div className="mt-3 w-full">
      <ArtifactProductCard
        title={primaryArtifact.name}
        metaLine={buildArtifactMetaLine({
          fileName: primaryArtifact.name,
          mimeType: primaryArtifact.type || 'application/octet-stream',
          t,
        })}
        onAction={() => onPreviewArtifact!(artifactToPreviewFile(primaryArtifact))}
      />
    </div>
  );
}

export function extractWorkflowCompletionRunId(text: string): string | null {
  if (!/工作流执行(成功|失败)/.test(text)) return null;
  const match = text.match(/run_[\w-]+/);
  return match?.[0] ?? null;
}
