## Context

技能广场替代现有 Skills 页面，从面向开发者的管理工具升级为用户友好的市场门店。设计原型 (`skill-plaza.html`) 定义了完整的交互范式：双 Tab、分类导航、搜索排序、视图切换、卡片网格、详情弹窗。现有后端能力（`StoSkillService` + `ClawHubService`）仅提供搜索 / 安装 / 卸载 / 列表原语，缺少分类、广场聚合列表、使用统计等广场所需的数据维度。技能安装数据 100% 存储于本地 `~/.stoclaw/openclaw/` 目录体系下。

## Goals / Non-Goals

**Goals:**
- 完整实现设计稿中所有交互功能（双 Tab、分类、搜索、排序、视图切换、卡片、详情、删除确认）
- 后端完全管理分类体系，前端仅消费
- 新建 host-api 路由作为广场数据统一入口
- 兼容已安装技能：读取本地 `skills/` + `lock.json` 正确映射安装状态
- 对齐 `docs/sto-design.md` 色彩体系（Brand-6 强调、Success 已安装、Info 官方）

**Non-Goals:**
- 保留现有 Skills 页面的 Sheet 详情面板、API Key 编辑、环境变量管理（降级为后续高级设置入口）
- ClawHub 市场的独立浏览与安装（保留底层能力但不在广场 UI 暴露）
- 技能在线创建 / 编辑
- 跨设备同步 / 云端技能状态

## Decisions

### 1. 页面组件拆分策略：多文件组件 + 现有路由替换
- **Decision**: 在 `src/pages/Skills/` 下重写为多文件组件（`SkillPlazaPage.tsx` + `components/` 子目录），复用 `/skills` 路由，侧栏导航不变。
- **Rationale**: 保持路由和侧栏入口稳定，用户无感知迁移；多文件拆分避免单文件 1470 行的维护负担。
- **Alternative considered**: 新建 `src/pages/SkillPlaza/` 并使用新路由 `/skill-plaza`。拒绝，因为侧栏已有 Skills 入口，双路由会造成导航混乱。

### 2. 数据层架构：新建 `SkillPlazaService` + 扩展 host-api 路由
- **Decision**: 新建 `electron/services/skill-plaza-service.ts` 作为聚合层，整合 `StoSkillService`（远端市场）、本地 skills 目录扫描、`lock.json` 读取、`openclaw.json` 配置读取，提供广场统一的 `getPlazaSkills()`、`getCategories()`、`getMySkills()` 等高层 API。新增 `electron/api/routes/skill-plaza.ts` 路由。
- **Rationale**: 现有 `StoSkillService.search()` 返回扁平搜索结果，没有分类、安装状态、使用统计等广场所需字段。聚合层在服务端完成数据组装，前端仅做展示。
- **Alternative considered**: 在前端 store 层做四方合并（沿用现有 `fetchSkills` 模式）。拒绝，因为分类管理是后端职责，且前端已有的四方合并逻辑复杂且脆弱（依赖 Gateway RPC + 三种 host-api 调用）。

### 3. 分类管理方案：配置文件 + 服务端映射
- **Decision**: 后端维护一份 `skill-categories.json` 配置文件（位于 Electron 资源目录或用户配置目录），定义分类列表与每个技能 slug → category 的映射。`SkillPlazaService` 在返回广场列表时根据映射填充 `category` 字段。未分类技能归入"全部"。
- **Rationale**: 分类是业务运营驱动的，不适合硬编码在前端组件中；配置文件格式简单可维护，且可在后续迭代中升级为远程 API。
- **Alternative considered**: 由 STO AI Memory Center 后端提供分类 API。拒绝，当前 STO 后端无此能力，且分类变更频率低，本地配置足够。

### 4. 状态管理：新建 `useSkillPlazaStore` 而非扩展现有 `useSkillsStore`
- **Decision**: 新建 `src/stores/skill-plaza.ts`（Zustand），管理广场专属状态（activeTab、activeCategory、searchQuery、sortMode、viewMode、plazaSkills、mySkills、categories）。保留现有 `useSkillsStore` 用于非广场场景（如高级设置页面将来使用）。
- **Rationale**: 广场的状态维度（Tab + 分类 + 排序 + 视图模式 + 两个独立列表）与现有 store 差异大，混用会增加复杂性。
- **Alternative considered**: 扩展现有 `useSkillsStore` 增加 `plazaSkills`、`categories` 等字段。拒绝，1470 行页面 + 459 行 store 已经过于膨胀，不利于渐进替换。
- **Deprecation Note**: 现有 `useSkillsStore` 在本期 change 完成后不再被 `/skills` 路由引用。保留至后续"高级设置"页面实现后统一评估废弃或迁移，避免双 store 长期并存造成维护负担。

### 5. 卡片数据来源：广场 Tab 从后端 API 获取，我的技能从本地扫描
- **Decision**:
  - "技能广场" Tab（`activeTab === 'all'`）：调用 `GET /api/skill-plaza/list`，后端合并 STO 远端市场目录 + 本地已安装状态返回完整列表
  - "我的技能" Tab（`activeTab === 'mine'`）：调用 `GET /api/skill-plaza/mine`，后端扫描本地 `skills/` + `lock.json` + `openclaw.json` 返回已安装技能（含 enabled 状态）
