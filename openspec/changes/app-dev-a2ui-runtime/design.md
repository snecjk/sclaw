## Context

终局决策：不自研通用渲染器/AG-UI 协议；用 A2UI v0.9 + `@a2ui/react`；AG-UI 按需；业务层自建 Catalog/Action/治理。旧 `cy/application_v2` 上的自研 AGUI WIP 已 stash，本 change 在干净分支 `cy/a2ui-runtime` 落地。

## Goals / Non-Goals

**Goals**
- 新建应用即可预览由 `pages/*.page.json`（A2UI message 序列）驱动的页面
- 单仓结构适配公司 DevOps
- AI 上下文锁定到 Catalog + contracts + pages
- Catalog 可挂 antd 自定义组件

**Non-Goals（本 change）**
- 完整 AG-UI 会话流集成（M4）
- 全量 antd 封装与社区模块 zip 生产化
- 迁移存量 monorepo 用户应用（仅兼容导入/启动）

## Decisions

### D1: 页面资产格式 = A2UI v0.9 message 数组
- **选择**：`pages/*.page.json` 存 `createSurface` / `updateComponents` / `updateDataModel` 消息列表
- **理由**：与官方处理器一致，零自研 schema
- **备选**：自研 pagespec 再编译到 A2UI — 拒绝（重复造轮子）

### D2: 默认 Catalog = basicCatalog（antd 延后）
- **选择**：MVP 仅 `MessageProcessor([basicCatalog])`
- **理由**：先闭环页面资产 + Action；antd Custom Catalog 单独里程碑，避免依赖与属性白名单同时铺开
- **备选**：首日 antd — 用户明确要求先不接入

### D3: 单仓模板 + 开发期本地优先
- **选择**：`resources/app-templates/react-a2ui-template`；`!app.isPackaged` 时优先本地有效模板，避免旧 OSS monorepo zip 污染
- **备选**：继续 OSS 优先 — 在新 zip 未上传前会拉回旧模板

### D4: AG-UI 延后
- **选择**：M1–M3 不依赖 AG-UI；持久页由本地 JSON 喂给 MessageProcessor
- **理由**：主需求是做页预览，不是会话协议
- **备选**：首日接 AG-UI — 扩大范围且非必须

## Risks

- [Risk] A2UI 包 peer（react ^19.2.x）与模板 react 版本漂移 → Mitigation：模板声明兼容区间，创建后以安装日志为准；必要时工程负责人调版本
- [Risk] OSS zip 未更新导致打包环境仍用旧模板 → Mitigation：缓存目录改名；URL 变更后强制刷新；文档标明上传步骤
- [Risk] AI 仍改 `src/` → Mitigation：重写 `.sclaw/AGENTS.md`；校验未注册组件失败
- [Risk] antd 属性暴露过多导致 token 浪费/不准 → Mitigation：Catalog 白名单收敛 props

## Migration Plan

1. Stash 旧 AGUI WIP（已完成）
2. 合入本 change 后上传 `react-a2ui-template.zip` 并更新 `REACT_TEMPLATE_ZIP_URL`
3. 旧 `frontend/` 应用仍可导入启动；新应用一律 A2UI 单仓
