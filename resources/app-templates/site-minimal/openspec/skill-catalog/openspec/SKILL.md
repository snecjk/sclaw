---
name: openspec
description: >-
  在本应用仓库内使用 OpenSpec 做规格驱动开发。新增功能或跨模块改动前，
  先走 proposal → design → specs → tasks → apply，再写业务代码。
version: 0.1.0
---

# OpenSpec 开发技能

本技能安装在**用户应用仓库**的 `openspec/skills/openspec/`（不是 SClaw 客户端仓库）。
Agent 在为本应用做**新功能、跨模块改造、接口/状态架构变更**时，应优先遵循 OpenSpec。

## 工作流（必须按序）

1. **proposal**：说明为什么做、能力范围、影响面（短）
2. **design**：关键决策、备选方案、风险与缓解
3. **specs**：用 SHALL/MUST 写需求，每个需求至少一条 `#### Scenario:`（WHEN/THEN）
4. **tasks**：可独立验证的任务列表，并引用对应 Requirement
5. **apply**：按 tasks 实现；每步可验证后再进入下一步

工件默认落在本应用：

```text
openspec/
  config.yaml
  changes/<change-id>/
    proposal.md
    design.md
    specs/<capability>/spec.md
    tasks.md
  skills/          # 已安装的开发技能（本目录）
```

## 何时必须启用

- 新页面/新能力、多接口联动、权限或数据流变更
- 需要跨 `frontend/` 与 `backend/` 的契约对齐
- 用户明确说「按 OpenSpec / 先写规格」

## 何时可跳过

- 纯文案、间距、图标、颜色等**不改变行为**的微调
- 单文件局部样式且不改 props / hooks / 接口

## Agent 行为约束

- 不确定接口字段时**停止猜测**，先读 `docs/api/` 或向用户确认
- 不要把本技能目录当成业务代码目录去改页面逻辑
- 用简短中文向用户说明：当前处于 OpenSpec 哪一步、下一步要做什么
