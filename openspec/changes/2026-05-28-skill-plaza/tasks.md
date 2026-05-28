# Tasks: `2026-05-28-skill-plaza`

> 每项实现完成后勾选；须与对应 `### Requirement:` 名称可追溯。

## 1. Backend: SkillPlazaService + Host-API Routes

- [ ] 1.1 新建 `skill-categories.json` 分类配置文件（Electron 资源目录），包含分类列表与技能 slug→category 映射。满足 **Requirement: 后端分类定义与管理** + **Requirement: 分类数据本地配置持久化**。
- [ ] 1.2 新建 `electron/services/skill-plaza-service.ts`：`SkillPlazaService` 类，实现 `getCategories()`、`getPlazaSkills()`、`getMySkills()`、`getSkillDetail(slug)`、`installSkill(slug)`、`uninstallSkill(slug)` 方法；内部聚合 `StoSkillService`、本地 `skills/` 扫描、`lock.json`、`openclaw.json`、分类配置。满足 **Requirement: 分类数据本地配置持久化** + **Requirement: 技能归属分类** + **Requirement: 分类计数**。
- [ ] 1.3 新建 `electron/api/routes/skill-plaza.ts`：注册 `GET /api/skill-plaza/categories`、`GET /api/skill-plaza/list`、`GET /api/skill-plaza/mine`、`GET /api/skill-plaza/skill/:slug`、`POST /api/skill-plaza/install`、`POST /api/skill-plaza/uninstall` 路由；在 `electron/api/server.ts` 中注册路由模块。满足 **Requirement: 分类导航** + **Requirement: 广场数据通过 host-api 获取** + **Requirement: 详情弹窗数据来自后端 API**。
- [ ] 1.4 扩展 `electron/api/context.ts`：在 `HostApiContext` 中添加 `skillPlazaService` 实例初始化。

## 2. Frontend Store: useSkillPlazaStore

- [ ] 2.1 新建 `src/stores/skill-plaza.ts`：定义 `SkillPlazaState` 接口（`activeTab`、`activeCategory`、`searchQuery`、`sortMode`、`viewMode`、`plazaSkills`、`mySkills`、`categories`、`loading`、`installing`）和 actions（`fetchCategories`、`fetchPlazaSkills`、`fetchMySkills`、`installSkill`、`uninstallSkill`、`toggleTab`、`toggleCategory`、`setSearch`、`setSort`、`setViewMode`）。满足 **Requirement: 双 Tab 切换** + **Requirement: 排序功能** + **Requirement: 视图切换**。

## 3. Frontend API Client

- [ ] 3.1 在 `src/lib/host-api.ts` 中新增广场 API 方法：`fetchSkillPlazaCategories()`、`fetchSkillPlazaList()`、`fetchMySkills()`、`fetchSkillDetail(slug)`、`installPlazaSkill(slug)`、`uninstallPlazaSkill(slug)`。所有方法调用 `hostApiFetch()`。满足 **Requirement: 广场数据通过 host-api 获取**。

## 4. Frontend UI Components

- [ ] 4.1 新建 `src/components/skill-plaza/` 目录；创建 `SkillPlazaHeader.tsx`（标题 + 副标题 + Tab 切换）。满足 **Requirement: 技能广场页面替换现有 Skills 路由**。
- [ ] 4.2 创建 `SkillPlazaToolbar.tsx`（搜索框 + 排序下拉 + 视图切换控件）。满足 **Requirement: 搜索功能** + **Requirement: 排序功能** + **Requirement: 视图切换**。
- [ ] 4.3 创建 `SkillPlazaCategoryNav.tsx`（分类导航条，含计数标签，支持点击切换）。满足 **Requirement: 分类导航**。
- [ ] 4.4 创建 `SkillCard.tsx`（卡片组件：图标 + 标题 + 描述 + 标签 + meta + 快捷操作，支持 hover 淡入，grid 模式下卡片布局）。满足 **Requirement: 技能卡片渲染**。
- [ ] 4.5 创建 `SkillCardList.tsx`（条目视图下的单行组件：图标 + 名称 + 描述 + 开关 + 删除按钮）。满足 **Requirement: 切换到条目视图**。
- [ ] 4.6 创建 `SkillDetailModal.tsx`（右侧滑出详情面板：hero + intro + steps + schedule + overview + CTA，支持 Esc / 遮罩关闭）。满足 **Requirement: 技能详情弹窗** + **Requirement: 详情弹窗关闭** + **Requirement: 详情弹窗"立即使用"CTA** + **Requirement: 详情弹窗无障碍**。
- [ ] 4.7 创建 `DeleteConfirmModal.tsx`（确认弹窗：提示文案 + 取消/删除按钮，Danger Red-6 删除按钮）。满足 **Requirement: 删除技能**。
- [ ] 4.8 创建 `SkillPlazaToast.tsx`（底部居中 Toast，2.2s 自动消失，Grey-10 80% 透明背景）。满足 **Requirement: Toast 通知**。

