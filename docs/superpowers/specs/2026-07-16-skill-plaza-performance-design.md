# 技能广场性能优化设计

## 目标

在不修改依赖、lockfile、构建配置和既有产品行为的前提下，消除技能广场加载链路中的重复请求、串行全量拉取和重复渲染。

验收目标：

- 热启动技能广场首屏内容在 1 秒内可见。
- 热启动「我的技能」在 1.5 秒内可见。
- 冷启动优先显示可用缓存或骨架，完整数据在 3 秒内返回。
- 冷启动外部请求不超过 3 个，热启动阻塞型外部请求为 0。
- 50 张技能卡片滚动稳定 60fps。
- 单个技能安装状态变化不触发其他技能卡片重新渲染。

## 已确认的根因

1. 页面挂载同时调用 `fetchCategories`、`fetchPlazaSkills` 和 `syncUserSkills`，登录用户会重复请求分类和广场列表。
2. `syncUserSkills` 串行等待分类、广场和本地技能，并通过全屏加载态阻止已返回的广场数据展示。
3. `getLocalSkills` 为补全已安装技能元数据，先拉取全量广场，再按每个分类串行拉取最多 1000 条数据，分类缺失时还会逐技能请求详情。
4. 单次 `getPlazaSkills` 会分别请求列表和分类计数，初始「全部」场景实际重复请求同一页。
5. Apollo 配置、分类定义和广场列表没有共享缓存或在途请求去重。
6. `overlayLocalState` 对每条技能重复扫描目录并解析 `lock.json`。
7. 「我的技能」搜索和分类已经在前端过滤，但仍会触发完整 `fetchLocalSkills`。
8. 切换到「我的技能」时，Store action 和页面 effect 都会触发本地技能加载。
9. 卡片一次性全部挂载，订阅整个 Zustand store，并在每次渲染时处理 SVG 字符串和 Tooltip。

## 总体方案

采用分层优化，按数据关键路径、本地聚合、渲染和观测四个层次推进。各层可以独立验证，但最终共同满足性能目标。

### 1. 统一首屏加载

页面只保留一个 `loadPlazaSnapshot` 入口：

1. 读取 Main 进程中的有效缓存。
2. 合并分类、广场列表和本地安装状态后立即返回首屏快照。
3. 缓存过期时在后台静默刷新，不清空已有数据。
4. 当前用户变化时精确失效用户相关的本地状态，不重复清空公共广场数据。

删除以下重复触发：

- 页面 mount 期间并行执行的独立分类与广场请求。
- `syncUserSkills` 中重复执行的分类与广场请求。
- 切换「我的技能」时 Store action 与页面 effect 的双重本地请求。

### 2. Main 进程快照与缓存

新增职责明确的内部模块：

- `SkillPlazaRemoteCache`：缓存 Apollo 配置、分类定义和广场列表。
- `SkillLocalStateSnapshot`：一次读取技能目录、禁用目录和 `lock.json`，生成可复用的安装状态快照。
- `SkillPlazaRequestRegistry`：按请求 key 合并在途 Promise，并在完成后清理。

缓存策略：

| 数据 | TTL | 失效条件 |
| --- | --- | --- |
| Apollo 技能分类配置 | 10 分钟 | 用户角色变化 |
| 分类定义 | 10 分钟 | Apollo 分类配置变化 |
| 广场列表及分类计数 | 2 分钟 | 安装、卸载、上传、排序或查询条件变化 |
| 本地技能元数据 | 5 分钟 | 安装、卸载、上传、启用状态变化或用户变化 |

缓存采用 stale-while-revalidate：

- 有缓存时立即返回旧值并后台刷新。
- 后台刷新成功后更新 Store。
- 后台刷新失败时保留旧值并标记数据可能不是最新。
- 无缓存且冷启动失败时显示错误空态。

### 3. 广场列表聚合

`getPlazaSkills` 只请求一次远端 plaza API：

- 直接使用同一响应中的 `categoryCounts`。
- 初始「全部」场景不再调用 `fetchRemoteCategoryCounts`。
- 分类筛选需要全局计数时，优先复用未筛选快照；无快照时并行拉取，而不是串行阻塞列表。
- Apollo 配置和分类定义通过缓存模块共享，单次链路不得重复请求。
- 请求开始时创建一份本地状态快照，整批技能归一化时复用。

### 4. 本地技能按需补全

`getLocalSkills` 改为本地优先：

1. 扫描当前用户已安装和禁用的 slug。
2. 从广场快照索引按 slug 补全标题、描述、分类和版本。
3. 对缓存中缺失的 slug 执行有限并发详情补全，并设置独立超时。
4. 不再执行「全量广场 + 每个分类」的分页下载。
5. 补全失败时使用 `SKILL.md` 或 `openclaw.json` 的本地元数据，不阻止本地列表展示。

有限并发详情补全最多同时执行 4 个请求，单请求超时 3 秒。补全结果写入广场索引缓存。

### 5. Store 状态与竞态控制

