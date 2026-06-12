import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { hostApiFetch } from '@/lib/host-api';
import { normalizeAppError } from '@/lib/error-model';
import { mapWorkflowSummaryToCardItem, parseWorkflowSummary } from '@/pages/Workflow/workflow-mapper';
import { useMinLoading } from '@/hooks/use-min-loading';
import type { WorkflowCardItem, WorkflowMineListKind } from '@/pages/Workflow/types';

interface WorkflowListApiResponse {
  success?: boolean;
  data?: Record<string, unknown>[];
  total?: number;
  traceId?: string;
  error?: string;
}

const SEARCH_DEBOUNCE_MS = 300;

export interface UseWorkflowListResult {
  cards: WorkflowCardItem[];
  setCards: React.Dispatch<React.SetStateAction<WorkflowCardItem[]>>;
  appendLocalCard: (card: WorkflowCardItem) => void;
  isLoading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
  setSearchKeyword: (keyword: string) => void;
  mineCounts: Record<WorkflowMineListKind, number>;
}

function countByListKind(cards: WorkflowCardItem[]): Record<WorkflowMineListKind, number> {
  return {
    published: cards.filter((c) => c.listKind === 'published').length,
    installed: cards.filter((c) => c.listKind === 'installed').length,
    draft: cards.filter((c) => c.listKind === 'draft').length,
  };
}

export function useWorkflowList(): UseWorkflowListResult {
  const { t } = useTranslation('workflow');
  const [cards, setCards] = useState<WorkflowCardItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchKeyword, setSearchKeyword] = useState('');
  const [debouncedKeyword, setDebouncedKeyword] = useState('');
  const [mineCounts, setMineCounts] = useState<Record<WorkflowMineListKind, number>>(
    countByListKind([]),
  );
  const fetchSeq = useRef(0);
  const localOnlyIdsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedKeyword(searchKeyword.trim());
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [searchKeyword]);

  const fetchWorkflows = useCallback(async () => {
    const seq = fetchSeq.current + 1;
    fetchSeq.current = seq;
    setIsLoading(true);
    setError(null);

    try {
      const query = debouncedKeyword
        ? `?keyword=${encodeURIComponent(debouncedKeyword)}`
        : '';
      // @api docs/api-contracts/workflows/page.md
      const response = await hostApiFetch<WorkflowListApiResponse>(`/api/workflows${query}`);

      if (fetchSeq.current !== seq) return;

      if (response.success === false) {
        throw new Error(response.error || t('list.loadFailed'));
      }

      const apiCards = (response.data ?? []).map((item) =>
        mapWorkflowSummaryToCardItem(parseWorkflowSummary(item), t),
      );

      setCards((prev) => {
        const localOnly = prev.filter((c) => localOnlyIdsRef.current.has(c.id));
        const merged = [...apiCards, ...localOnly];
        setMineCounts(countByListKind(merged));
        return merged;
      });
    } catch (err) {
      if (fetchSeq.current !== seq) return;
      const appError = normalizeAppError(err);
      setError(appError.message || t('list.loadFailed'));
      setCards((prev) => {
        const localOnly = prev.filter((c) => localOnlyIdsRef.current.has(c.id));
        setMineCounts(countByListKind(localOnly));
        return localOnly;
      });
    } finally {
      if (fetchSeq.current === seq) {
        setIsLoading(false);
      }
    }
  }, [debouncedKeyword, t]);

  useEffect(() => {
    void fetchWorkflows();
  }, [fetchWorkflows]);

  const appendLocalCard = useCallback((card: WorkflowCardItem) => {
    localOnlyIdsRef.current.add(card.id);
    setCards((prev) => {
      const merged = [...prev, card];
      setMineCounts(countByListKind(merged));
      return merged;
    });
  }, []);

  const setCardsTracked = useCallback<React.Dispatch<React.SetStateAction<WorkflowCardItem[]>>>(
    (updater) => {
      setCards((prev) => {
        const next = typeof updater === 'function' ? updater(prev) : updater;
        const nextIds = new Set(next.map((c) => c.id));
        for (const id of localOnlyIdsRef.current) {
          if (!nextIds.has(id)) {
            localOnlyIdsRef.current.delete(id);
          }
        }
        setMineCounts(countByListKind(next));
        return next;
      });
    },
    [],
  );

  return {
    cards,
    setCards: setCardsTracked,
    appendLocalCard,
    isLoading: useMinLoading(isLoading),
    error,
    refetch: fetchWorkflows,
    setSearchKeyword,
    mineCounts,
  };
}
