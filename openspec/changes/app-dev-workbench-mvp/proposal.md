# Proposal: 应用开发工作台 MVP（本地闭环）

## Why

公司提供基础业务接口，希望业务人员（非专业开发者）通过自然语言在 SClaw 内开发自己的前端应用。现状：SClaw 已有项目 workspace、项目 Agent、对话开发与 webview 预览容器，但缺少"从模板创建代码应用 → 自动准备运行环境 → 启动 dev server → 所见即所得预览 → 改坏可回滚"的产品闭环。

MVP 采用**本地优先**策略：不接 GitLab（放 P1），先跑通本地创建、对话开发、实时预览与本地 git checkpoint 回滚，任何远端故障不影响用户开发。完整背景与分期见 `docs/应用广场-用户应用开发能力-技术方案.md`（已评审）。

## What Changes

- 新增"创建应用"向导：应用名 + 类型（前端 / 前端+后端）+ 目录，从内置 React+Vite monorepo 模板初始化项目（`.npmrc` 指向公司 snpm 镜像），复用 session-catalog 创建 workspace 与项目 Agent
- 新增 Node 运行时托管：首次需要时下载便携版 Node 22 LTS 至 `~/.stoclaw/runtime/node/`，参照现有 uv/Python 托管模式（内网源 → npmmirror → 官方三级降级，SHASUMS256 校验）
- 新增 dev server 管理：Main 进程统一 spawn/端口分配/就绪探测/日志采集/退出清理
- 新增应用开发工作台页面：左对话（复用 Chat + 项目 Agent）右预览（复用 webview 容器加载 localhost），dev server 错误自动回流 Agent 修复
- 新增本地 git checkpoint：Agent 每轮改动后自动 commit，工作台提供"恢复上一版"

## New Capabilities

- `app-create-scaffold`：创建应用向导与工程模板初始化
- `service-node-runtime`：托管 Node 运行时（下载、校验、解析、进度）
- `service-dev-server`：用户项目 dev server 生命周期管理
- `app-dev-workbench`：对话 + 预览工作台（含错误回流与回滚入口）
- `service-git-checkpoint`：本地自动 checkpoint 与恢复

## Modified Capabilities

- 无（session-catalog、项目 Agent、webview 预览按现有契约复用，不改行为）

## Impact

- Renderer：新增工作台页面与创建向导；全部经 host-api 调用，不新增直接 IPC
- Main：新增 `electron/utils/node-runtime*.ts`、scaffold / dev-server / git-checkpoint 服务与对应 Host API 路由
- 不修改依赖、lockfile、构建打包配置（Node/git 均运行时下载，零新增 npm 依赖；解压用系统 tar）
- UI 遵循 `docs/sto-design.md` 语义 token，含暗色模式适配
- 越界项（需工程负责人/外部配合）：内网源挂载 Node 便携包；GitLab 集成（P1 单独 change）
