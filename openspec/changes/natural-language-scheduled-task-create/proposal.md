## Why

当前用户通过自然语言对话创建定时任务时，系统仅在本地创建任务记录，未调用云端 STO Scheduled Tasks API 进行持久化。这导致：
1. 对话中创建的任务不会出现在云端任务列表中
2. 任务无法跨设备同步
3. 用户期望的"说到做到"体验断裂

本功能通过内置 Skill 规范化自然语言创建流程，实现对话式创建云端定时任务的完整闭环。

## What Changes

- 新增内置 Skill `create-scheduled-task`，用于从自然语言对话中提取定时任务参数
- 新增参数校验和缺失参数引导填写的 UI 组件
- 新增云端 API 调用逻辑，确保任务创建到 STO 云端
- 新增创建成功后的引导跳转逻辑
- 修改定时任务创建流程，支持自然语言 → 参数提取 → 校验 → 确认 → 云端创建

## Capabilities

### New Capabilities
- `scheduled-task-nl-creation`: 自然语言创建定时任务的完整流程，包括参数提取、校验、确认和云端同步
- `scheduled-task-nl-skill`: 内置 Skill，定义从自然语言中提取定时任务参数的规范和校验规则
- `scheduled-task-nl-confirmation-modal`: 参数确认弹窗组件，用于展示提取的参数并引导用户补充缺失信息

### Modified Capabilities
- `scheduled-tasks-list`: 任务列表页需要支持从自然语言创建入口跳转后的状态展示

## Impact

- 新增 `src/pages/ScheduledTasks/components/TaskNlCreationModal.tsx` 组件
- 新增 `src/lib/scheduled-task-nl-extractor.ts` 参数提取工具
- 新增 `sto-plugin/sto-agent-telemetry/` 下的内置 Skill 定义
- 修改 `src/stores/scheduledTasks.ts` 增加自然语言创建入口
- 可能需要在 Chat 页面增加创建定时任务的快捷入口
- 依赖 STO Scheduled Tasks API (`/agent/v1/scheduled-tasks`)