## 5. Frontend Page Integration

- [ ] 5.1 重写 `src/pages/Skills/index.tsx`（或新建 `src/pages/Skills/SkillPlazaPage.tsx` + 更新路由）：组合 Header + Toolbar + CategoryNav + CardGrid/List + EmptyState，从 `useSkillPlazaStore` 驱动状态；挂载时 fetchCategories + fetchPlazaSkills。满足 **Requirement: 技能广场页面替换现有 Skills 路由** + **Requirement: 双 Tab 切换** + **Requirement: 搜索无结果**。
- [ ] 5.2 实现 Tab 切换逻辑：`activeTab === 'all'` → 展示 plazaSkills + 隐藏视图切换；`activeTab === 'mine'` → 展示 mySkills + 显示视图切换 + fetchMySkills。满足 **Requirement: 默认展示技能广场 Tab** + **Requirement: 切换到我的技能 Tab** + **Requirement: 技能广场 Tab 隐藏视图切换**。
- [ ] 5.3 实现搜索 + 分类联合过滤：在 store 中根据 `searchQuery` + `activeCategory` 过滤列表并更新分类计数。满足 **Requirement: 搜索与分类联合** + **Requirement: 分类计数更新**。
- [ ] 5.4 实现排序逻辑：hot 按安装数降序、recent 按更新时间降序，前端本地排序。满足 **Requirement: 默认排序** + **Requirement: 切换排序**。
- [ ] 5.5 实现卡片点击打开详情弹窗（非快捷操作区域）+ 卡片"使用"跳转 + 卡片"安装"触发安装流程。满足 **Requirement: 使用技能** + **Requirement: 安装技能**。
- [ ] 5.6 实现"我的技能"条目视图下的开关控件（toggle install/uninstall）和删除按钮 + 确认弹窗。满足 **Requirement: 删除技能**。

## 6. Styling & Theme

- [ ] 6.1 新建 `src/components/skill-plaza/skill-plaza.css`（或在 global 中 scoped），实现设计稿 `.page-skill-plaza` 下全部样式（卡片、分类导航、排序下拉、视图切换、详情弹窗、确认弹窗、Toast），遵循 `docs/sto-design.md` Token 命名。满足 **Requirement: 主题对齐**。
- [ ] 6.2 实现响应式网格：3 列 (>900px) → 2 列 (≤900px) → 1 列 (≤600px)。满足 **Requirement: 默认宫格视图**。
- [ ] 6.3 实现卡片 meta 行（安装数 + 使用数 + 预计积分）和 hover 快捷操作淡入动画。满足 **Requirement: 卡片悬停显示快捷操作**。

## 7. i18n

- [ ] 7.1 更新 `src/i18n/locales/zh/skills.json` 新增广场相关翻译键（标题、副标题、Tab 标签、搜索占位符、排序选项、分类标签、卡片标签、操作按钮、Toast 文案、详情弹窗标题、确认弹窗文案）。满足 **Requirement: 国际化**。
- [ ] 7.2 同步更新 `en/skills.json` 和 `ja/skills.json`。

## 8. Testing & Validation

- [ ] 8.1 单元测试：`SkillPlazaService` 的 getCategories / getPlazaSkills / getMySkills / 分类映射。
- [ ] 8.2 单元测试：store 的过滤 / 排序 / Tab 切换 / 分类切换逻辑。
- [ ] 8.3 组件测试：SkillCard 的渲染标签 / 悬停交互 / 快捷操作。
- [ ] 8.4 运行 `pnpm run lint` 并修复问题。
- [ ] 8.5 运行 `pnpm run typecheck` 并修复类型错误。
- [ ] 8.6 审阅 `README.md`、`README.zh-CN.md`、`README.ja-JP.md` 是否需更新 Skills 页面描述。
