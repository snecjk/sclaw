# 推荐位广告集成方案

> 2026-07-13 · 在 sto-claw 三处页面接入 memory-center 推荐位配置系统

---

## 一、需求概述

在 sto-claw 客户端三个位置接入后台推荐位配置，由运营在 memory-center-web 管理端配置推荐内容，客户端统一请求推荐 API，**由后端根据用户身份（工号/部门/角色/组织类别）动态返回不同内容，客户端无需区分网点/非网点用户**：

| # | 消费位置 | `position_key` | 当前数据来源 | 目标 |
|---|---------|---------------|-------------|------|
| 1 | 首页卡片 | `home_card` | 硬编码 `AGENT_HUB_CARDS`（3 张静态卡片） | 请求推荐 API，有数据则展示推荐卡片，无数据则降级展示静态卡片 |
| 2 | 我的任务 → 模版选择弹窗 | `my_task` | `listWorkflowTemplates()` 拉取系统模板 | 在弹窗中追加推荐条目 |
| 3 | 工作流 → 官方推荐 Tab | `official_workflow` | `listWorkflowTemplates()` 拉取系统模板 | 在官方推荐列表下方追加推荐条目 |

三个 `position_key` 与 `memory-center-web/src/pages/RecommendPositionConfig/recommendConfig.ts` 中的枚举一一对应。

### 核心设计原则

**客户端不关心用户身份**：网点/非网点/省区白名单等身份判断全部由后端推荐位域命中逻辑处理。后端的 `recommend_service.get_recommend_items()` 采用**网点域优先互斥**策略：
- 先判网点域：`is_site_category_code(perm.category_code)` 为 true 且网点域存在 → 只返回网点域配置条目，不再查自定义域
- 否则查自定义域：按人员（`target_id == user_code`）或部门（`target_id IN dept_codes`）反查命中域
- 两种域结果不合并，确保网点用户和非网点用户看到完全不同的推荐内容

因此客户端只需统一请求 `GET /agent/v1/recommend/positions/{position_key}/items`，后端会动态返回该用户可见的推荐条目。

---

## 二、后端现状（需调整域命中优先级逻辑）

推荐位配置系统在 memory-center FastAPI 中已完整实现：

```
src/models/recommend.py              → 4 张表 ORM
src/repositories/recommend_repository.py → 数据访问
src/services/recommend_service.py    → 业务编排（域命中 + enrich + 失效过滤）
src/api/v1/recommend.py              → 管理端 CRUD + 客户端读取
```

### 已有客户端读取接口

```
GET /api/v1/recommend/positions/{position_key}/items
```

- 鉴权：`UserPermission`（stoToken → 提取工号 / 部门链 / 角色 / 组织类别）
- 返回格式：

```json
{
  "success": true,
  "data": {
    "position_key": "home_card",
    "items": [
      {
        "item_type": "workflow_template",
        "item_ref_id": "tpl_001",
        "title": "周度对账工作流",
        "description": "自动汇总本周收支数据",
        "icon": null,
        "sort_order": 1
      }
    ]
  }
}
```

### 需调整：域命中优先级（互斥逻辑）

**当前逻辑**（`recommend_service.get_recommend_items()`）：
1. 查自定义域命中（`visible_domain_ids` — 按人员/部门反查，排除 site 域）
2. 追加网点域命中（`is_site_category_code` → `get_site_domain_id`）
3. **合并**所有命中域的 domain_ids，一起查配置条目

**调整为**（网点域优先，互斥）：
1. **先判网点域**：`is_site_category_code(perm.category_code)` 为 true 且网点域存在 → **只返回网点域的配置条目**
2. **否则查自定义域**：`visible_domain_ids(user_code, dept_codes)` → 返回命中自定义域的配置条目
3. 不再合并两种域的结果

**修改文件**：`memory-center/src/services/recommend_service.py` 的 `get_recommend_items()` 方法

