# Tasks: `2026-05-28-skill-plaza`

> 每项实现完成后勾选；须与对应 `### Requirement:` 名称可追溯。

---

## 阶段一：后端基础接口（预计 1~2 天）

**目标**：让 `GET /categories`、`GET /list`、`GET /mine` 三个核心接口能返回符合 spec 的数据结构，前端可直接对接真实接口开发。

### 1.1 数据库准备
- [ ] 1.1.1 执行 `skills` 表结构变更（新增 `category_code`、`use_count`、`points`、`default_prompt`；修改 `icon` 为 text）
- [ ] 1.1.2 初始化存量数据的 `category_code`（根据实际 `category` 值执行 UPDATE）
- [ ] 1.1.3 验证表结构：`DESCRIBE skills` 确认字段和 COMMENT 正确

### 1.2 SkillPlazaService 核心能力
- [ ] 1.2.1 新建 `electron/services/skill-plaza-service.ts`：`SkillPlazaService` 类框架
- [ ] 1.2.2 实现 `getCategories()`：从 `skills` 表 `SELECT DISTINCT category_code, category` + 内置默认分类常量兜底
- [ ] 1.2.3 实现 `getPlazaSkills()`：从 `skills` 表查询 + 逐条检查本地 `lock.json` / `skills/` 填充 `installed` + 读取 `openclaw.json` 填充 `enabled`
- [ ] 1.2.4 实现 `getMySkills()`：扫描本地 `skills/` + `lock.json` 获取已安装 slug 列表，反查 `skills` 表详情
- [ ] 1.2.5 实现 `categoryCounts` 计算：根据 `q` + `categoryCode` + `source` 条件在 SQL 层面分组统计
- [ ] 1.2.6 实现分页逻辑：支持 `page`（默认1）、`pageSize`（默认20，最大50）、`sort`（`hot`/`recent`）

### 1.3 Host-API 路由注册
- [ ] 1.3.1 新建 `electron/api/routes/skill-plaza.ts`：注册 `GET /api/skill-plaza/categories`、`GET /api/skill-plaza/list`、`GET /api/skill-plaza/mine`
- [ ] 1.3.2 在 `electron/api/server.ts` 中注册路由模块
- [ ] 1.3.3 扩展 `electron/api/context.ts`：添加 `skillPlazaService` 实例初始化

### 1.4 接口验证
- [ ] 1.4.1 启动 Electron 后，用 curl/浏览器验证 `GET /api/skill-plaza/categories` 返回正确分类列表
- [ ] 1.4.2 验证 `GET /api/skill-plaza/list` 返回 `skills` + `categoryCounts` + `hasMore` 结构正确
- [ ] 1.4.3 验证 `GET /api/skill-plaza/mine` 只返回本地已安装技能
- [ ] 1.4.4 验证 `source` 推导正确（author_id == 当前用户 → mine，否则 → official）
- [ ] 1.4.5 验证 `installed` / `enabled` 状态与本地文件一致

---

## 阶段二：前后端并行开发（预计 2~3 天）

**目标**：后端完成剩余接口，前端基础 UI 组件对接真实接口开发。

### 2.1 后端剩余接口
- [ ] 2.1.1 实现 `GET /api/skill-plaza/skill/:slug` — 技能详情（含 `detail.intro`）
- [ ] 2.1.2 实现 `POST /api/skill-plaza/install` — 委托 `StoSkillService.install()`，操作本地文件系统
- [ ] 2.1.3 实现 `POST /api/skill-plaza/uninstall` — 委托 `StoSkillService.uninstall()` 或删除自建技能目录
- [ ] 2.1.4 实现 `POST /api/skill-plaza/use` — `skills.use_count + 1`，异步接口

### 2.2 前端 API Client
- [ ] 2.2.1 在 `src/lib/host-api.ts` 新增：`fetchSkillPlazaCategories()`、`fetchSkillPlazaList()`、`fetchMySkills()`
- [ ] 2.2.2 新增：`fetchSkillDetail(slug)`、`installPlazaSkill(slug)`、`uninstallPlazaSkill(slug)`、`recordSkillUse(slug)`
- [ ] 2.2.3 所有方法调用 `hostApiFetch()`，响应类型对齐 `skills-plaza-api` spec

### 2.3 前端 Store
- [ ] 2.3.1 新建 `src/stores/skill-plaza.ts`：定义 `SkillPlazaState` 接口（`activeTab`、`activeCategory`、`searchQuery`、`sortMode`、`viewMode`、`plazaSkills`、`mySkills`、`categories`、`categoryCounts`、`loading`、`installing`、`hasMore`、`threshold`）
- [ ] 2.3.2 实现 `fetchCategories()`、`fetchPlazaSkills()`、`fetchMySkills()` actions
- [ ] 2.3.3 实现 `categoryCounts` 状态消费：从列表接口响应提取并更新到 store
- [ ] 2.3.4 实现分页状态：提取 `hasMore`、`page`、`pageSize`、`total`，支持翻页传入新 `page`

