/** 仅获取「我的工作流-已发布」列表的轻量 hook，与 Workflow 页 useWorkflowList 解耦。 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { hostApiFetch } from '@/lib/host-api';
import { useMinLoading } from '@/hooks/use-min-loading';

export interface MyPublishedWorkflow {
  id: string;
  name: string;
  description: string;
}

interface MineWorkflowResponse {
  success?: boolean;
  data?: Array<{
    id: string;
    name: string;
    description?: string;
    templateId?: string;
    /** 工作流生命周期状态：draft / active  */
    lifecycleStatus?: string;
    updatedAt?: string;
  }>;
}

export interface UseMyPublishedWorkflowsResult {
  workflows: MyPublishedWorkflow[];
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

/**
 * 拉取当前用户已发布（lifecycle_status=ACTIVE）的工作流，最新 100 条。
 * 与 `useWorkflowList` 解耦：不拉 draft / official，仅服务于聊天框 picker。
 */
// FastAPI: GET /agent/v1/my-workflow → memory-center workflow_client.py:list_my_workflows
export function useMyPublishedWorkflows(): UseMyPublishedWorkflowsResult {
  const [workflows, setWorkflows] = useState<MyPublishedWorkflow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const seqRef = useRef(0);

  const refetch = useCallback(async () => {
    const seq = ++seqRef.current;
    setLoading(true);
    setError(null);

    try {
      // Electron 透传 query 至 FastAPI，需用 snake_case 与后端 Query 参数对齐
      const params = new URLSearchParams({
        page: '1',
        page_size: '100',
        lifecycle_status: 'ACTIVE',
      });
      const res = await hostApiFetch<MineWorkflowResponse>(
        `/api/my-tasks/agent/v1/my-workflow?${params.toString()}`
      );
      if (seqRef.current !== seq) return;

      if (res.success === false) {
        setWorkflows([]);
        return;
      }
      const items = (res.data ?? []).map((item) => ({
        id: item.id,
        name: item.name,
        description: item.description ?? '',
      }));
      setWorkflows(items);
    } catch (err) {
      if (seqRef.current !== seq) return;
      setWorkflows([]);
      setError(err instanceof Error ? err.message : '加载失败');
    } finally {
      if (seqRef.current === seq) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  return {
    workflows,
    loading: useMinLoading(loading),
    error,
    refetch,
  };
}
