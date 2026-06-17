# 网点首页官方推荐工作流模版集成计划

## 需求概述

在 `HomeSiteSurface.tsx` 中集成官方推荐工作流模版，要求：

1. **数据源**：官方推荐模版 API 与 `src/pages/Workflow/` 页面的官方推荐列表一致
   - 调用 `listWorkflowTemplates({ page: 1, pageSize: 100 })`（同 `useWorkflowList` 的 `fetchOfficial`）

2. **匹配规则**：
   - 从官方推荐模版列表中取出每个模版的 `templateId`（即模版自身的 `id`）
   - 到"我的工作流"列表中检查该 `templateId` 是否存在
   - 如果**存在** → 命中 → 显示**工作流卡片**（样式参考 `stoclaw-design/index.html:38-98`）
   - 如果**不存在** → 保持原样 → 显示**工作流模版卡片**（与现有 `HomeWorkflowGuideCards` 风格一致）

3. **我的工作流 API**：`GET /api/my-tasks/agent/v1/my-workflow`（同 Workflow 页面的 `fetchMine`）

---

## 现有代码分析

### API 层

| API | 调用方式 | 所在文件 |
|-----|----------|----------|
| 官方推荐模版 | `listWorkflowTemplates({ page: 1, pageSize: 100 })` | `src/lib/workflow-api.ts:72` |
| 我的工作流 | `hostApiFetch('/api/my-tasks/agent/v1/my-workflow')` | `src/pages/Workflow/use-workflow-list.ts:89` |

返回数据：

**官方推荐模版**（`listWorkflowTemplates`）：
```typescript
{
  items: Array<{ 
    id: string;       // ← 这就是 templateId
    label: string; 
    description?: string; 
    category?: string; 
    // ...
  }>,
  total: number,
  page: number,
  pageSize: number
}
```

**我的工作流**：
```typescript
{
  success: boolean,
  data: Array<{ 
    id: string; 
    name: string; 
    description?: string; 
    templateId?: string;  // ← 与官方模版 id 匹配
  }>
}
```

### UI 层

| 组件 | 位置 | 说明 |
|------|------|------|
| 现有首页引导卡片 | `src/pages/Home/HomeWorkflowGuideCards.tsx` | `GuideCard` 组件，包含标题、CategoryPill、StatBlock、AvatarStack、FooterHint 等 |
| 设计稿 summary-card | `stoclaw-design/index.html:38-98` | 工作流卡片参考样式：header（标题+pill+status）+ stats + footer（avatars+team+hint） |

---

## 技术方案

### Step 1: 新建 Hook `useHomeOfficialWorkflows`

**文件**: `src/pages/Home/use-home-official-workflows.ts`（新建）

拉取逻辑：
1. 并行请求 `listWorkflowTemplates` + `GET /api/my-tasks/agent/v1/my-workflow`
2. 从"我的工作流"列表中提取所有存在的 `templateId` 集合
3. 遍历官方推荐模版列表，判断每个模版的 `id` 是否在集合中

输出数据结构：

```typescript
interface HomeOfficialTemplateItem {
  // 模版信息（始终存在）
  id: string;              // 模版 ID（templateId）
  label: string;           // 模版名称
  category: string;
  description: string;
  nodeCount: number;

  // 匹配结果
  hasMyWorkflow: boolean;  // 我的工作流列表中是否存在该 templateId
}
```

### Step 2: 新建组件 `HomeWorkflowCard`（命中时显示）

**文件**: `src/pages/Home/HomeWorkflowCard.tsx`（新建）

参考 `stoclaw-design/index.html:38-98` 的 `summary-card` 结构：

```html
<div class="summary-card">
  <!-- header: 标题行 + 分类 pill + 状态 -->
  <div class="summary-card__header">
    <div class="summary-card__title-row">
      <h3 class="summary-card__title">总部结算对账</h3>
      <span class="summary-card__pill">结算对账</span>
    </div>
    <span class="summary-card__status summary-card__status--ok">已完成</span>
  </div>

  <!-- stats 区域（2-3 个统计块） -->
  <div class="summary-card__stats">
    <div class="summary-card__stat">
      <span class="summary-card__stat-label">总收支</span>
      <span class="summary-card__stat-value">128,560 <span class="summary-card__stat-unit">元</span></span>
    </div>
  </div>

  <!-- footer: 头像 + 团队名 + 提示 -->
  <div class="summary-card__footer">
    <div class="summary-card__footer-avatars">...</div>
    <span class="summary-card__footer-team">王牌结算小组</span>
    <span class="summary-card__footer-more">存在异常 4 项 <chevron></span>
  </div>
</div>
```

