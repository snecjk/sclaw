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
  /** 当前展示的工作流卡片列表 */
  cards: WorkflowCardItem[];
  /** 外部可控的 setCards */
  setCards: React.Dispatch<React.SetStateAction<WorkflowCardItem[]>>;
  /** 我的工作流加载状态 */
  mineLoading: boolean;
  /** 官方推荐加载状态 */
  officialLoading: boolean;
  /** 请求错误信息，无错误时为 null */
  error: string | null;
  /** 手动触发重新拉取我的工作流数据 */
  refetchMine: () => Promise<void>;
  /** 手动触发重新拉取官方推荐数据 */
  refetchOfficial: () => Promise<void>;
  /** 各 Tab（published / draft）下的卡片数量，由 cards 派生 */
  mineCounts: Record<WorkflowMineListKind, number>;
  /** 系统官方推荐的工作流卡片列表 */
  officialCards: OfficialWorkflowCard[];
}

/** 按 listKind 统计各 Tab 下的卡片数量 */
function countByListKind(cards: WorkflowCardItem[]): Record<WorkflowMineListKind, number> {
  return {
    published: cards.filter((c) => c.listKind === 'published').length,
    draft: cards.filter((c) => c.listKind === 'draft').length,
  };
}

export function useWorkflowList(): UseWorkflowListResult {
  const { t } = useTranslation('workflow');
  const [cards, setCards] = useState<WorkflowCardItem[]>([]);
  const [officialCards, setOfficialCards] = useState<OfficialWorkflowCard[]>([]);
  const [mineLoading, setMineLoading] = useState(true);
  const [officialLoading, setOfficialLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  /** 跟踪 API 刷新时序号，防止旧请求覆盖新结果 */
  const mineFetchSeq = useRef(0);
  const officialFetchSeq = useRef(0);

  /** 官方模板 ID 集合（保持最新，供 fetchMine 闭包内读取，避免闭包过期） */
  const officialTemplateIdsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    officialTemplateIdsRef.current = new Set(officialCards.map((c) => c.id));
  }, [officialCards]);

  /** 个人工作流数据拉取（全量，搜索由前端本地过滤） */
  // FastAPI: GET /agent/v1/my-workflow → memory-center workflow_client.py:list_my_workflows
  const fetchMine = useCallback(async () => {
    const seq = mineFetchSeq.current + 1;
    mineFetchSeq.current = seq;
    setMineLoading(true);
    setError(null);

    try {
      const mineResponse = await hostApiFetch<MineWorkflowResponse>(
        '/api/my-tasks/agent/v1/my-workflow'
      );
      if (mineFetchSeq.current !== seq) return;

      if (mineResponse.success === false) {
        setCards([]);
        return;
      }
      const rawItems = mineResponse.data ?? [];
      const mappedCards: WorkflowCardItem[] = rawItems.map((item) => {
        const templateId = item.templateId != null ? String(item.templateId) : null;
        const isCustom = templateId == null || !officialTemplateIdsRef.current.has(templateId);
        /** lifecycleStatus: draft → 草稿 Tab, active → 已发布 Tab, 缺失时默认 published */
        const listKind: WorkflowMineListKind =
          item.lifecycleStatus?.toUpperCase() === 'DRAFT' ? 'draft' : 'published';
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
      setCards(mappedCards);
    } catch {
      if (mineFetchSeq.current !== seq) return;
      setCards([]);
      setError(null);
    } finally {
      if (mineFetchSeq.current === seq) setMineLoading(false);
    }
  }, [t]);

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

      // 官方模板列表更新后，重新推导已有卡片的 isCustom
      const officialIds = new Set(officialItems.map((item) => item.id));
      setCards((prev) =>
        prev.map((card) => {
          const isCustom = card.templateId == null || !officialIds.has(card.templateId);
          return card.isCustom === isCustom ? card : { ...card, isCustom };
        })
      );
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
    } catch (err) {
      if (officialFetchSeq.current !== seq) return;
      setOfficialCards([]);
    } finally {
      if (officialFetchSeq.current === seq) setOfficialLoading(false);
    }
  }, []);

  /** 首次加载：同时拉取 mine 与 official（official 用于推导 isCustom） */
  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) {
        void fetchMine();
        void fetchOfficial();
      }
    });
    return () => {
      cancelled = true;
    };
  }, [fetchMine, fetchOfficial]);

  /** 由 cards 派生各 Tab 下的卡片数量，避免额外 setState */
  const mineCounts = useMemo(() => countByListKind(cards), [cards]);

  return {
    cards,
    setCards,
    mineLoading: useMinLoading(mineLoading),
    officialLoading: useMinLoading(officialLoading),
    error,
    refetchMine: fetchMine,
    refetchOfficial: fetchOfficial,
    mineCounts,
    officialCards,
  };
}
