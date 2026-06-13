/** 工作流 API 响应 → 前端 UI 卡片模型的映射层 */
import type { TFunction } from 'i18next';
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
  if (summary.lifecycleStatus === 'draft' || summary.versionStatus === 'draft') {
    return 'draft';
  }
  if (summary.versionStatus === 'published' && summary.lifecycleStatus === 'active') {
    return 'published';
  }
  return 'draft';
}

/** 格式化 updatedAt 为可读时间文案，null 或非法日期回退为「尚未更新」 */
function formatUpdatedAtLabel(updatedAt: string | null, t: TFunction<'workflow'>): string {
  if (updatedAt === null) {
    return t('list.neverUpdated');
  }
  const date = new Date(updatedAt);
  if (Number.isNaN(date.getTime())) {
    return t('list.neverUpdated');
  }
  return t('list.updatedAt', {
    time: new Intl.DateTimeFormat(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(date),
  });
}

/** 将分页 API 摘要映射为列表卡片模型（缺失字段用占位） */
export function mapWorkflowSummaryToCardItem(
  summary: WorkflowSummary,
  t: TFunction<'workflow'>,
): WorkflowCardItem {
  const listKind = deriveWorkflowListKind(summary);
  const isDraft = listKind === 'draft';

  return {
    id: asWorkflowId(summary.id),
    name: summary.name,
    listKind,
    category: '',
    schedule: isDraft ? t('card.noScheduleDraft') : t('card.noSchedule'),
    scheduleIcon: 'clock',
    enabled: listKind === 'published',
    description: t('card.noDescription'),
    flow: [],
    lastRun: formatUpdatedAtLabel(summary.updatedAt, t),
    coverKey: pickCoverKeyFromWorkflowId(summary.id),
    isCustom: true,
    neverRun: summary.updatedAt === null,
    ...(isDraft ? { scheduleMuted: true, showPausedLabel: false } : {}),
    ...(listKind === 'published' ? { runSuccess: false } : {}),
  };
}

/** 将原始 JSON 对象安全解析为 WorkflowSummary（字段缺失时用默认值兜底） */
export function parseWorkflowSummary(raw: Record<string, unknown>): WorkflowSummary {
  return {
    id: asWorkflowId(String(raw.id ?? '')),
    name: String(raw.name ?? ''),
    version: Number(raw.version) || 1,
    lifecycleStatus: String(raw.lifecycleStatus ?? 'draft') as WorkflowSummary['lifecycleStatus'],
    versionStatus: String(raw.versionStatus ?? 'draft') as WorkflowSummary['versionStatus'],
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
    scheduleIcon: 'clock',
    description: item.description ?? '',
    flow: [],
    coverKey: pickCoverKeyFromWorkflowId(item.id),
  };
}

/** @api docs/api-contracts/workflows/template-mine.md */
export function mapTemplateMineItemToCardItem(
  item: WorkflowTemplateMineItem,
  t: TFunction<'workflow'>,
): WorkflowCardItem {
  const scope = item.scope;
  const isSystem = scope === 'system';
  const listKind: WorkflowMineListKind = isSystem ? 'published' : 'draft';

  return {
    id: item.id,
    name: item.label,
    scope,
    listKind,
    category: item.category ?? '',
    schedule: t('card.noSchedule'),
    scheduleIcon: 'clock',
    enabled: isSystem,
    description: item.description ?? t('card.noDescription'),
    flow: [],
    lastRun: formatUpdatedAtLabel(item.updatedAt, t),
    coverKey: pickCoverKeyFromWorkflowId(item.id),
    isCustom: !isSystem,
    neverRun: item.updatedAt === null,
    ...(isSystem ? { runSuccess: false } : { scheduleMuted: true, showPausedLabel: false }),
  };
}
