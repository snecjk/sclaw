## Why

全局 Toast 需相对主内容区居中；四类通知视觉与对话错误卡片需与设计一致。早期实现用 `collapsed ? 72 : 260` 估算侧栏宽，与省区「收起 = 0 + 8px Frame」、Settings 无侧栏等事实冲突。

## What Changes

- Toast 四态视觉与对话错误卡片样式（已落地）保持。
- **定位契约修订（2026-07-31）**：禁止继续把 `72/260` 写死为 Toast 偏移来源；改为消费 `workspace-shell-architecture-upgrade` / `app-shell-foundation` 的 `effectiveSidebarWidth`（Settings / no-sidebar → `0`；省区 collapsed → `0`，不是 72）。
- 在 shell Stage 1 完成前，现有 `App.tsx` 硬编码视为迁移债务，不在本 Change 扩写第二套宽度公式。

## Capabilities

### New Capabilities

- `notification-feedback`: 全局 Toast 主内容区定位、四态视觉、现有 content/action/loading/promise 兼容
- `chat-error-feedback`: 对话错误唯一展示、上方卡片、dismiss 行为

### Modified Capabilities

- （无 published capability 文件）定位公式与 `app-shell-foundation` 对齐

## Impact

- Renderer：`App.tsx` Toaster 偏移（Stage 1 由 shell Change 改线）、`HomeMainConversation.tsx`、`globals.css`
- Depends on: `openspec/changes/workspace-shell-architecture-upgrade` for effective width
- 不涉及 API / IPC / Gateway / store schema / 依赖 / 工程配置
