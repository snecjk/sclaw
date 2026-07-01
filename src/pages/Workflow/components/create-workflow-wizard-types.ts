/** 新建工作流表单数据 — 对齐 memory-center CreateWorkflowPage */

import type { WorkflowEdge, WorkflowNode } from '@/pages/WorkflowDesigner/types';

export type CreateWorkflowWizardData = {
  name: string;
  description: string;
  category: string;
  templateId: string;
  templateLabel: string;
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
};

/** MC `WORKFLOW_CATEGORIES` — 字典 API 失败时的兜底 */
export const WORKFLOW_CATEGORIES = ['法务', '运营', '人事', '财务', '通用'] as const;

export type WorkflowCategoryOption = { value: string; label: string };

export function buildFallbackWorkflowCategoryOptions(): WorkflowCategoryOption[] {
  return WORKFLOW_CATEGORIES.map((c) => ({ value: c, label: c }));
}

export function categoryLabel(value: string, options?: WorkflowCategoryOption[]): string {
  const list = options ?? buildFallbackWorkflowCategoryOptions();
  const matched = list.find((c) => c.value === value)?.label;
  return matched ?? (value.trim() || '—');
}

export const BLANK_TEMPLATE_LABEL = '空白';
