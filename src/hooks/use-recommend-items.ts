/**
 * 推荐位条目数据 Hook
 */
import { useState, useEffect, useCallback } from 'react';
import { fetchRecommendItems, type RecommendItem, type RecommendPositionKey } from '@/lib/recommend-api';

interface UseRecommendItemsResult {
  items: RecommendItem[];
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

export function useRecommendItems(
  positionKey: RecommendPositionKey | null,
): UseRecommendItemsResult {
  const [items, setItems] = useState<RecommendItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    if (!positionKey) {
      setItems([]);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const result = await fetchRecommendItems(positionKey);
      setItems(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [positionKey]);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  return { items, loading, error, refetch };
}