### 2.4 前端基础 UI 组件
- [ ] 2.4.1 新建 `src/components/skill-plaza/` 目录
- [ ] 2.4.2 `SkillPlazaHeader.tsx` — 标题 + 副标题 + Tab 切换（技能广场 / 我的技能）
- [ ] 2.4.3 `SkillPlazaToolbar.tsx` — 搜索框 + 排序下拉（热门/最近）+ 视图切换控件（宫格/条目）
- [ ] 2.4.4 `SkillPlazaCategoryNav.tsx` — 分类导航条，含计数标签，支持点击切换
- [ ] 2.4.5 `SkillCard.tsx` — 卡片组件：图标（SVG 渲染）+ 标题 + 描述 + 标签 + meta（安装数/使用数/积分）+ 快捷操作（使用/安装），支持 hover 淡入
- [ ] 2.4.6 `SkillCardList.tsx` — 条目视图下的单行组件：图标 + 名称 + 描述 + 删除按钮

### 2.5 前端页面框架
- [ ] 2.5.1 重写 `src/pages/Skills/SkillPlazaPage.tsx`：组合 Header + Toolbar + CategoryNav + CardGrid/List
- [ ] 2.5.2 实现 Tab 切换逻辑：`activeTab === 'all'` → 展示 plazaSkills + 隐藏视图切换；`activeTab === 'mine'` → 展示 mySkills + 显示视图切换
- [ ] 2.5.3 实现搜索 + 分类联合过滤：输入搜索词或切换分类时调用列表接口，传入 `q` + `category` 参数
- [ ] 2.5.4 实现排序逻辑：切换排序时调用列表接口并传入 `sort` 参数
- [ ] 2.5.5 挂载时自动 fetchCategories + fetchPlazaSkills

---

## 阶段三：联调与功能补齐（预计 1~2 天）

**目标**：完成交互流程、详情弹窗、状态同步、样式主题、国际化、测试验证。

### 3.1 详情与弹窗
- [ ] 3.1.1 `SkillDetailModal.tsx` — 右侧滑出详情面板：hero + intro + "立即使用"CTA，支持 Esc / 遮罩关闭
- [ ] 3.1.2 `DeleteConfirmModal.tsx` — 确认弹窗：提示文案 + 取消/删除按钮（Danger Red-6）
- [ ] 3.1.3 `SkillPlazaToast.tsx` — 底部居中 Toast，2.2s 自动消失
- [ ] 3.1.4 实现详情数据缓存：`skillDetailsCache` Map，5 分钟有效期，安装/删除后清除

### 3.2 交互流程联调
- [ ] 3.2.1 卡片"使用"按钮：异步调用 `recordSkillUse(slug)` → 跳转 `/conversation?q=<encodedPrompt>`
- [ ] 3.2.2 卡片"安装"按钮：调用 `installPlazaSkill(slug)` → 安装完成后刷新列表 + Toast "安装成功，正在生效"
- [ ] 3.2.3 条目视图"删除"按钮：弹出确认弹窗 → 调用 `uninstallPlazaSkill(slug)` → 删除完成后 Toast "已删除" + 刷新列表
- [ ] 3.2.4 双 Tab 数据同步：安装/删除成功后标记 plazaSkills 和 mySkills 为 stale，下次切换 Tab 时自动重新 fetch
- [ ] 3.2.5 卡片标签渲染逻辑：source=mine → 自建（橙色）；installed=true → 已安装（绿色）；否则 → 官方（蓝色）

### 3.3 样式与主题
- [ ] 3.3.1 新建 `src/components/skill-plaza/skill-plaza.css`，实现全部样式（卡片、分类导航、排序下拉、视图切换、详情弹窗、确认弹窗、Toast）
- [ ] 3.3.2 对齐 `docs/sto-design.md` Token：Brand-6 `#FF6F00` 主操作、Success Green 已安装、Info Blue 官方、Danger Red 删除
- [ ] 3.3.3 响应式网格：3 列 (>900px) → 2 列 (≤900px) → 1 列 (≤600px)
- [ ] 3.3.4 卡片 meta 行（安装数 + 使用数 + 预计积分）和 hover 快捷操作淡入动画

### 3.4 国际化
- [ ] 3.4.1 更新 `src/i18n/locales/zh/skills.json`：标题、副标题、Tab 标签、搜索占位符、排序选项、分类标签、卡片标签、操作按钮、Toast 文案、详情弹窗、确认弹窗
- [ ] 3.4.2 同步更新 `en/skills.json` 和 `ja/skills.json`

### 3.5 测试与验证
- [ ] 3.5.1 运行 `pnpm run lint` 并修复问题
- [ ] 3.5.2 运行 `pnpm run typecheck` 并修复类型错误
- [ ] 3.5.3 审阅 `README.md`、`README.zh-CN.md`、`README.ja-JP.md` 是否需更新 Skills 页面描述
- [ ] 3.5.4 手工验证核心用户旅程：广场安装技能 → 切换我的技能 Tab → 点击使用 → 验证跳转对话页并携带 `q` 参数
- [ ] 3.5.5 手工验证删除流程：我的技能条目视图点击删除 → 确认弹窗删除 → 验证列表移除 + Toast + 广场 Tab 状态恢复
