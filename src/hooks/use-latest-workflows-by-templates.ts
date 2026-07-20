/**
 * 各模版当前用户最近工作流实例摘要 Hook
 *
 * 给定一组模版 ID，批量查询当前用户在各模版下最近的实例。
 * - 返回 Map<templateId, MyWorkflowSummary | null>；无实例的模版对应 null。
 * - 支持手动 refetch 与按 templateIds 变化自动重取。
 */
import { useState, useEffect, useCallback } from 'react';
import { hostApiFetch } from '@/lib/host-api';
import type { ApiResponse, MyWorkflowSummary } from '@/types/workflow';

// 以稳定的字符串键作为依赖，避免数组引用每次渲染变化导致死循环重取。
function stableKey(ids: string[]): string {
  return [...ids].sort().join('|');
}

interface UseLatestWorkflowsByTemplatesResult {
  data: Map<string, MyWorkflowSummary | null>;
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

export function useLatestWorkflowsByTemplates(
  templateIds: string[],
): UseLatestWorkflowsByTemplatesResult {
  const [data, setData] = useState<Map<string, MyWorkflowSummary | null>>(new Map());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const templateIdsKey = stableKey(templateIds);

  const refetch = useCallback(async () => {
    const ids = templateIds.filter((id) => typeof id === 'string' && id.trim());
    if (ids.length === 0) {
      setData(new Map());
      setLoading(false);
      setError(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await hostApiFetch<
        ApiResponse<Record<string, MyWorkflowSummary | null>>
      >('/ai-memory/agent/v1/workflows/latest-by-templates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ templateIds: ids }),
      });
      if (!res.success || res.data === null) {
        throw new Error(
          res.errMessage ||
            (res.errCode ? `Workflow API error: ${res.errCode}` : 'Workflow API error')
        );
      }
      const result = new Map<string, MyWorkflowSummary | null>();
      for (const id of ids) result.set(id, res.data[id] ?? null);
      setData(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setData(new Map());
    } finally {
      setLoading(false);
    }
  }, [templateIdsKey]);

  useEffect(() => {
     // eslint-disable-next-line react-hooks/set-state-in-effect
     refetch();
  }, [refetch]);

  return { data, loading, error, refetch };
}

export type { MyWorkflowSummary };
