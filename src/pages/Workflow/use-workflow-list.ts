/** 工作流列表数据 hook：调用 /api/workflow-templates/mine，管理搜索/筛选 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { hostApiFetch } from '@/lib/host-api';
import { normalizeAppError } from '@/lib/error-model';
import { mapTemplateMineItemToCardItem, mapTemplateMineItemToOfficialCard, parseTemplateMineItem } from '@/pages/Workflow/workflow-mapper';
import { useMinLoading } from '@/hooks/use-min-loading';
import type { OfficialWorkflowCard, WorkflowCardItem, WorkflowMineListKind } from '@/pages/Workflow/types';

interface TemplateMineApiResponse {
  success?: boolean;
  data?: Record<string, unknown>[];
  total?: number;
  page?: number;
  pageSize?: number;
  traceId?: string;
  error?: string;
}

/** 搜索关键词 debounce 时长（ms） */
const SEARCH_DEBOUNCE_MS = 300;

export interface UseWorkflowListResult {
  /** 当前展示的工作流卡片列表 */
  cards: WorkflowCardItem[];
  /** 外部可控的 setCards */
  setCards: React.Dispatch<React.SetStateAction<WorkflowCardItem[]>>;
  /** 数据加载状态（含最小加载时长，防止闪烁） */
  isLoading: boolean;
  /** 请求错误信息，无错误时为 null */
  error: string | null;
  /** 手动触发重新拉取工作流列表 */
  refetch: () => Promise<void>;
  /** 设置搜索关键词（内部 debounce 后触发 API 请求） */
  setSearchKeyword: (keyword: string) => void;
  /** 各 Tab（published / installed / draft）下的卡片数量，由 cards 派生 */
  mineCounts: Record<WorkflowMineListKind, number>;
  /** 系统官方推荐的工作流卡片列表 */
  officialCards: OfficialWorkflowCard[];
}

/** 按 listKind 统计各 Tab 下的卡片数量 */
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
  const [officialCards, setOfficialCards] = useState<OfficialWorkflowCard[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchKeyword, setSearchKeyword] = useState('');
  const [debouncedKeyword, setDebouncedKeyword] = useState('');

  /** 跟踪 API 刷新时序号，防止旧请求覆盖新结果 */
  const fetchSeq = useRef(0);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedKeyword(searchKeyword.trim());
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [searchKeyword]);

  /** 核心数据拉取逻辑，effect 与 refetch 共用 */
  const doFetch = useCallback(async () => {
    const seq = fetchSeq.current + 1;
    fetchSeq.current = seq;
    setIsLoading(true);
    setError(null);

    const query = debouncedKeyword
      ? `?keyword=${encodeURIComponent(debouncedKeyword)}`
      : '';

    try {
      // @api docs/api-contracts/workflows/template-mine.md
      const response = await hostApiFetch<TemplateMineApiResponse>(`/api/workflow-templates/mine${query}`);
      if (fetchSeq.current !== seq) return;
      if (response.success === false) throw new Error(response.error || t('list.loadFailed'));

      const rawItems = (response.data ?? []).map(parseTemplateMineItem);
      const mineItems = rawItems.filter((i) => i.scope === 'personal');
      const systemItems = rawItems.filter((i) => i.scope === 'system');

      setOfficialCards(systemItems.map(mapTemplateMineItemToOfficialCard));
      setCards(mineItems.map((item) => mapTemplateMineItemToCardItem(item, t)));
    } catch (err) {
      if (fetchSeq.current !== seq) return;
      const appError = normalizeAppError(err);
      setError(appError.message || t('list.loadFailed'));
      setOfficialCards([]);
      setCards([]);
    } finally {
      if (fetchSeq.current === seq) setIsLoading(false);
    }
  }, [debouncedKeyword, t]);

  useEffect(() => {
    let cancelled = false;
    // 将同步 setState 延迟到微任务，避免 effect 内同步触发级联渲染
    queueMicrotask(() => {
      if (!cancelled) { void doFetch(); }
    });
    return () => { cancelled = true; };
  }, [doFetch]);

  /** 由 cards 派生各 Tab 下的卡片数量，避免额外 setState */
  const mineCounts = useMemo(() => countByListKind(cards), [cards]);

  return {
    cards,
    setCards,
    isLoading: useMinLoading(isLoading),
    error,
    refetch: doFetch,
    setSearchKeyword,
    mineCounts,
    officialCards,
  };
}