将单一 `loading` 拆分为：

- `plazaLoading`：无广场数据时的首次加载。
- `mineLoading`：无本地技能数据时的首次加载。
- `backgroundRefreshing`：已有数据时的后台刷新。

请求控制：

- 每种查询生成稳定 request key。
- 相同 key 复用在途请求。
- 新搜索开始时取消上一轮搜索请求。
- Store 为每类请求保存递增 requestId，只有最新响应可以写入状态。
- 「我的技能」搜索和分类完全使用本地数据，不触发网络请求。
- 安装、卸载和上传采用乐观更新，并只失效受影响的 slug 与相关计数。

页面展示策略：

- 有数据时始终保留列表。
- 后台刷新仅显示局部轻量状态。
- 只有首次且无任何数据时显示骨架或错误空态。

### 6. 渲染优化

- `SkillCard` 和 `SkillCardList` 使用 `React.memo`。
- 卡片通过 selector 只订阅 `installing[slug]`、`uninstalling[slug]` 等自身状态。
- 关闭状态下的详情 Modal 不订阅完整广场和本地列表。
- SVG 宽高替换在数据归一化阶段或 memo 中执行一次。
- Tooltip 内容按交互状态挂载，减少首屏组件数量。
- 为 50 条列表采用不新增依赖的渐进渲染或窗口化实现；首屏先渲染可视区域，空闲时补齐后续卡片。
- 建立 `plazaSkillBySlug` 索引，替代 render 期间的线性 `find`。
- 「我的技能」分类解析和搜索结果使用 memo 化索引。
- hover 展示删除按钮优先使用 CSS，避免每行 hover 都调用 `setState`。

## 外部请求与错误处理

- STO 列表请求超时 5 秒。
- STO 详情补全请求超时 3 秒。
- 超时通过 `AbortController` 取消底层 `fetch`。
- IPC 现有 15 秒超时继续作为上层兜底。
- 业务错误不自动重试；网络瞬时失败的后台刷新最多重试一次，并使用短退避。
- 用户主动搜索不自动重试，避免旧查询占用资源。
- 日志和指标不得包含 token、完整认证头或用户敏感信息。

## 性能观测

增加以下本地指标：

- `skill_plaza.first_content_ms`
- `skill_plaza.mine_content_ms`
- `skill_plaza.external_request_count`
- `skill_plaza.cache_hit`
- `skill_plaza.cache_stale_hit`
- `skill_plaza.remote_fetch_ms`
- `skill_plaza.local_scan_ms`
- `skill_plaza.card_commit_ms`

每次页面加载生成关联 ID，Renderer、Host API 和 Main 日志使用该 ID 关联请求，但不改变传输协议。

## 测试策略

### Store 与页面测试

- 登录用户挂载页面只触发一组首屏加载。
- 切换「我的技能」只触发一次必要加载。
- 「我的技能」搜索和分类不产生网络请求。
- 后台刷新保留现有列表。
- 旧 requestId 的响应不能覆盖新查询。
- 安装状态变化只更新目标 slug。

### Main 服务测试

- 相同 key 的并发请求只调用一次远端 API。
- 有效缓存直接返回且不阻塞远端请求。
- 过期缓存先返回旧值，再触发一次后台刷新。
- 安装、卸载、上传和用户变化正确失效缓存。
- `getPlazaSkills` 初始列表只调用一次 plaza API。
- `getLocalSkills` 不执行按分类全量分页。
- 本地状态快照在一次请求中只读取一次目录和 lockfile。
- 详情补全并发上限为 4，超时后回退本地元数据。

### 性能回归测试

- 记录首屏与「我的技能」可见时间。
- 断言冷启动外部请求不超过 3 个。
- 断言热启动没有阻塞型外部请求。
- 使用 React Profiler 验证单卡状态变化不会提交其他卡片。
- 使用 50 条测试数据验证滚动和渐进渲染。

## 实施顺序

1. 建立性能基线和请求计数测试。
2. 合并页面与 Store 的重复触发。
3. 实现 Main 缓存、在途去重和请求级本地状态快照。
4. 简化 `getPlazaSkills`，移除重复分类计数请求。
5. 重写 `getLocalSkills` 为按已安装 slug 补全。
6. 增加超时、取消、竞态控制和 stale-while-revalidate。
7. 优化 Store selector、卡片 memo、SVG 和列表渲染。
8. 完成性能基准、单元测试、typecheck、lint。
9. 检查 `README.md`、`README.zh-CN.md` 和 `README.ja-JP.md` 是否需要同步。

## 工程约束

- 不修改 `package.json`、lockfile、构建脚本或构建配置。
- 不运行依赖安装、升级或移除命令。
- Renderer 继续通过 `host-api.ts` 和 `api-client.ts` 访问 Main。
- 不在 Renderer 直接请求 Gateway 或 STO HTTP API。
- 不修改既有 WS → HTTP → IPC 通信策略。
- 不进行与技能广场性能无关的重构。

