/** 工作流列表数据 hook */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { hostApiFetch } from '@/lib/host-api';
import { listWorkflowTemplates } from '@/lib/workflow-api';
import { pickCoverKeyFromWorkflowId } from '@/pages/Workflow/workflow-mapper';
import { useMinLoading } from '@/hooks/use-min-loading';
import type {
  OfficialWorkflowCard,
  WorkflowCardItem,
  WorkflowMineListKind,
} from '@/pages/Workflow/types';
import type { WorkflowMineFilter } from '@/pages/Workflow/hooks/use-workflow-list-view-state';

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

export interface UseWorkflowListResult {
  /** 当前展示的工作流卡片列表（仅当前 mineFilter Tab） */
  cards: WorkflowCardItem[];
  /** 各 Tab 缓存卡片（未访问过的 Tab 为空数组），供角标搜索计数等派生使用 */
  cardsByKind: Record<WorkflowMineListKind, WorkflowCardItem[]>;
  /** 外部可控的 setCards（作用于当前 Tab 缓存） */
  setCards: React.Dispatch<React.SetStateAction<WorkflowCardItem[]>>;
  /** 我的工作流加载状态 */
  mineLoading: boolean;
  /** 官方推荐加载状态 */
  officialLoading: boolean;
  /** 请求错误信息，无错误时为 null */
  error: string | null;
  /** 手动触发重新拉取当前 Tab 的工作流数据 */
  refetchMine: () => Promise<void>;
  /** 手动触发重新拉取官方推荐数据 */
  refetchOfficial: () => Promise<void>;
  /** 各 Tab（published / draft）下的卡片数量，由 cardsByKind 派生 */
  mineCounts: Record<WorkflowMineListKind, number>;
  /** 系统官方推荐的工作流卡片列表 */
  officialCards: OfficialWorkflowCard[];
}

/** 「我的工作流」Tab 对应的后端 lifecycle_status：已发布 Tab → ACTIVE，草稿 Tab → DRAFT */
const LIFECYCLE_STATUS_BY_KIND: Record<WorkflowMineListKind, string> = {
  published: 'ACTIVE',
  draft: 'DRAFT',
};

const EMPTY_CARDS_BY_KIND: Record<WorkflowMineListKind, WorkflowCardItem[]> = {
  published: [],
  draft: [],
};

/** 按 listKind 统计各 Tab 下的卡片数量 */
function countByListKind(
  cardsByKind: Record<WorkflowMineListKind, WorkflowCardItem[]>
): Record<WorkflowMineListKind, number> {
  return {
    published: cardsByKind.published.length,
    draft: cardsByKind.draft.length,
  };
}