```python
def get_recommend_items(self, position_key, perm):
    # ... 参数校验 ...

    # ① 先判网点域（优先，互斥）
    if is_site_category_code(perm.category_code if perm else None):
        site_id = recommend_repository.get_site_domain_id()
        if site_id is not None:
            domain_ids = [site_id]
        else:
            domain_ids = []
    else:
        # ② 非网点用户 → 查自定义域命中
        domain_ids = recommend_repository.visible_domain_ids(
            user_code=user_code, dept_codes=dept_codes,
        )

    if not domain_ids:
        return {"position_key": position_key, "items": []}

    # 后续逻辑不变：list_visible_configs_with_items → _enrich_items → 失效过滤
    # ...
```

### 问题：sto-claw 走 `/agent/v1` 前缀

sto-claw 客户端所有 API 调用走 `InterceptorMiddleware4Claw` 中间件（SSO stoToken 鉴权），路径前缀为 `/agent/v1`。现有推荐位读取接口挂在 `/api/v1/recommend` 下，走 `InterceptorMiddleware4Web` 中间件。

虽然两者都使用 stoToken 鉴权，但 sto-claw 的 `hostApiFetch` 统一通过本地网关代理，网关会根据路径前缀匹配对应中间件。因此需要新增一个 claw_api 路由，挂在 `/agent/v1` 下。

---

## 三、实施方案

### 阶段 1：后端 — 新增 claw_api 推荐位读取路由

#### 新建文件 `memory-center/src/api/claw_api/v1/recommend.py`

```python
"""Claw 客户端推荐位读取 API。"""

from __future__ import annotations

import logging
from typing import Any

from fastapi import APIRouter

from src.api.deps import UserPermission
from src.core.exceptions import fail, ok
from src.services.recommend_service import RecommendBizError, recommend_service

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/recommend", tags=["claw-recommend"])

_service = recommend_service


@router.get("/positions/{position_key}/items")
async def get_recommend_items(
    position_key: str,
    perm: UserPermission,
) -> dict[str, Any]:
    """获取当前用户在指定推荐位下可见的条目（enrich + 失效过滤）。

    与 /api/v1/recommend/positions/{position_key}/items 逻辑完全一致，
    仅路径前缀不同（/agent/v1 → Claw SSO 鉴权）。
    """
    try:
        return ok(_service.get_recommend_items(position_key, perm))
    except RecommendBizError as exc:
        return fail(exc.code, exc.message)
    except Exception as exc:
        logger.exception("Claw 查询推荐位条目异常")
        return fail(500, f"查询失败: {exc}")
```

#### 修改文件 `memory-center/src/api/router.py`

在 claw_api 导入区追加：

```python
from src.api.claw_api.v1 import (
    # ...existing imports...
    recommend as claw_recommend,  # 新增
)
```

在 `agent_v1_router` 注册区追加：

```python
agent_v1_router.include_router(claw_recommend.router)  # 推荐位读取（SSO stoToken 鉴权）
```

**最终接口路径**：`GET /agent/v1/recommend/positions/{position_key}/items`

---

### 阶段 2：前端 — 新增 recommend API 客户端

#### 新建文件 `sto-claw/src/lib/recommend-api.ts`

```typescript
/**
 * 推荐位配置 API Client
 *
 * 对接 FastAPI: GET /agent/v1/recommend/positions/{position_key}/items
 * 返回当前用户在指定推荐位下可见的条目（enrich + 失效过滤）。
 */
import { hostApiFetch } from '@/lib/host-api';
import { useAuthStore } from '@/stores/auth';

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

function getStoToken(): string | undefined {
  return useAuthStore.getState().user?.stoToken?.trim() || undefined;
}

function authHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  const token = getStoToken();
  if (token) headers.stoToken = token;
  return headers;
}

/** 获取指定推荐位的可见条目 */
export async function fetchRecommendItems(
  positionKey: RecommendPositionKey,
): Promise<RecommendItem[]> {
  const res = await hostApiFetch<RecommendItemsResponse>(
    `/agent/v1/recommend/positions/${positionKey}/items`,
    { method: 'GET', headers: authHeaders() },
  );
  if (!res.success || !res.data) {
    return [];
  }
  return res.data.items ?? [];
}
```

