import type { WorkflowExecutionState } from '@/types/workflow';
//  Workflow progress calculation for the WorkflowCard component
// 工作流进度计算
export function getWorkflowProgressDetails(state: WorkflowExecutionState): {
  isActive: boolean;
  completedSteps: number;
  totalSteps: number;
  progressPercent: number;
  currentStep?: string;
  helperText: 'preparing' | 'steps' | 'waitingApproval' | 'waitingInput' | null;
} {
  const isActive = state.status === 'running'
    || state.status === 'waiting_approval'
    || state.status === 'waiting_input'
    || state.status === 'pending';
  const totalSteps = state.steps.length;
  const completedSteps = state.steps.filter((step) => step.status === 'completed').length;
  const progressPercent = totalSteps > 0
    ? Math.min(100, Math.round((completedSteps / totalSteps) * 100))
    : 0;
  const currentStep = state.currentStep
    ?? state.steps.find((step) => step.status === 'running')?.name;
  const helperText = state.status === 'waiting_approval'
    ? 'waitingApproval'
    : state.status === 'waiting_input'
      ? 'waitingInput'
      : totalSteps > 0
        ? 'steps'
        : isActive
          ? 'preparing'
          : null;
  return {
    isActive,
    completedSteps,
    totalSteps,
    progressPercent,
    currentStep,
    helperText,
  };
}
