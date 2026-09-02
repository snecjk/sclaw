## Why

非开发用户需要更快、更准、更省 token 地做出业务页面。自研 AGUI schema/渲染双轨无法形成可预览闭环，且与行业标准脱节。应放弃自研通用渲染器与自研 Agent↔UI 协议，改用成熟开源：**A2UI（声明式 UI + 官方 React 渲染器）**、**AG-UI（按需会话通道）**；SClaw 只自建 antd/STO Catalog、action 契约与单仓工程治理。

## What Changes

- 新增默认应用模板：单仓 Vite + A2UI 宿主（`pages/` 为 AI 主改资产，`src/runtime` + `src/catalog` 为平台壳）
- 应用创建/导入/dev server/`npm install` 支持根目录 `package.json`（不再强制 `frontend/` monorepo）
- AI 引导改为只改 `pages/` 与 `contracts/`，禁止日常改业务 JSX
- Catalog 可扩展 antd/STO 组件；AG-UI 接入放后续里程碑，不阻塞可渲染预览
- 废弃不可渲染的自研 `agui/` 作为主路径（本 change 不恢复旧 AGUI WIP）

## Capabilities

### New Capabilities
- `app-dev-a2ui-runtime`：A2UI 页面资产加载、官方 React 渲染、Catalog 注册与单仓模板宿主
- `app-dev-a2ui-catalog`：antd/STO 自定义 Catalog 封装与白名单属性约束（首批组件）

### Modified Capabilities
- `app-create-scaffold`：默认模板改为 A2UI 单仓模板；校验根 `package.json`
- `service-dev-server`：dev server cwd 解析为含 `package.json` 的应用根（兼容旧 `frontend/`）
- `app-dev-workbench`：引导与预览基于可渲染 A2UI 页面（暗色模式随宿主 CSS 变量）

## Impact

- `resources/app-templates/react-a2ui-template/`：新默认模板
- `electron/services/app-dev-service.ts`、`app-dev-server-manager.ts`：路径/校验/AGENTS 文案
- OSS 模板 zip 需工程负责人上传后替换 URL（开发期优先本地 checkout 模板）
- 模板 `package.json` 将声明 `@a2ui/react`、`@a2ui/web_core`、`antd` 等依赖（用户应用内安装；不改 SClaw 根依赖/lockfile）
- UI 预览页遵循语义 token / 可读暗色对比（模板 CSS 变量）