#### 新建文件 `sto-claw/src/hooks/use-recommend-items.ts`

```typescript
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
```

---

### 阶段 3：前端 — 三处页面集成

#### 3.1 首页卡片（`Home/index.tsx` + `HomeAgentHubSurface.tsx`）

**调整要点**：去掉 `isSite` / `crmWeekReportSurfaceAllowed` / `siteDepartmentTypes` 等所有身份判断分支，所有用户统一走 `HomeAgentHubSurface`，由后端 API 动态返回不同内容。

**当前 `Home/index.tsx` 的分支逻辑**：

```
isAuthenticated && siteDepartmentTypes === null  →  return null（等待）
isSite                                           →  HomeSiteSurface（网点首页）
!crmWeekReportSurfaceAllowed                     →  HomeAgentHubSurface（静态卡片）
else                                             →  HomeHero + HomeSummaryCards + HomeComposer
```

**调整后**：

```
（无身份判断，所有用户统一走 HomeAgentHubSurface）
```

**具体改动**：

1. **`Home/index.tsx`**：
   - 移除 `isSite` / `crmWeekReportSurfaceAllowed` / `siteDepartmentTypes` 的读取和判断
   - 移除 `HomeSiteSurface` 分支
   - 移除 CRM 周报分支（`HomeHero` + `HomeSummaryCards` + `HomeComposer` 那段）
   - 移除 `isSiteUser` / `isSite` 相关导入
   - 所有用户统一渲染 `HomeAgentHubSurface`
   - 移除 `HomeSiteSurface` / `HomeHero` / `HomeSummaryCards` 等不再使用的导入

2. **`HomeAgentHubSurface.tsx`**：
   - 引入 `useRecommendItems(RECOMMEND_POSITION_KEYS.HOME_CARD)`
   - 请求到推荐条目时，渲染推荐卡片（复用 `OfficialWorkflowCard` 类型或新建轻量卡片组件）
   - 无推荐数据时，降级展示现有 `AGENT_HUB_CARDS` 静态卡片
   - loading 时展示骨架屏或现有静态卡片（避免白屏）

**渲染逻辑**：

```tsx
// HomeAgentHubSurface.tsx 核心改动
const { items: recommendItems, loading: recommendLoading } = useRecommendItems(
  RECOMMEND_POSITION_KEYS.HOME_CARD,
);

// 在卡片网格区：
{recommendItems.length > 0 ? (
  // 渲染推荐卡片
  recommendItems.map((item) => (
    <HomeRecommendCard key={item.item_ref_id} item={item} onSend={handleHubSend} />
  ))
) : (
  // 降级：渲染静态 AGENT_HUB_CARDS
  AGENT_HUB_CARDS.map(({ icon: Icon, ... }) => ( ... ))
)}
```

**推荐卡片点击行为**（按 `item_type` 分发）：

| `item_type` | 点击行为 |
|---|---|
| `workflow_template` | 跳转首页并发送 `帮我执行 id 为：{item_ref_id} 的工作流 【{title}】`（复用 `navigateToNewSessionWithPrompt`） |
| `workflow_instance` | 同上，`item_ref_id` 为 `run_id` |
| `skill` | 跳转技能广场或直接发送安装指令 |

#### 3.2 我的任务 → 模版选择弹窗（`MyTask/index.tsx`）

**当前逻辑**：`useEffect` 中调用 `listWorkflowTemplates()` 拉取系统模板 → `setOfficialCards` → 传入 `TemplateSelectModal`。

**调整要点**：用推荐位 API **替换**原有 `listWorkflowTemplates()` 调用，模版弹窗仅展示推荐条目。

**改动**：