export function useWorkflowList(mineFilter: WorkflowMineFilter): UseWorkflowListResult {
  const { t } = useTranslation('workflow');
  const [cardsByKind, setCardsByKind] = useState<
    Record<WorkflowMineListKind, WorkflowCardItem[]>
  >(EMPTY_CARDS_BY_KIND);
  const [officialCards, setOfficialCards] = useState<OfficialWorkflowCard[]>([]);
  const [mineLoading, setMineLoading] = useState(true);
  const [officialLoading, setOfficialLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  /** 跟踪 API 刷新时序号，防止旧请求覆盖新结果 */
  /** 各 Tab 独立的请求序号，防止同一 Tab 切换时的 stale write */
  const mineFetchSeqByKind = useRef<Record<WorkflowMineListKind, number>>({
    published: 0,
    draft: 0,
  });
  /** 并发在途请求计数，驱动共享的 mineLoading */
  const mineInFlight = useRef(0);
  const officialFetchSeq = useRef(0);

  /** 官方模板 ID 集合（保持最新，供 fetchMine 闭包内读取，避免闭包过期） */
  const officialTemplateIdsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    officialTemplateIdsRef.current = new Set(officialCards.map((c) => c.id));
  }, [officialCards]);

  /** 当前 mineFilter 的最新引用，供 refetchMine 等无参闭包读取 */
  const mineFilterRef = useRef(mineFilter);
  useEffect(() => {
    mineFilterRef.current = mineFilter;
  }, [mineFilter]);

  /**
   * 拉取指定 Tab 的工作流数据（按 lifecycle_status 过滤，最新 100 条）。
   * 切换 Tab 时按当前 Tab 触发，各 Tab 独立缓存互不覆盖。
   */
  // FastAPI: GET /agent/v1/my-workflow → memory-center workflow_client.py:list_my_workflows
  const fetchMine = useCallback(
    async (filter: WorkflowMineListKind) => {
      const seq = mineFetchSeqByKind.current[filter] + 1;
      mineFetchSeqByKind.current[filter] = seq;
      if (mineInFlight.current === 0) setMineLoading(true);
      mineInFlight.current += 1;
      setError(null);

      try {
        // Electron 透传 query 至 FastAPI，需用 snake_case 与后端 Query 参数对齐
        const params = new URLSearchParams({
          page: '1',
          page_size: '100',
          lifecycle_status: LIFECYCLE_STATUS_BY_KIND[filter],
        });
        const mineResponse = await hostApiFetch<MineWorkflowResponse>(
          `/api/my-tasks/agent/v1/my-workflow?${params.toString()}`
        );
        if (mineFetchSeqByKind.current[filter] !== seq) return;

        if (mineResponse.success === false) {
          setCardsByKind((prev) => ({ ...prev, [filter]: [] }));
          return;
        }
        const rawItems = mineResponse.data ?? [];
        const mappedCards: WorkflowCardItem[] = rawItems.map((item) => {
          const templateId = item.templateId != null ? String(item.templateId) : null;
          const isCustom = templateId == null || !officialTemplateIdsRef.current.has(templateId);
          /** 后端已按 lifecycle_status 过滤，listKind 即当前 Tab */
          const listKind: WorkflowMineListKind = filter;
          return {
            id: item.id,
            name: item.name,
            listKind,
            schedule: listKind === 'draft' ? t('card.noScheduleDraft') : '',
            enabled: listKind === 'published',
            description: item.description ?? '',
            coverKey: pickCoverKeyFromWorkflowId(item.id),
            flow: [],
            isCustom,
            templateId,
            neverRun: true,
            scheduleMuted: listKind === 'draft',
            showPausedLabel: false,
          };
        });
        setCardsByKind((prev) => ({ ...prev, [filter]: mappedCards }));
      } catch {
        if (mineFetchSeqByKind.current[filter] !== seq) return;
        setCardsByKind((prev) => ({ ...prev, [filter]: [] }));
        setError(null);
      } finally {
        mineInFlight.current = Math.max(0, mineInFlight.current - 1);
        if (mineInFlight.current === 0) setMineLoading(false);
      }
    },
    [t]
  );

  /** 官方推荐数据拉取 */
  // FastAPI: POST /agent/v1/workflow-templates → memory-center workflow_client.py:list_templates
  const fetchOfficial = useCallback(async () => {
    const seq = officialFetchSeq.current + 1;
    officialFetchSeq.current = seq;
    setOfficialLoading(true);
    setError(null);

    try {
      const officialResult = await listWorkflowTemplates({ page: 1, pageSize: 100 });
      if (officialFetchSeq.current !== seq) return;

      const officialItems = (officialResult.items ?? []).map((item) => ({
        id: String(item.id ?? ''),
        label: String(item.label ?? ''),
        description: item.description != null ? String(item.description) : null,
        category: item.category != null ? String(item.category) : null,
        nodeCount: Number(item.nodeCount) || 0,
      }));
      setOfficialCards(
        officialItems.map((item) => ({
          id: item.id,
          name: item.label,
          category: item.category ?? '',
          schedule: '',
          description: item.description ?? '',
          flow: [],
          coverKey: pickCoverKeyFromWorkflowId(item.id),
        }))
      );

      // 官方模板列表更新后，重新推导各 Tab 缓存卡片的 isCustom
      const officialIds = new Set(officialItems.map((item) => item.id));
      setCardsByKind((prev) => ({
        published: prev.published.map((card) => {
          const isCustom = card.templateId == null || !officialIds.has(card.templateId);
          return card.isCustom === isCustom ? card : { ...card, isCustom };
        }),
        draft: prev.draft.map((card) => {
          const isCustom = card.templateId == null || !officialIds.has(card.templateId);
          return card.isCustom === isCustom ? card : { ...card, isCustom };
        }),
      }));
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
    } catch (err) {
      if (officialFetchSeq.current !== seq) return;
      setOfficialCards([]);
    } finally {
      if (officialFetchSeq.current === seq) setOfficialLoading(false);
    }
  }, []);

  /**
   * 首次加载：并发拉取 published / draft 两个 Tab（保证两个角标计数均立即准确）；
   * 切换 mineFilter 时：仅刷新当前 Tab（拉取最新数据）。
   * official 仅首次加载（用于推导 isCustom）。
   */
  const didInitialMountRef = useRef(false);
  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      if (!didInitialMountRef.current) {
        didInitialMountRef.current = true;
        void fetchMine('published');
        void fetchMine('draft');
      } else {
        void fetchMine(mineFilter);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [fetchMine, mineFilter]);

  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) void fetchOfficial();
    });
    return () => {
      cancelled = true;
    };
  }, [fetchOfficial]);

  /** 由 cardsByKind 派生各 Tab 下的卡片数量，避免额外 setState */
  const mineCounts = useMemo(() => countByListKind(cardsByKind), [cardsByKind]);

  /** 当前 Tab 的卡片 */
  const cards = cardsByKind[mineFilter];

  /** setCards 作用于当前 Tab 的缓存槽 */
  const setCards = useCallback<React.Dispatch<React.SetStateAction<WorkflowCardItem[]>>>(
    (updater) => {
      const kind = mineFilterRef.current;
      setCardsByKind((prev) => ({
        ...prev,
        [kind]:
          typeof updater === 'function'
            ? (updater as (prev: WorkflowCardItem[]) => WorkflowCardItem[])(prev[kind])
            : updater,
      }));
    },
    []
  );

  /** 重拉当前 Tab（用于重命名 / 删除后刷新） */
  const refetchMine = useCallback(() => fetchMine(mineFilterRef.current), [fetchMine]);

  return {
    cards,
    cardsByKind,
    setCards,
    mineLoading: useMinLoading(mineLoading),
    officialLoading: useMinLoading(officialLoading),
    error,
    refetchMine,
    refetchOfficial: fetchOfficial,
    mineCounts,
    officialCards,
  };
}
