/**
 * 推荐位条目数据 Hook
 */
import { useState, useEffect, useCallback } from 'react';
import {
  fetchRecommendItems,
  type RecommendCategory,
  type RecommendItem,
  type RecommendPositionKey,
} from '@/lib/recommend-api';

interface UseRecommendItemsResult {
  items: RecommendItem[];
  categories: RecommendCategory[];
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

export function useRecommendItems(
  positionKey: RecommendPositionKey | null,
): UseRecommendItemsResult {
  const [items, setItems] = useState<RecommendItem[]>([]);
  const [categories, setCategories] = useState<RecommendCategory[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    if (!positionKey) {
      setItems([]);
      setCategories([]);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const result = await fetchRecommendItems(positionKey);
      setItems(result.items);
      setCategories(result.categories);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setItems([]);
      setCategories([]);
    } finally {
      setLoading(false);
    }
  }, [positionKey]);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  return { items, categories, loading, error, refetch };
}
