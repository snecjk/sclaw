import type { WorkflowCardItem, OfficialWorkflowCard, WorkflowCoverKey, WorkflowMineListKind } from '@/types/workflow-list';
import type { WorkflowSummary, WorkflowTemplateMineItem, WorkflowTemplateScope } from '../../shared/workflow-api';
import { asWorkflowId } from '../../shared/workflow-api';

const COVER_KEYS: WorkflowCoverKey[] = ['cover-1', 'cover-2', 'cover-3', 'cover-4', 'cover-5'];

export function pickCoverKeyFromWorkflowId(id: string): WorkflowCoverKey {
  let hash = 0;
  for (let i = 0; i < id.length; i += 1) {
    hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  }
  return COVER_KEYS[hash % COVER_KEYS.length];
}

export function deriveWorkflowListKind(summary: WorkflowSummary): WorkflowMineListKind {
  return summary.lifecycleStatus === 'active' ? 'published' : 'draft';
}

export function mapWorkflowSummaryToCardItem(
  summary: WorkflowSummary,
  t: (key: string) => string,
): WorkflowCardItem {
  const listKind = deriveWorkflowListKind(summary);
  return {
    id: asWorkflowId(summary.id),
    name: summary.name,
    listKind,
    enabled: listKind === 'published',
    description: t('card.noDescription'),
    coverKey: pickCoverKeyFromWorkflowId(summary.id),
    flow: [],
    neverRun: summary.updatedAt === null,
  };
}

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

export function mapTemplateMineItemToOfficialCard(
  item: WorkflowTemplateMineItem,
): OfficialWorkflowCard {
  return {
    id: item.id,
    name: item.label,
    category: item.category ?? '',
    description: item.description ?? '',
    flow: item.nodes.map((node) => String(node.label ?? node.type ?? '')),
    coverKey: pickCoverKeyFromWorkflowId(item.id),
  };
}

export function mapTemplateMineItemToCardItem(
  item: WorkflowTemplateMineItem,
  t: (key: string) => string,
): WorkflowCardItem {
  const isSystem = item.scope === 'system';
  return {
    id: item.id,
    name: item.label,
    listKind: isSystem ? 'published' : 'draft',
    enabled: isSystem,
    description: item.description ?? t('card.noDescription'),
    coverKey: pickCoverKeyFromWorkflowId(item.id),
    flow: item.nodes.map((node) => String(node.label ?? node.type ?? '')),
    neverRun: item.updatedAt === null,
  };
}