```tsx
// MyTask/index.tsx
// 删除：listWorkflowTemplates 导入和调用
// 删除：officialCards state 和对应的 useEffect 拉取逻辑

// 新增：useRecommendItems
const { items: recommendItems, loading: recommendLoading } = useRecommendItems(RECOMMEND_POSITION_KEYS.MY_TASK);

// 将推荐条目映射为 OfficialWorkflowCard 格式
const officialCards = useMemo(() => {
  return recommendItems.map((item) => ({
    id: item.item_ref_id,
    name: item.title,
    category: item.item_type,
    description: item.description ?? '',
    flow: [],
    coverKey: 'cover-1',
  }));
}, [recommendItems]);

// 传入 TemplateSelectModal（loading 时传空数组）
<TemplateSelectModal
  open={templateOpen}
  onClose={() => setTemplateOpen(false)}
  officialCards={officialCards}
  onSelect={handleTemplateSelect}
/>
```

**降级**：推荐 API 返回空列表时，模版弹窗展示空状态（不再回退到 `listWorkflowTemplates()`）。

#### 3.3 工作流 → 官方推荐 Tab（`workflow-dashboard.tsx` + `use-workflow-list.ts`）

**当前逻辑**：`useWorkflowList()` 中 `fetchOfficial()` 调用 `listWorkflowTemplates()` 拉取官方推荐列表 → 返回 `officialCards` → 在官方推荐 Tab 中渲染 `WorkflowOfficialListCard` 列表。

**调整要点**：用推荐位 API **替换**原有 `fetchOfficial()` 逻辑，官方推荐 Tab 仅展示推荐条目。

**改动**：

1. **`use-workflow-list.ts`**：
   - 删除 `fetchOfficial` 函数（调用 `listWorkflowTemplates()` 的逻辑）
   - 删除 `officialCards` state 和 `officialLoading` state
   - 删除 `listWorkflowTemplates` 导入
   - 删除 `refetchOfficial` 返回值
   - `officialCards` / `officialLoading` / `refetchOfficial` 从 `UseWorkflowListResult` 接口和返回值中移除

2. **`workflow-dashboard.tsx`**：
   - 从 `useWorkflowList` 解构中移除 `officialCards` / `officialLoading`
   - 新增 `useRecommendItems(RECOMMEND_POSITION_KEYS.OFFICIAL_WORKFLOW)`
   - 官方推荐 Tab 直接使用推荐条目渲染：

```tsx
// workflow-dashboard.tsx
const { items: recommendItems, loading: recommendLoading } = useRecommendItems(
  RECOMMEND_POSITION_KEYS.OFFICIAL_WORKFLOW,
);

// 官方推荐 Tab 渲染（替换原 officialCards 逻辑）：
{recommendLoading ? (
  <LoadingSpinner size="lg" />
) : recommendItems.length > 0 ? (
  <WorkflowListCardGrid>
    {recommendItems.map((item) => (
      <WorkflowOfficialListCard
        key={item.item_ref_id}
        card={{
          id: item.item_ref_id,
          name: item.title,
          category: item.item_type,
          description: item.description ?? '',
          flow: [],
          coverKey: 'cover-1',
        }}
        onInstall={() => { /* 同官方推荐安装逻辑 */ }}
      />
    ))}
  </WorkflowListCardGrid>
) : (
  <EmptyState />
)}
```

**降级**：推荐 API 返回空列表时，官方推荐 Tab 展示空状态。

---

## 四、文件变更清单

### 后端（memory-center）

| 操作 | 文件 | 说明 |
|---|---|---|
| 新建 | `src/api/claw_api/v1/recommend.py` | claw_api 推荐位读取路由 |
| 修改 | `src/api/router.py` | 注册新路由到 `agent_v1_router` |
| 修改 | `src/services/recommend_service.py` | `get_recommend_items()` 域命中逻辑改为网点域优先互斥：先判网点域，命中则只返回网点域配置；否则查自定义域命中 |

### 前端（sto-claw）

