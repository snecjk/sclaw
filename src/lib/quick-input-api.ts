/**
 * 快捷输入 API（prompts / source=sclaw）
 *
 * 对接 memory-center: /ai-memory/agent/v1/prompts/*
 */
import { hostApiFetch } from '@/lib/host-api';
import type { QuickInputItem } from '@/components/quick-input/types';
import { QUICK_INPUT_LIST_CAP } from '@/components/quick-input/types';

const QUICK_INPUT_BASE = '/ai-memory/agent/v1/prompts';

type ApiEnvelope<T> = {
  success: boolean;
  data?: T | null;
  errCode?: string | number | null;
  errMessage?: string | null;
  total?: number;
  page?: number;
  pageSize?: number;
};

export type PromptApiItem = {
  id: number | string;
  name?: string | null;
  content?: string | null;
  sortOrder?: number | null;
};

function mapPromptToQuickInput(row: PromptApiItem): QuickInputItem {
  const content = String(row.content ?? '');
  // 展示标题仅取 content 首行，不依赖后端 name
  const title = content.split('\n')[0]?.trim() || content;
  return {
    id: String(row.id),
    title,
    content,
  };
}

async function unwrap<T>(promise: Promise<ApiEnvelope<T>>): Promise<T> {
  const res = await promise;
  if (!res.success || res.data === null || res.data === undefined) {
    throw new Error(res.errMessage || String(res.errCode || '快捷输入请求失败'));
  }
  return res.data;
}

/** 分页列表；pageSize 默认 99 */
export async function listQuickInputs(params?: {
  keyword?: string;
  pageNo?: number;
  pageSize?: number;
}): Promise<{ items: QuickInputItem[]; total: number }> {
  const pageSize = Math.min(
    params?.pageSize ?? QUICK_INPUT_LIST_CAP,
    QUICK_INPUT_LIST_CAP,
  );
  const res = await hostApiFetch<ApiEnvelope<PromptApiItem[]>>(`${QUICK_INPUT_BASE}/page`, {
    method: 'POST',
    body: JSON.stringify({
      page_no: params?.pageNo ?? 1,
      page_size: pageSize,
      keyword: params?.keyword?.trim() || undefined,
    }),
  });
  if (!res.success) {
    throw new Error(res.errMessage || String(res.errCode || '快捷输入列表加载失败'));
  }
  const rows = Array.isArray(res.data) ? res.data : [];
  return {
    items: rows.map(mapPromptToQuickInput),
    total: typeof res.total === 'number' ? res.total : rows.length,
  };
}

export async function createQuickInput(content: string): Promise<QuickInputItem> {
  const data = await unwrap(
    hostApiFetch<ApiEnvelope<PromptApiItem>>(QUICK_INPUT_BASE, {
      method: 'POST',
      body: JSON.stringify({ content }),
    }),
  );
  return mapPromptToQuickInput(data);
}

export async function updateQuickInput(
  id: string,
  content: string,
): Promise<QuickInputItem> {
  const data = await unwrap(
    hostApiFetch<ApiEnvelope<PromptApiItem>>(`${QUICK_INPUT_BASE}/${id}`, {
      method: 'PUT',
      body: JSON.stringify({ content }),
    }),
  );
  return mapPromptToQuickInput(data);
}

export async function deleteQuickInput(id: string): Promise<void> {
  await unwrap(
    hostApiFetch<ApiEnvelope<{ id: number; deleted: boolean }>>(
      `${QUICK_INPUT_BASE}/${id}/delete`,
      { method: 'POST', body: JSON.stringify({}) },
    ),
  );
}

/** 完整窗重排：orderedIds 须为当前可见列表完整顺序（从上到下），不可残缺 */
export async function reorderQuickInputs(orderedIds: string[]): Promise<QuickInputItem[]> {
  const data = await unwrap(
    hostApiFetch<ApiEnvelope<{ items: PromptApiItem[]; total: number }>>(
      `${QUICK_INPUT_BASE}/reorder`,
      {
        method: 'POST',
        body: JSON.stringify({
          orderedIds: orderedIds.map((id) => Number(id)).filter((n) => Number.isFinite(n)),
        }),
      },
    ),
  );
  return (data.items ?? []).map(mapPromptToQuickInput);
}