- **Rationale**: 广场 Tab 需要全量目录（含未安装），我的技能 Tab 只需要本地安装过的。分开接口减少不必要的数据传输。
- **Alternative considered**: 单一接口返回全量 + 客户端过滤。拒绝， STO 远端市场列表可能较大，且"我的技能"不需要远端数据。

### 6. 安装 / 删除流程：复用现有 `StoSkillService` 安装能力
- **Decision**: 广场的安装操作调用 `POST /api/skill-plaza/install`，后端内部委托 `StoSkillService.install()`；删除操作调用 `POST /api/skill-plaza/uninstall`，委托 `StoSkillService.uninstall()` 或删除本地自建技能目录。安装后重启 Gateway 并刷新列表。
- **Rationale**: 复用已验证的安装 / 卸载流程（ZIP 下载、解压、frontmatter 补丁、lock.json 更新），不重复造轮子。
- **Alternative considered**: 前端直接调用现有 `installStoSkill` store action。拒绝，广场走新的 host-api 路由保持架构一致。

### 7. 详情弹窗数据结构：从技能元数据 + data-attributes 构建
- **Decision**: `SkillPlazaService` 在每个技能数据中包含 `detail` 对象（`intro`、`steps[]`、`schedule`、`output`、`overview`），详情弹窗消费该数据结构。对于工作流类型技能（`kind === 'workflow'`），展示全部 sections；普通技能仅展示 intro + 使用入口。
- **Rationale**: 详情数据由后端管理，保持一致性，避免前端硬编码各技能的步骤和输出描述。
- **Alternative considered**: 类似设计稿的 `data-skill-*` 属性方式，在前端维护详情映射表。拒绝，不利于扩展和维护。

### 8. 视图切换与排序：视图纯前端，排序与搜索走后端参数
- **Decision**: 视图切换（card / list）是纯前端 UI 状态；排序（hot / recent）和搜索关键词通过后端查询参数传递，由服务端在分页前完成全量过滤与排序。前端根据返回顺序直接渲染，不再本地重排。
- **Rationale**: 当技能总数超过分页阈值时，前端仅持有部分数据，本地排序/搜索会导致结果不准确（真正的"热门"或匹配项可能在未返回的分页数据中）。服务端全量处理可保证分页场景下的正确性，同时使 `categoryCounts` 与当前列表严格对齐。
- **Alternative considered**: 纯前端本地排序 + 本期取消分页阈值。拒绝，因为全量返回会增加传输开销，且分页控件已在本期 UI 需求中。

### 9. 分页策略：阈值控制 + 后续迭代
- **Decision**: 本期设置分页阈值为 50 条。当技能总数 ≤ 50 时一次性返回全量；当 > 50 时返回前 50 条并设置 `hasMore: true`，前端展示分页控件。完整分页（`page`/`pageSize` 参数）留到下期迭代。
- **Rationale**: 当前技能数量较少，无需分页；但保留扩展性避免数据量增长后性能下降。
- **Alternative considered**: 本期即实现完整分页。拒绝，增加前端复杂度且当前不需要。

### 10. Points 字段：本期固定值，后续动态计算
- **Decision**: 技能卡片的"预计积分"本期固定展示"预计8积分"，不进行动态计算。后端 `points` 字段统一返回 `8` 或 `null`。后续迭代根据工作流步骤数、API 调用次数、token 消耗等因素动态计算。
- **Rationale**: 积分计算引擎需要额外工作量，且对 MVP 功能非必需；固定值可满足首期展示需求。
- **Alternative considered**: 本期即实现动态积分计算。拒绝，需要设计积分计算规则和引擎，增加首期交付风险。

### 11. `source` 字段：不持久化存储，由 `author_id` 实时推导
- **Decision**: 数据模型中的 `source` 字段（`"official"` / `"mine"`）不在 `skills` 表中持久化存储。后端在查询时根据 `skills.author_id` 与当前登录用户对比实时推导：`author_id == 当前用户` → `mine`（自建），否则 → `official`（官方）。`source` 查询参数过滤在后端转换为 `author_id` 条件执行。
- **Rationale**: 官方技能与自建技能的本质区别仅在于创建者是否当前用户，无需额外字段；减少数据冗余，避免规则变化时的大面积迁移。前端标签显示（官方 / 已安装 / 自建）由 `source` + `installed` 联合判断。
- **Alternative considered**: 在 `skills` 表中新增 `source` 字段并持久化存储。拒绝，因为判断规则简单且唯一，加字段只会增加维护负担和同步风险。

