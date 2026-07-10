/**
 * ProcessRailLayout — 竖线对齐标题行语义 icon 中心（非 running 状态猜测）
 *
 * 对齐 docs/对话流三项问题全局修复-Cursor执行文档.md §3.3
 */

export interface ProcessHeaderLayout {
  /** 标题行 semantic icon 前是否渲染了 chevron / spinner */
  hasLeadingControlBeforeSemanticIcon: boolean;
}

export type ProcessHeaderVariant =
  | 'collapsible_chevron_before_icon'
  | 'collapsible_chevron_after_icon'
  | 'readonly_title'
  | 'running_spinner_before_icon';

/** 根据标题行实际结构推导竖线 leading offset */
export function resolveProcessHeaderLayout(variant: ProcessHeaderVariant): ProcessHeaderLayout {
  return {
    hasLeadingControlBeforeSemanticIcon:
      variant === 'collapsible_chevron_before_icon'
      || variant === 'running_spinner_before_icon',
  };
}
