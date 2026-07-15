/**
 * 推荐位配置 API Client
 *
 * 对接 FastAPI: GET /fastapi/agent/v1/recommend/positions/{position_key}/items
 * 返回当前用户在指定推荐位下可见的条目（enrich + 失效过滤）。
 */
import { hostApiFetch } from '@/lib/host-api';

/** 推荐位条目类型 */
export type RecommendItemType = 'workflow_template' | 'workflow_instance' | 'skill';

/** 推荐位条目 */
export interface RecommendItem {
  item_type: RecommendItemType;
  item_ref_id: string;
  title: string;
  description: string | null;
  icon: string | null;
  sort_order: number;
  /** 工作流分类（workflow_template 类型时由后端回填） */
  category?: string | null;
  // 技能相关字段（item_type 为 skill 时使用）
  skill_slug?: string;
  skill_installed?: boolean;
  skill_update_available?: boolean;
  skill_version?: string;
  skill_default_prompt?: string;
}

/** 推荐位条目响应 */
export interface RecommendItemsResponse {
  success: boolean;
  data: {
    position_key: string;
    items: RecommendItem[];
  };
  errCode?: string;
  errMessage?: string;
}

/** 推荐位 position_key 枚举（与 memory-center-web recommendConfig.ts 对齐） */
export const RECOMMEND_POSITION_KEYS = {
  HOME_CARD: 'home_card',
  MY_TASK: 'my_task',
  OFFICIAL_WORKFLOW: 'official_workflow',
} as const;

export type RecommendPositionKey =
  (typeof RECOMMEND_POSITION_KEYS)[keyof typeof RECOMMEND_POSITION_KEYS];

/** 获取指定推荐位的可见条目 */
export async function fetchRecommendItems(
  positionKey: RecommendPositionKey,
): Promise<RecommendItem[]> {
  const res = await hostApiFetch<RecommendItemsResponse>(
    `/fastapi/agent/v1/recommend/positions/${positionKey}/items`,
    { method: 'GET' },
  );
  if (!res.success || !res.data) {
    return [];
  }
  const items = res.data.items ?? [];
  return items.map((item) => {
    if (item.item_type === 'skill' && !item.skill_version) {
      const raw = item as unknown as Record<string, unknown>;
      if (typeof raw.version === 'string') {
        return { ...item, skill_version: raw.version };
      }
    }
    return item;
  });
}
