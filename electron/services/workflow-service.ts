/**
 * Workflow Service
 *
 * Proxies workflow list endpoints from STO AI Memory Center.
 * @api docs/api-contracts/workflows/page.md
 */

import { getStoToken, getAuthState } from '../utils/auth-store';
import { buildStoMemoryCenterAuthHeaders } from '../utils/sto-memory-api-auth';
import { resolveStoBaseUrl } from '../utils/sto-domain';
import { logger } from '../utils/logger';
import type {
  WorkflowSummary,
  WorkflowPageRequest,
  WorkflowTemplateMineItem,
} from '../../shared/workflow-api';
import { asWorkflowId } from '../../shared/workflow-api';

// ---------------------------------------------------------------------------
// Service-level result wrappers (pagination metadata from upstream)
// ---------------------------------------------------------------------------

export interface WorkflowPageResult {
  items: WorkflowSummary[];
  total: number;
  page: number;
  pageSize: number;
  traceId: string;
}

export interface TemplateMineResult {
  items: WorkflowTemplateMineItem[];
  total: number;
  page: number;
  pageSize: number;
  traceId: string;
}

const MAX_PAGE_SIZE = 100;
const MAX_AGGREGATED_ITEMS = 500;

function mapSummary(raw: Record<string, unknown>): WorkflowSummary {
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

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class WorkflowService {
  private async buildHeaders(): Promise<Record<string, string>> {
    const token = await getStoToken();
    if (!token) throw new Error('未登录或 stoToken 已过期，请重新登录');
    return {
      ...buildStoMemoryCenterAuthHeaders(token),
      'Content-Type': 'application/json',
      'X-Source-Client': 'sto-claw',
    };
  }

  private async resolvePageUrl(): Promise<string> {
    const stoBaseUrl = await resolveStoBaseUrl();
    return `${stoBaseUrl}/agent/v1/workflows/page`;
  }

  private async resolveCreatedBy(explicit?: string | null): Promise<string | null> {
    const trimmed = (explicit ?? '').trim();
    if (trimmed) return trimmed;
    const authState = await getAuthState();
    const empCode = authState.user?.empCode?.trim();
    return empCode || null;
  }

  async fetchWorkflowPage(input: WorkflowPageRequest = {}): Promise<WorkflowPageResult> {
    const url = await this.resolvePageUrl();
    const headers = await this.buildHeaders();
    const page = Math.max(1, input.page ?? 1);
    const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, input.pageSize ?? 20));
    const createdBy = await this.resolveCreatedBy(input.createdBy);
    const keyword = (input.keyword ?? '').trim() || null;

    const body = {
      page,
      pageSize,
      ...(createdBy ? { createdBy } : {}),
      ...(keyword ? { keyword } : {}),
    };

    logger.info(`[WorkflowService] >>> fetchWorkflowPage url=${url} body=${JSON.stringify(body)}`);

    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });
    const bodyText = await res.text();
    logger.info(`[WorkflowService] <<< fetchWorkflowPage status=${res.status} body=${bodyText.slice(0, 500)}`);

    if (!res.ok) {
      throw new Error(`Workflow list failed (${res.status}): ${bodyText}`);
    }

    const data = JSON.parse(bodyText) as {
      success?: boolean;
      data?: Record<string, unknown>[];
      total?: number;
      page?: number;
      pageSize?: number;
      traceId?: string;
      errMessage?: string;
    };

    if (data.success === false) {
      throw new Error(data.errMessage || 'Workflow list failed');
    }

    const items = (data.data ?? []).map((item) => mapSummary(item));
    return {
      items,
      total: Number(data.total) || items.length,
      page: Number(data.page) || page,
      pageSize: Number(data.pageSize) || pageSize,
      traceId: String(data.traceId ?? ''),
    };
  }

  /** 拉取当前用户全部工作流（自动翻页，上限 MAX_AGGREGATED_ITEMS） */
  async listMyWorkflows(keyword?: string | null): Promise<WorkflowPageResult> {
    const pageSize = MAX_PAGE_SIZE;
    let page = 1;
    let aggregated: WorkflowSummary[] = [];
    let total = 0;
    let traceId = '';

    while (aggregated.length < MAX_AGGREGATED_ITEMS) {
      const result = await this.fetchWorkflowPage({ page, pageSize, keyword });
      aggregated = aggregated.concat(result.items);
      total = result.total;
      traceId = result.traceId;
      if (aggregated.length >= total || result.items.length === 0) {
        break;
      }
      page += 1;
    }

    if (aggregated.length > MAX_AGGREGATED_ITEMS) {
      aggregated = aggregated.slice(0, MAX_AGGREGATED_ITEMS);
    }

    return {
      items: aggregated,
      total,
      page: 1,
      pageSize: aggregated.length,
      traceId,
    };
  }

  /** @api docs/api-contracts/workflows/template-mine.md */
  async fetchMineTemplates(
    keyword?: string | null,
    page?: number,
    pageSize?: number,
  ): Promise<TemplateMineResult> {
    const stoBaseUrl = await resolveStoBaseUrl();
    const url = `${stoBaseUrl}/agent/v1/workflow-templates/mine`;
    const headers = await this.buildHeaders();
    const normalizedPage = Math.max(1, page ?? 1);
    const normalizedPageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, pageSize ?? 100));
    const normalizedKeyword = (keyword ?? '').trim() || null;

    const body = {
      page: normalizedPage,
      pageSize: normalizedPageSize,
      ...(normalizedKeyword ? { keyword: normalizedKeyword } : {}),
    };

    logger.info(`[WorkflowService] >>> fetchMineTemplates url=${url} body=${JSON.stringify(body)}`);

    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });
    const bodyText = await res.text();
    logger.info(`[WorkflowService] <<< fetchMineTemplates status=${res.status} body=${bodyText.slice(0, 500)}`);

    if (!res.ok) {
      throw new Error(`Mine templates failed (${res.status}): ${bodyText}`);
    }

    const data = JSON.parse(bodyText) as {
      success?: boolean;
      data?: Record<string, unknown>[];
      total?: number;
      page?: number;
      pageSize?: number;
      traceId?: string;
      errMessage?: string;
    };

    if (data.success === false) {
      throw new Error(data.errMessage || 'Mine templates failed');
    }

    const items = (data.data ?? []).map((raw): WorkflowTemplateMineItem => ({
      id: String(raw.id ?? ''),
      label: String(raw.label ?? ''),
      description: raw.description != null ? String(raw.description) : null,
      category: raw.category != null ? String(raw.category) : null,
      scope: String(raw.scope ?? 'system') as WorkflowTemplateMineItem['scope'],
      ownerUserId: raw.ownerUserId != null ? String(raw.ownerUserId) : null,
      createdAt: raw.createdAt != null ? String(raw.createdAt) : null,
      updatedAt: raw.updatedAt != null ? String(raw.updatedAt) : null,
      nodeCount: Number(raw.nodeCount) || 0,
      nodes: Array.isArray(raw.nodes) ? (raw.nodes as Record<string, unknown>[]) : [],
      edges: Array.isArray(raw.edges) ? (raw.edges as Record<string, unknown>[]) : [],
    }));

    return {
      items,
      total: Number(data.total) || items.length,
      page: Number(data.page) || normalizedPage,
      pageSize: Number(data.pageSize) || normalizedPageSize,
      traceId: String(data.traceId ?? ''),
    };
  }
}

let workflowServiceInstance: WorkflowService | null = null;

export function getWorkflowService(): WorkflowService {
  if (!workflowServiceInstance) {
    workflowServiceInstance = new WorkflowService();
  }
  return workflowServiceInstance;
}

export function resetWorkflowService(): void {
  workflowServiceInstance = null;
}
