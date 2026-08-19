/**
 * Shared client-native workflow result drawer.
 *
 * Trial runs, completion notifications, and historical runs intentionally use
 * the same presentation. Callers may provide different actions, but the
 * information architecture and visual component stay identical.
 */
import type { WorkflowExecutionState, WorkflowRunResponse } from '@/types/workflow';
import {
  buildTrialRunTimeline,
  collectTrialRunArtifacts,
} from '@/pages/WorkflowDesigner/components/test-run-drawer-model';
import { TrialRunDrawerView } from '@/pages/WorkflowDesigner/components/test-run-trial-view';

export interface TestRunDrawerProps {
  /** @deprecated All callers now share the trial-run presentation. */
  variant?: 'trial' | 'detail';
  open: boolean;
  workflowName?: string | null;
  runId: string | null;
  run: WorkflowRunResponse | null;
  executionState: WorkflowExecutionState | null;
  /** The human-facing workflow version, never the persistence version ID. */
  workflowVersion?: string | number | null;
  isStarting: boolean;
  isCancelling: boolean;
  isRunActive: boolean;
  isDraftSnapshot: boolean;
  launchError: string | null;
  onClose: () => void;
  onCancel?: () => void;
  onContinue?: () => void;
  onRerun?: () => void;
  onReturnToConversation?: () => void;
  returnToConversationLabel?: string;
  onDecideApproval?: (approved: boolean, note?: string) => void;
  onSubmitInput?: (values: Record<string, unknown>) => void;
}

export function TestRunDrawer(props: TestRunDrawerProps) {
  return (
    <TrialRunDrawerView
      {...props}
      timeline={buildTrialRunTimeline(props.run, props.executionState)}
      artifacts={collectTrialRunArtifacts(props.run, props.executionState)}
    />
  );
}
