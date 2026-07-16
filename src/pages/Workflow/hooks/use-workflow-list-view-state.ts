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
 * 挂在 WorkflowRoutes 层：列表 ↔ 编辑/新增/生成 之间切换路由时父组件不卸载，
 * 状态得以保留（如从草稿进编辑再返回仍停在草稿箱）；离开 /workflow 区块
 * 切到其他菜单时父组件卸载，状态自动重置为默认。
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
