## Context

StoClaw 是一个基于 Electron + React 19 + Vite + TypeScript 的桌面应用，为 OpenClaw AI agent 运行时提供 GUI。项目已配置 OpenSpec（`openspec/` 目录 + spec-driven schema），但 `openspec/specs/` 为空，`config.yaml` 未注入项目上下文。开发者在创建新 change 时缺乏针对本项目技术栈和模块划分的指导，导致 AI 生成的 artifacts 经常出现以下问题：
- spec 名称与项目模块不对应（如用 `feature-x` 而非 `chat-message-sync`）
- 忽略 Electron Main/Renderer 边界规则（AGENTS.md 明确要求通过 host-api 通信）
- task 粒度不均，缺少与项目构建/测试流程的衔接

## Goals / Non-Goals

**Goals:**
- 建立与 StoClaw 模块架构（Pages → Components → Stores → Electron Services）对齐的 spec 目录命名规范
- 制定各 artifact 的编写标准，使 AI 生成的内容可直接用于 code review 而无需大量重写
- 创建可复用模板，覆盖新页面、新 Electron API、新 Store 等常见变更场景
- 将 AGENTS.md 中的关键约束（Renderer/Main 边界、Gateway 代理规则、Comms checklist）注入 `openspec/config.yaml`

**Non-Goals:**
- 不修改任何业务功能代码
- 不重构现有 openspec CLI 工具或 schema
- 不强制要求所有历史功能补写 spec（仅规范未来变更）

## Decisions

### 1. Spec 目录按业务模块划分，而非技术层级
- **决策**: 新 capability 的 spec 名称应对应 `src/pages/` 或 `electron/services/` 中的业务模块（如 `chat-send-flow`、`settings-ai-provider`），而非技术层级（如 `frontend-component`、`backend-api`）。
- **理由**: 业务模块名对 AI 和 Reviewer 更直观，且与 proposal 中 "What Changes" 的 bullet 天然对应。
- **替代方案**: 按技术层级划分（`frontend/`, `backend/`, `shared/`）。放弃原因：StoClaw 的变更通常是跨层级的（如新增 Chat 功能涉及 Renderer page + Electron service + Store），按业务模块聚合更自然。

### 2. 在 `openspec/config.yaml` 中注入完整项目上下文
- **决策**: 将 AGENTS.md 中的技术栈、边界规则、构建命令、测试命令写入 `config.yaml` 的 `context` 字段，并为 proposal/specs/tasks 设置 `rules`。
- **理由**: OpenSpec CLI 在生成 instructions 时会读取 `config.yaml`，注入上下文可让 AI 在创建 artifacts 时自动遵守项目约定，减少人工纠正。
- **替代方案**: 维护独立的 `openspec/CONTEXT.md`。放弃原因：OpenSpec CLI 原生支持 `config.yaml`，额外文件会增加维护成本。

### 3. 提供 3 类场景模板，而非 1 个通用模板
- **决策**: 针对 StoClaw 最常见的 3 类变更提供专用模板：
  1. **新 Renderer 页面**（React page + Route + Store slice）
  2. **新 Electron 主进程能力**（Main-process API + IPC channel + host-api 封装）
  3. **UI 组件增强**（Component + Hooks，不涉及 Main/Renderer 通信）
- **理由**: 通用模板无法覆盖 Electron 架构的特殊约束（如 IPC 边界、CORS 代理）。专用模板可显著降低 AI 写出违反 AGENTS.md 规则代码的概率。
- **替代方案**: 仅提供 1 个通用模板 + 文字说明。放弃原因：实际使用中发现 AI 对文字约束的遵循率低于结构化模板。

### 4. 验收准则采用 "Checklist + 反模式示例" 双栏格式
- **决策**: 在 `spec-writing-standards` 中，每个 artifact 的验收标准用 checklist 列出，并配对常见反模式示例。
- **理由**: 纯 checklist 容易被忽略，反模式示例可帮助 AI 和人类快速识别问题。

## Risks / Trade-offs

| Risk | Mitigation |
|------|-----------|
| 规范过于详细导致开发者抵触 | 保持规范为 "最低必要约束"（MVP），不强制格式细节（如标点符号），仅约束架构边界和模块命名 |
| config.yaml 上下文过长超出 token 限制 | 将 AGENTS.md 精炼为 bullet 形式，控制在 100 行以内；Per-artifact rules 仅列出最关键 3-5 条 |
| 模板与项目实际演进脱节 | 在 `spec-writing-standards` 中声明模板版本号，要求重大架构变更时同步更新模板 |
| AI 仍可能生成不符合规范的 artifacts | 在 `tasks.md` 阶段加入 "对照 spec-writing-standards checklist 自检" 的任务项 |