复用 `HomeWorkflowGuideCards.tsx` 中已有的子组件：
- `CategoryPill` — 分类标签
- `StatusChip` — 状态标识  
- `StatBlock` — 统计块（首期用占位数据）
- `AvatarStack` — 头像堆叠（已有 `pickThreeAvatars` 逻辑）

点击行为：调用 `onSend` 触发对应工作流/模版的启动 prompt

### Step 3: 新建组件 `HomeOfficialWorkflowCards`

**文件**: `src/pages/Home/HomeOfficialWorkflowCards.tsx`（新建）

容器组件：
- 调用 `useHomeOfficialWorkflows()` 获取数据 + 加载状态
- 使用与现有卡片相同的 grid 布局：`grid grid-cols-1 gap-5 md:grid-cols-3`
- 遍历结果数组：
  - `item.hasMyWorkflow === true` → 渲染 `<HomeWorkflowCard ... />`
  - `item.hasMyWorkflow === false` → 渲染 `<GuideCard mode="configure" ... />`（保持原样）

### Step 4: 替换 `HomeSiteSurface` 中的卡片组件

**文件**: `src/pages/Home/HomeSiteSurface.tsx`

将：
```tsx
<HomeWorkflowGuideCards onSend={handleHubSend} />
```

替换为：
```tsx
<HomeOfficialWorkflowCards onSend={handleHubSend} />
```

---

## 数据匹配示例

**官方推荐模版列表**：
| id | label | category |
|----|-------|----------|
| tpl_001 | 总部结算对账 | 结算对账 |
| tpl_002 | 异常客户跟踪 | 任务监控 |
| tpl_003 | 出港成本报表 | 出港成本 |

**我的工作流列表**：
| id | name | templateId |
|----|------|------------|
| wf_101 | 5 月结算对账 | tpl_001 |
| wf_201 | 客户跟踪 V2 | tpl_002 |

**匹配判断**：
| 模版 id | 是否在我的工作流中 | 显示卡片类型 |
|---------|-------------------|------------|
| tpl_001 | ✅ 存在 | 工作流卡片（summary-card 风格） |
| tpl_002 | ✅ 存在 | 工作流卡片（summary-card 风格） |
| tpl_003 | ❌ 不存在 | 模版卡片（保持原样 GuideCard） |

---

## 文件变更清单

| 操作 | 文件路径 | 说明 |
|------|----------|------|
| 新建 | `src/pages/Home/use-home-official-workflows.ts` | 数据获取 + 匹配判断 Hook |
| 新建 | `src/pages/Home/HomeWorkflowCard.tsx` | 工作流卡片组件（summary-card 风格） |
| 新建 | `src/pages/Home/HomeOfficialWorkflowCards.tsx` | 官方推荐容器组件 |
| 修改 | `src/pages/Home/HomeSiteSurface.tsx` | 替换为 `HomeOfficialWorkflowCards` |

---

## 风险与注意事项

1. **首期 stat 数据**：design 稿中的 stats 数据（如"总收支 128,560 元"）需要业务 API 支持，首期先用占位数据/描述文案

2. **加载/错误处理**：如果 API 请求失败，回退到显示原有静态引导卡片 `HomeWorkflowGuideCards`

3. **国际化**：新增组件需添加 i18n 翻译键

---

## 实施顺序

1. 实现 `use-home-official-workflows.ts` Hook
2. 实现 `HomeWorkflowCard.tsx` 组件
3. 实现 `HomeOfficialWorkflowCards.tsx` 容器
4. 修改 `HomeSiteSurface.tsx` 完成集成
5. 补充 i18n 翻译
6. 自测 + `pnpm run lint` + `pnpm run typecheck`
