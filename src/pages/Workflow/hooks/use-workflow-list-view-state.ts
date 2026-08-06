import { useState } from 'react';

export type WorkflowListTab = 'mine' | 'official';
export type WorkflowMineFilter = 'published' | 'draft';

export interface WorkflowListViewState {
  tab: WorkflowListTab;
  setTab: (tab: WorkflowListTab) => void;
  mineFilter: WorkflowMineFilter;
  setMineFilter: (filter: WorkflowMineFilter) => void;
}

/**
 * 工作流列表视图筛选状态。
 * 挂在 MyTask 工作流 Tab：在「我的任务」内切 Tab 时父组件不卸载，状态保留；
 * 离开 /my-tasks（或进入 /workflow 编辑页）时卸载，状态重置为默认。
 */
export function useWorkflowListViewState(): WorkflowListViewState {
  const [tab, setTab] = useState<WorkflowListTab>('mine');
  const [mineFilter, setMineFilter] = useState<WorkflowMineFilter>('published');

  return {
    tab,
    setTab,
    mineFilter,
    setMineFilter,
  };
}
