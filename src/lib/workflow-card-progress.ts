import type { WorkflowExecutionState } from '@/types/workflow';

export function getWorkflowProgressDetails(state: WorkflowExecutionState): {
  isActive: boolean;
  completedSteps: number;
  totalSteps: number;
  currentStep?: string;
  helperText: 'preparing' | 'steps' | 'waitingApproval' | 'waitingInput' | null;
} {
  const isActive = state.status === 'running'
    || state.status === 'waiting_approval'
    || state.status === 'waiting_input'
    || state.status === 'pending';
  const totalSteps = state.steps.length;
  const completedSteps = state.steps.filter((step) => step.status === 'completed').length;
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
  return { isActive, completedSteps, totalSteps, currentStep, helperText };
}
