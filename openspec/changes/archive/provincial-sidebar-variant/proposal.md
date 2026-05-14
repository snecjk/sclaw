## Why

部分部署（省区版本）需要收窄主壳信息架构：侧栏仅保留首页、定时任务、技能广场、任务列表分组及按时间分桶的历史会话区；对话入口、「我的数据」、工作台分组、对话列表标题与「新对话」主按钮、大号用户资料卡等先隐藏，后续再按用户角色或远端策略逐步放开。需求需在 OpenSpec 中固化，并以可配置开关落地，避免硬删代码。

## What Changes

- 引入侧栏布局变体 `provincial`（**默认**），完整导航通过构建时 `VITE_STOCLAW_SIDEBAR_LAYOUT=full` 显式开启；可见性集中在 `src/lib/sidebar-layout.ts`，便于后续并入角色模型。
- `Sidebar` 按可见性表条件渲染主导航项、工作台区块、对话列表 Chrome、用户卡；省区模式下以紧凑设置入口保留既有下拉菜单（设置 / 语言 / 主题 / 登出），不新增直连 IPC。
- `README.md` 记录默认省区侧栏与 `VITE_STOCLAW_SIDEBAR_LAYOUT=full` 用法。

## Capabilities

### New Capabilities

- `navigation-sidebar-provincial-variant`：省区侧栏可见性规则、环境开关、紧凑账户入口与 i18n。

### Modified Capabilities

- （无顶层已发布 spec 文件被修改；归档中的 `navigation-sidebar-sto-prototype` 在省区模式下仅应用其子集可见性规则，不作为仓库内对该归档文件的直接编辑。）

## Impact

- `src/lib/sidebar-layout.ts`（新）、`src/components/layout/Sidebar.tsx`、`src/vite-env.d.ts`、`src/i18n/locales/*/common.json`、`README.md`。
