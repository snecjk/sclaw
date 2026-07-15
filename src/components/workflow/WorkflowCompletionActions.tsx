import { useTranslation } from 'react-i18next';
import { artifactToPreviewFile, isUserFacingArtifactUrl } from '@/lib/preview-url';
import { shouldPreviewInSidePanel } from '@/lib/preview-href';
import { isTerminalWorkflowRunStatus } from '@/lib/workflow-run-status';
import type { AttachedFileMeta } from '@/stores/chat';
import { useChatStore } from '@/stores/chat';
import { ArtifactProductCard, buildArtifactMetaLine } from '@/components/chat/artifact-product-card';
import { buildArtifactCardMenuItems } from '@/lib/artifact-card-menu';

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
  const primaryArtifact = artifacts.find((a) => shouldPreviewInSidePanel(a.url)) ?? null;

  if (!primaryArtifact || !onPreviewArtifact) return null;

  const previewFile = artifactToPreviewFile(primaryArtifact);

  return (
    <div className="mt-3 w-full">
      <ArtifactProductCard
        title={primaryArtifact.name}
        metaLine={buildArtifactMetaLine({
          fileName: primaryArtifact.name,
          mimeType: primaryArtifact.type || 'application/octet-stream',
          t,
        })}
        menuItems={buildArtifactCardMenuItems(previewFile, t)}
        onAction={() => onPreviewArtifact!(previewFile)}
      />
    </div>
  );
}

export function extractWorkflowCompletionRunId(text: string): string | null {
  if (!/工作流执行(成功|失败)/.test(text)) return null;
  const match = text.match(/run_[\w-]+/);
  return match?.[0] ?? null;
}