| 操作 | 文件 | 说明 |
|---|---|---|
| 新建 | `src/lib/recommend-api.ts` | 推荐位 API 客户端 |
| 新建 | `src/hooks/use-recommend-items.ts` | 推荐位数据 Hook |
| 修改 | `src/pages/Home/index.tsx` | 移除所有身份判断分支（`isSite` / `crmWeekReportSurfaceAllowed` / `siteDepartmentTypes`），所有用户统一走 `HomeAgentHubSurface` |
| 修改 | `src/pages/Home/HomeAgentHubSurface.tsx` | 请求 `home_card` 推荐位，有数据展示推荐卡片，无数据降级静态卡片 |
| 修改 | `src/pages/MyTask/index.tsx` | 用 `useRecommendItems('my_task')` **替换** `listWorkflowTemplates()` 调用，模版弹窗仅展示推荐条目 |
| 修改 | `src/pages/Workflow/use-workflow-list.ts` | 删除 `fetchOfficial()` / `officialCards` / `officialLoading` / `refetchOfficial`，移除 `listWorkflowTemplates` 导入 |
| 修改 | `src/pages/Workflow/components/workflow-dashboard.tsx` | 用 `useRecommendItems('official_workflow')` **替换** `officialCards`，官方推荐 Tab 仅展示推荐条目 |
| 删除 | `src/pages/Home/use-home-official-workflows.ts` | 仅被 `HomeOfficialWorkflowCards` 引用，后者已是死代码 |
| 删除 | `src/pages/Home/HomeOfficialWorkflowCards.tsx` | 仅被 `HomeSiteSurface` 注释引用，随 `HomeSiteSurface` 废弃而删除 |

> **注意**：`listWorkflowTemplates()` 函数本身**不删除**，它仍被 Chat Picker（`stores/workflows.ts`）、Chat 搜索（`stores/chat.ts`）、工作流设计器（`workflow-designer-persist.ts`）等场景使用。仅移除"官方推荐展示"场景的调用。

---

## 五、数据流

