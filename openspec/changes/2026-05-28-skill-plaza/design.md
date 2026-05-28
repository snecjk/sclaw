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

### 8. 视图切换与排序：纯前端状态
- **Decision**: 视图切换（card / list）和排序（hot / recent）仅影响前端渲染逻辑，不涉及后端查询参数。排序在后端返回固定顺序的基础上由前端根据统计字段（安装数 / 最近更新时间）本地排序。
- **Rationale**: 当前技能数量有限（<100），本地排序即可；视图是纯 UI concern。
- **Alternative considered**: 将排序和分类作为查询参数传给后端。可考虑但当前不需要，增加接口复杂度。

## Risks / Trade-offs

| Risk | Mitigation |
|------|-----------|
| 现有 Skills 页面高级功能（API Key、环境变量）被移除 | 在广场页面保留最小入口（如"高级设置"链接），或在 Settings 页面提供技能配置界面（后续 change） |
| Gateway 未就绪时广场列表缺少 enabled 状态 | "我的技能" Tab 从 `openclaw.json` 直接读取 enabled 状态，不强依赖 Gateway RPC；广场 Tab 的列表中已安装技能的安装状态从 `lock.json` 读取 |
| STO 远端市场不可达时广场列表为空 | 后端降级策略：远端不可达时仅返回本地已安装技能 + 分类配置中的推荐技能，前端展示降级提示 |
| 分类映射不完整导致部分技能出现在"全部"但无分类标签 | `SkillPlazaService` 对未映射技能标记 `category: null`，前端在"全部" Tab 展示但不显示分类标签 |
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
