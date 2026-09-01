import type { AppDevPhase } from '@/lib/app-dev-api';

export type AppDevSetupStepId = 'tools' | 'deps' | 'start';
export type AppDevSetupStepState = 'pending' | 'active' | 'done';

export interface AppDevSetupStep {
  id: AppDevSetupStepId;
  title: string;
  hint?: string;
  state: AppDevSetupStepState;
}

function stateFor(activeIndex: number, index: number): AppDevSetupStepState {
  if (index < activeIndex) return 'done';
  if (index === activeIndex) return 'active';
  return 'pending';
}

/** Visible setup steps while the preview is not ready yet. */
export function appDevSetupSteps(phase: AppDevPhase, detail?: string): AppDevSetupStep[] {
  const activeIndex = phase === 'starting'
    ? 2
    : phase === 'installing'
      ? 1
      : 0;
  const toolsHint = phase === 'preparing-env'
    ? '正在准备 Node 运行时'
    : phase === 'checking-snpm'
      ? (detail?.trim() || '正在检测 snpm')
      : phase === 'created'
        ? '即将开始'
        : undefined;

  return [
    {
      id: 'tools',
      title: '准备工具',
      hint: activeIndex === 0 ? toolsHint : (activeIndex > 0 ? 'snpm 已就绪' : undefined),
      state: stateFor(activeIndex, 0),
    },
    {
      id: 'deps',
      title: '执行依赖',
      hint: activeIndex === 1 ? (detail?.trim() || '正在安装前端依赖') : undefined,
      state: stateFor(activeIndex, 1),
    },
    {
      id: 'start',
      title: '执行启动',
      hint: activeIndex === 2 ? (detail?.trim() || '正在启动预览') : undefined,
      state: stateFor(activeIndex, 2),
    },
  ];
}

export function appDevSetupHeadline(phase: AppDevPhase): string {
  switch (phase) {
    case 'preparing-env':
      return '正在准备运行环境…';
    case 'checking-snpm':
      return '正在检测 snpm…';
    case 'installing':
      return '正在执行依赖…';
    case 'starting':
      return '正在执行启动…';
    case 'created':
      return '正在准备运行环境…';
    default:
      return '正在准备应用…';
  }
}