### 12. `kind` 字段与 `detail` 子字段：本期不区分工作流，仅保留 `intro`
- **Decision**: 去掉 `kind`（`"normal"` / `"workflow"`）字段，详情弹窗不再区分工作流与普通技能，统一仅展示 `detail.intro` 技能介绍。连带去掉 `detail.steps`、`detail.schedule`、`detail.output`、`detail.overview` 四个子字段。
- **Rationale**: 技能广场本期所有技能均为普通技能，不存在工作流类型；去掉 `kind` 和冗余 `detail` 子字段可大幅简化数据模型和详情弹窗 UI 逻辑，减少前后端维护成本。
- **Alternative considered**: 保留 `kind` 和全部 `detail` 子字段作为扩展预留。拒绝，因为本期无工作流需求，预留字段只会增加数据模型的理解成本和表结构复杂度；未来确有工作流需求时可作为独立 change 重新设计。

### 13. `useCount`（使用数）：前端点击统计，异步埋点
- **Decision**: `useCount` 采用**方案 A — 前端点击统计**。用户点击"使用"按钮时，前端异步调用 `POST /api/skill-plaza/use`，后端将 `skills.use_count` +1。统计口径为"点击使用按钮并成功跳转对话页面的次数"，不追踪 Gateway 实际执行情况。
- **Rationale**: 
  - 实现成本最低，无需 Gateway 层改造或 transcript 文件解析
  - 和设计意图对齐："使用数"是热度指标，反映用户兴趣，点击次数已足够
  - 和 `installCount`（安装数）口径一致，都是用户行为计数
  - 异步埋点不阻塞跳转流程，失败不影响用户体验
- **Alternative considered**: 
  - **方案 B（对话页面埋点）**：需要对话页知道当前技能上下文，增加耦合
  - **方案 C（Gateway 运行时统计）**：最准确但实现成本高，需要 Gateway 暴露执行统计或跨 session 聚合 transcript
  - **方案 D（本期放弃）**：设计稿有三件套（安装数/使用数/积分），放弃使用数会降低卡片信息密度。拒绝 D，选择成本最低的 A

### 14. 跳转路径：后端存 `defaultPrompt`，前端拼接路由
- **Decision**: 数据模型用 `defaultPrompt`（string）替代 `href`。后端存储技能的默认初始 prompt，前端在点击"使用"时通过 `encodeURIComponent(defaultPrompt)` 拼接为 `/conversation?q=<encodedPrompt>` 完成跳转。
- **Rationale**: 
  - 后端只需存储纯文本 prompt，无需关心前端路由结构和 URL 编码规则
  - 前端统一控制跳转目标（对话页），如果未来对话路由变更，不需要改后端数据
  - `defaultPrompt` 语义更清晰，直接表达业务含义
- **Alternative considered**: 
  - **方案 A（后端存完整 `href`）**：后端直接返回 `/conversation?q=...`。拒绝，因为 URL 编码、路由格式属于前端职责，后端不应硬编码前端路由路径；且同一 prompt 在不同环境（Web/桌面）可能有不同路由

## Risks / Trade-offs

| Risk | Mitigation |
|------|-----------|
| 现有 Skills 页面高级功能（API Key、环境变量）被移除 | 在广场页面保留最小入口（如"高级设置"链接），或在 Settings 页面提供技能配置界面（后续 change） |
| Gateway 未就绪时广场列表缺少 enabled 状态 | "我的技能" Tab 从 `openclaw.json` 直接读取 enabled 状态，不强依赖 Gateway RPC；广场 Tab 的列表中已安装技能的安装状态从 `lock.json` 读取 |
| STO 远端市场不可达时广场列表为空 | 后端降级策略：远端不可达时仅返回本地已安装技能 + 分类配置中的推荐技能，前端展示降级提示 |
| 分类映射不完整导致部分技能出现在"全部"但无分类标签 | `SkillPlazaService` 对未映射技能标记 `category: null`，前端在"全部" Tab 展示但不显示分类标签 |
| 分类映射文件随技能增长难以维护 | `skill-categories.json` 当前为手动维护；当技能数量超过 200 或分类调整频率提高时，需升级为远程分类 API 或工具化生成映射 |
| 安装后 Gateway 重启耗时 ~10-30s 期间状态不一致 | 安装操作设置 `installing` loading 状态，完成后刷新列表；Toast 提示"安装成功，正在生效" |

## UI Tokens（docs/sto-design.md）

| 用途 | Token |
|------|-------|
| 主操作按钮 / 使用 CTA / 视图切换激活 | Brand-6 `#FF6F00` |
| 已安装标签背景 | Success Green-1 `#DCF5E2`，文本 Green-7 `#008F40` |
| 官方标签背景 | Info Blue-1 `#F0F4FF`，文本 Blue-6 `#4760FE` |
| 自建标签背景 | Brand-1 `#FFF5E6`，文本 Brand-7 `#D95700` |
| 卡片背景 | White `#FFFFFF` |
| 页面背景 | Grey-1 `#FAFBFC` / Grey-2 `#F5F6F7` |
| 主标题 / 主文本 | Grey-10 `#1D2129` |
| 描述文本 / 次要文本 | Grey-8 `#86909C` |
| 分类导航激活底色 | Grey-3 `#F0F2F5` |
| 分割线 / 边框 | Grey-4 `#E5E6EB` |
| Toast 背景 | Grey-10 `#1D2129` 80% 透明 |
| 删除按钮 | Danger Red-6 `#FA3C3C` |
