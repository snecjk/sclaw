import { useCallback, useEffect, useRef, useState } from 'react';
import { listWorkflowTemplates } from '@/lib/workflow-api';
import { useMinLoading } from '@/hooks/use-min-loading';

export interface HomeOfficialTemplateItem {
  id: string;
  label: string;
  category: string;
  description: string;
  nodeCount: number;
}

export interface UseHomeOfficialWorkflowsResult {
  templates: HomeOfficialTemplateItem[];
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

export function useHomeOfficialWorkflows(): UseHomeOfficialWorkflowsResult {
  const [templates, setTemplates] = useState<HomeOfficialTemplateItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const fetchSeqRef = useRef(0);

  const fetch = useCallback(async () => {
    const seq = fetchSeqRef.current + 1;
    fetchSeqRef.current = seq;
    setLoading(true);
    setError(null);

    try {
      const officialResult = await listWorkflowTemplates({ page: 1, pageSize: 100 });

      if (fetchSeqRef.current !== seq) return;

      const officialItems = (officialResult.items ?? []).map((item) => ({
        id: String(item.id ?? ''),
        label: String(item.label ?? ''),
        category: item.category != null ? String(item.category) : '',
        description: item.description != null ? String(item.description) : '',
        nodeCount: Number(item.nodeCount) || 0,
      }));

      setTemplates(officialItems);
    } catch (err) {
      if (fetchSeqRef.current !== seq) return;
      const message = err instanceof Error ? err.message : 'Failed to fetch official workflows';
      setError(message);
      setTemplates([]);
    } finally {
      if (fetchSeqRef.current === seq) setLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) {
        void fetch();
      }
    });
    return () => {
      cancelled = true;
    };
  }, [fetch]);

  return {
    templates,
    loading: useMinLoading(loading),
    error,
    refetch: fetch,
  };
}