```
┌─────────────────────────────────────────────────────────────────┐
│  memory-center-web 管理端                                       │
│  运营在 RecommendPositionConfig 页面配置推荐位条目               │
│  → POST /api/v1/recommend/positions（SuperAdminOnly 鉴权）       │
│  → 为不同域（自定义域 / 网点域）配置不同条目                      │
└──────────────────────────┬──────────────────────────────────────┘
                           │ 写入 DB
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│  MySQL                                                          │
│  recommend_position_config + recommend_position_item            │
│  (position_key × domain_id × enabled × items)                  │
│  同一 position_key 可关联多个域，每个域配置不同条目               │
└──────────────────────────┬──────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│  memory-center FastAPI                                         │
│  GET /agent/v1/recommend/positions/{position_key}/items        │
│  → InterceptorMiddleware4Claw（SSO stoToken 鉴权）              │
│  → UserPermission（提取工号/部门/角色/组织类别）                  │
│  → recommend_service.get_recommend_items()                     │
│    → ① 先判网点域：is_site_category_code(perm.category_code)      │
│         命中 → 只取网点域 id，不再查自定义域（互斥）              │
│    → ② 非网点用户 → visible_domain_ids（人员/部门反查命中自定义域）│
│    → list_visible_configs_with_items（查命中域的启用配置+条目）    │
│    → _enrich_items（补全 title/description/icon）                │
│    → 失效过滤（引用对象已删则丢弃）                               │
│  → 返回 { position_key, items: [...] }                         │
│  （网点用户和非网点用户看到完全不同的条目，互斥不合并）            │
└──────────────────────────┬──────────────────────────────────────┘
                           │ HTTP JSON
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│  sto-claw Electron                                             │
│  hostApiFetch → 本地网关(127.0.0.1:3210) → FastAPI             │
│  （客户端不区分用户身份，统一请求 API）                           │
│                                                                │
│  useRecommendItems(positionKey)                                │
│    → fetchRecommendItems(positionKey)                          │
│    → 返回 RecommendItem[]                                       │
│                                                                │
│  三处消费：                                                     │
│  ① Home/index.tsx → HomeAgentHubSurface                        │
│     positionKey = 'home_card'                                  │
│     有数据 → 推荐卡片 / 无数据 → 静态 AGENT_HUB_CARDS            │
│     （所有用户统一走此分支，不再区分网点/非网点）                 │
│                                                                │
│  ② MyTask/index.tsx → TemplateSelectModal                      │
│     positionKey = 'my_task'                                    │
│     替换原 listWorkflowTemplates() 调用                         │
│     模版弹窗仅展示推荐条目                                      │
│                                                                │
│  ③ workflow-dashboard.tsx → 官方推荐 Tab                       │
│     positionKey = 'official_workflow'                           │
│     替换原 officialCards（fetchOfficial → listWorkflowTemplates）│
│     官方推荐 Tab 仅展示推荐条目                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## 六、注意事项

1. **降级策略**：推荐 API 请求失败或返回空列表时，首页降级为静态 `AGENT_HUB_CARDS` 卡片；MyTask 模版弹窗和 Workflow 官方推荐 Tab 均展示「暂无数据」空状态，不回退到原有 `listWorkflowTemplates()` 调用。

2. **缓存与刷新**：`useRecommendItems` 在组件挂载时请求一次，不自动轮询。用户手动刷新页面时重新请求。

3. **position_key 一致性**：前端 `RECOMMEND_POSITION_KEYS` 常量必须与 `memory-center-web/src/pages/RecommendPositionConfig/recommendConfig.ts` 中的 `POSITION_KEY_OPTIONS` 保持一致。

4. **item_type 映射**：后端返回的 `item_type` 有三种值（`workflow_template` / `workflow_instance` / `skill`），前端需按类型分发点击行为。当前三处页面主要消费 `workflow_template` 类型，`skill` 类型的点击行为待后续补充。

5. **Home/index.tsx 清理**：移除所有身份判断分支后，`HomeSiteSurface` / `HomeHero` / `HomeSummaryCards` / `HomeWorkflowGuideCards` 等组件可能不再被引用。需全局搜索确认无其他引用后再删除，避免打包冗余。同时删除 `use-home-official-workflows.ts` 和 `HomeOfficialWorkflowCards.tsx`（仅被 `HomeSiteSurface` 注释引用，已是死代码）。

6. **`listWorkflowTemplates()` 不废弃**：该函数仍被 Chat Picker（`stores/workflows.ts` → `fetchTemplateCatalog()`）、Chat 搜索（`stores/chat.ts` → `searchWorkflowTemplates()`）、工作流设计器（`workflow-designer-persist.ts`）、工作流启动（`use-workflow-send.ts` → `useWorkflowsStore`）等场景使用。仅移除"官方推荐展示"场景的调用（`use-workflow-list.ts` 的 `fetchOfficial` 和 `MyTask/index.tsx` 的 `useEffect` 拉取）。后端 `POST /agent/v1/workflow-templates` 端点保持不变，不打废弃注释。

7. **鉴权一致性**：新增的 `/agent/v1/recommend/positions/{position_key}/items` 与现有 `/api/v1/recommend/positions/{position_key}/items` 逻辑完全一致，仅路径前缀和中间件不同。两者都使用 `UserPermission` 依赖提取用户权限上下文。

8. **身份判断由后端处理（网点域优先互斥）**：客户端不再做 `isSite` / `crmWeekReportSurfaceAllowed` / `siteDepartmentTypes` 等判断。后端 `recommend_service.get_recommend_items()` 采用**互斥优先**逻辑：先判网点域（`is_site_category_code`），命中则只返回网点域配置条目，不再查自定义域；未命中才查自定义域（按人员/部门反查）。两种域的结果不合并，确保网点用户和非网点用户看到完全不同的推荐内容。
