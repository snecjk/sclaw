## Why

StoClaw 项目已具备 OpenSpec 基础设施（`openspec/` 目录、spec-driven schema），但缺少针对本项目技术栈和业务领域的 spec 开发规范。这导致 AI 协作者在创建新 change 时难以确定模块边界、spec 命名和编写标准，降低了规范驱动开发的效率与一致性。

## What Changes

- 分析 StoClaw 项目架构，建立按业务模块划分的 spec 目录结构与命名规范
- 制定 spec 各阶段（proposal → design → specs → tasks）的编写标准与验收准则
- 创建可复用的 spec 模板（Markdown + YAML frontmatter），覆盖 Electron 主进程、Renderer 页面、共享类型等常见变更场景
- 更新 `openspec/config.yaml` 注入项目上下文（技术栈、目录约定、API 边界规则）
- 提供一份完整的示例 spec，演示从 proposal 到 tasks 的全流程

## Capabilities

### New Capabilities
- `spec-directory-structure`: 定义 StoClaw 各业务模块（Agents、Channels、Chat、Settings 等）对应的 spec 目录组织与命名规范
- `spec-writing-standards`: 定义 proposal、design、spec、task 各 artifact 的编写标准、验收清单和常见反模式
- `spec-example-template`: 提供针对 Electron + React 技术栈的可复用 spec 模板与示例 change
- `spec-project-context`: 更新 `openspec/config.yaml`，注入项目专属上下文（技术栈、目录约定、Renderer/Main 边界规则）

### Modified Capabilities
<!-- 无现有 spec 需要修改 -->

## Impact

- `openspec/config.yaml` — 新增项目上下文和 per-artifact 规则
- `openspec/specs/` — 新增规范目录与示例 spec
- 团队/AI 协作流程 — 所有新 change 遵循统一规范
