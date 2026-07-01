/** 工作流 API 响应 → 前端 UI 卡片模型的映射层 */
import type { WorkflowCardItem, OfficialWorkflowCard, WorkflowCoverKey, WorkflowMineListKind } from '@/pages/Workflow/types';
import type { WorkflowSummary, WorkflowTemplateMineItem, WorkflowTemplateScope } from '../../../shared/workflow-api';
import { asWorkflowId } from '../../../shared/workflow-api';

const COVER_KEYS: WorkflowCoverKey[] = ['cover-1', 'cover-2', 'cover-3', 'cover-4', 'cover-5'];

/** 按 workflow id 稳定映射头图，避免列表刷新闪烁 */
export function pickCoverKeyFromWorkflowId(id: string): WorkflowCoverKey {
  let hash = 0;
  for (let i = 0; i < id.length; i += 1) {
    hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  }
  return COVER_KEYS[hash % COVER_KEYS.length];
}

/** 从 API 状态字段推导「我的工作流」二级 Tab */
export function deriveWorkflowListKind(summary: WorkflowSummary): WorkflowMineListKind {
  if (summary.lifecycleStatus === 'draft') {
    return 'draft';
  }
  if (summary.lifecycleStatus === 'active') {
    return 'published';
  }
  return 'draft';
}

/** 将分页 API 摘要映射为列表卡片模型（缺失字段用占位） */
export function mapWorkflowSummaryToCardItem(
  summary: WorkflowSummary,
  t: (key: string) => string,
): WorkflowCardItem {
  const listKind = deriveWorkflowListKind(summary);
  const isDraft = listKind === 'draft';

  return {
    id: asWorkflowId(summary.id),
    name: summary.name,
    listKind,
    schedule: isDraft ? t('card.noScheduleDraft') : t('card.noSchedule'),
    enabled: listKind === 'published',
    description: t('card.noDescription'),
    coverKey: pickCoverKeyFromWorkflowId(summary.id),
    flow: [],
    isCustom: true,
    neverRun: summary.updatedAt === null,
    ...(isDraft ? { scheduleMuted: true, showPausedLabel: false } : {}),
  };
}

/** 将原始 JSON 对象安全解析为 WorkflowSummary（字段缺失时用默认值兜底） */
export function parseWorkflowSummary(raw: Record<string, unknown>): WorkflowSummary {
  return {
    id: asWorkflowId(String(raw.id ?? '')),
    name: String(raw.name ?? ''),
    templateId: raw.templateId != null ? String(raw.templateId) : null,
    version: Number(raw.version) || 1,
    lifecycleStatus: String(raw.lifecycleStatus ?? 'draft') as WorkflowSummary['lifecycleStatus'],
    updatedAt: raw.updatedAt != null ? String(raw.updatedAt) : null,
    createdBy: raw.createdBy != null ? String(raw.createdBy) : null,
    createdByName: raw.createdByName != null ? String(raw.createdByName) : null,
    updatedBy: raw.updatedBy != null ? String(raw.updatedBy) : null,
    updatedByName: raw.updatedByName != null ? String(raw.updatedByName) : null,
  };
}

/** @api docs/api-contracts/workflows/template-mine.md */
export function parseTemplateMineItem(raw: Record<string, unknown>): WorkflowTemplateMineItem {
  return {
    id: String(raw.id ?? ''),
    label: String(raw.label ?? ''),
    description: raw.description != null ? String(raw.description) : null,
    category: raw.category != null ? String(raw.category) : null,
    scope: String(raw.scope ?? 'system') as WorkflowTemplateScope,
    ownerUserId: raw.ownerUserId != null ? String(raw.ownerUserId) : null,
    createdAt: raw.createdAt != null ? String(raw.createdAt) : null,
    updatedAt: raw.updatedAt != null ? String(raw.updatedAt) : null,
    nodeCount: Number(raw.nodeCount) || 0,
    nodes: Array.isArray(raw.nodes) ? raw.nodes as Record<string, unknown>[] : [],
    edges: Array.isArray(raw.edges) ? raw.edges as Record<string, unknown>[] : [],
  };
}

/** @api docs/api-contracts/workflows/template-mine.md — scope=system 映射为官方推荐卡片 */
export function mapTemplateMineItemToOfficialCard(
  item: WorkflowTemplateMineItem,
): OfficialWorkflowCard {
  return {
    id: item.id,
    name: item.label,
    category: item.category ?? '',
    schedule: '',
    description: item.description ?? '',
    flow: item.nodes.map((n: Record<string, unknown>) => String(n.label ?? n.type ?? '')),
    coverKey: pickCoverKeyFromWorkflowId(item.id),
  };
}

/** @api docs/api-contracts/workflows/template-mine.md */
export function mapTemplateMineItemToCardItem(
  item: WorkflowTemplateMineItem,
  t: (key: string) => string,
): WorkflowCardItem {
  const isSystem = item.scope === 'system';
  const listKind: WorkflowMineListKind = isSystem ? 'published' : 'draft';

  return {
    id: item.id,
    name: item.label,
    listKind,
    schedule: t('card.noSchedule'),
    enabled: isSystem,
    description: item.description ?? t('card.noDescription'),
    coverKey: pickCoverKeyFromWorkflowId(item.id),
    flow: item.nodes.map((n: Record<string, unknown>) => String(n.label ?? n.type ?? '')),
    isCustom: !isSystem,
    neverRun: item.updatedAt === null,
    ...(isSystem ? {} : { scheduleMuted: true, showPausedLabel: false }),
  };
}
