## Why

全局 Toast 仍挂在 viewport `bottom-center`，展开侧栏时无法相对主内容区居中；四类通知视觉也与 MasterGo 稿不一致。对话错误条仍是旧红色顶栏样式，且需要与「同一错误只出现一次」的基线一起做回归保护。`HomeComposer` 下方重复错误已在当前分支移除，本次不改。

## What Changes

- 在 `App.tsx` 直接调整既有 Sonner `<Toaster>`，使用侧栏状态 + `calc()` 实现主内容区居中。
- 在 `globals.css` 用命名空间 CSS 覆盖四类 Toast 视觉（info/warning/error/success），保留 Sonner styled 结构和内置图标。
- 在 `HomeMainConversation.tsx` 原位修改错误区域为 warning 卡片样式。
- 删除上一版过度新增的 `AppToaster`、`toast-anchor-geometry`、`ChatErrorNotice` 抽象。

## Capabilities

### New Capabilities

- `notification-feedback`: 全局 Toast 主内容区定位、四态视觉、现有内容/action/loading/promise 兼容
- `chat-error-feedback`: 对话错误唯一展示、上方卡片、dismiss 行为

### Modified Capabilities

- （无既有 capability 文件需修改）

## Impact

- Renderer：`App.tsx`、`HomeMainConversation.tsx`、`globals.css`
- 不涉及 API / IPC / Gateway / store schema / 依赖 / 工程配置
