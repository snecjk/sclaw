## ADDED Requirements

### Requirement: scheduled-task-nl-creation
系统 SHALL 支持通过 AI 模型调用的 `create_scheduled_task` 工具从自然语言对话创建云端定时任务。

#### Scenario: 用户输入完整的自然语言任务描述
- **WHEN** 用户在对话中输入"每天早上 9 点生成周报 PPT"
- **THEN** AI 模型识别定时任务创建意图并调用 `create_scheduled_task` 工具，提取任务名称"生成周报 PPT"和 cron 表达式"0 9 * * *"

#### Scenario: AI 模型提取参数
- **WHEN** `create_scheduled_task` 工具被调用
- **THEN** 工具返回 JSON 格式的提取参数，包含 `type: "scheduled_task_confirmation"`、`extractedParams` 对象

#### Scenario: 用户输入缺少任务名称
- **WHEN** 用户输入"每周一上午 10 点提醒我开会"但 AI 未能提取任务名称
- **THEN** 工具返回错误信息，提示缺少必填参数 name

#### Scenario: 参数确认弹窗
- **WHEN** 工具调用完成且返回有效的 extractedParams
- **THEN** 前端弹出参数确认框，展示提取的任务名称、cron 表达式（转换为可读时间格式）、描述

#### Scenario: 用户确认创建
- **WHEN** 用户点击确认框中的"创建任务"按钮
- **THEN** 调用云端 API `/agent/v1/scheduled-tasks` 创建任务

#### Scenario: 创建成功
- **WHEN** 云端 API 返回成功
- **THEN** 显示成功 Toast 提示，并自动跳转到定时任务列表页

#### Scenario: 创建失败
- **WHEN** 云端 API 调用失败（网络错误、权限不足等）
- **THEN** 显示错误信息，保留确认框，提供重试按钮

### Requirement: create_scheduled_task-tool
系统 SHALL 提供 `create_scheduled_task` 工具供 AI 模型调用，用于从自然语言中提取定时任务参数。

#### Scenario: 工具注册
- **WHEN** OpenClaw 启动时
- **THEN** `sto-scheduled-task-tool` 插件注册 `create_scheduled_task` 工具

#### Scenario: 工具输入验证
- **WHEN** 工具被调用但缺少必填参数 name 或 cronExpr
- **THEN** 返回错误响应，标记 `needsConfirmation: true`

#### Scenario: 工具 cron 验证
- **WHEN** 工具被调用但 cronExpr 格式不正确（不是 5 个部分）
- **THEN** 返回错误响应，标记 `needsConfirmation: true`

#### Scenario: 工具成功提取
- **WHEN** 工具被调用且参数完整有效
- **THEN** 返回成功响应，包含 `extractedParams` 对象和 `needsConfirmation: true`
