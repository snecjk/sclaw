# 产物展开时临时收起侧边栏设计

## 目标

聊天产物从分栏预览切换为 `expanded` 时，临时收起左侧 Sidebar，让产物使用完整应用工作区宽度。退出 `expanded` 后恢复展开前的用户侧栏偏好。

## 范围

- 仅作用于聊天产物预览的 `PreviewMode.expanded`。
- 覆盖所有使用 `useChatPreviewPanel` 的聊天入口。
- 不改变学习中心等其他 `preview-expanded` 布局。
- 不修改 DOM Fullscreen、预览尺寸、侧栏样式或动画。

## 方案

### AppShell 临时状态

在 `AppShellLayoutProvider` 内增加非持久化的 `previewContextCollapsed` 布尔状态，并通过 Context 暴露稳定 setter。

侧栏上下文收起条件调整为：

```text
contextCollapsed = workflowEditorActive || previewContextCollapsed
```

该状态只参与现有 `user / viewport / context` 有效状态计算，不写入 `settings.sidebarCollapsed`，也不调用 Host API。

### 预览状态同步

`useChatPreviewPanel` 根据 `isPreviewExpanded` 使用 `useLayoutEffect` 同步 `previewContextCollapsed`：

- `split -> expanded`：设置为 `true`。
- `expanded -> split`：设置为 `false`。
- 关闭预览、切换会话或 Hook 卸载：清理为 `false`。
- Hook 位于 AppShell Provider 外时不执行侧栏联动，保持 isolated test/embed 安全。

使用 `useLayoutEffect` 是为了让 Workspace 展开与 Sidebar 收起在同一次绘制前完成，避免短暂显示旧宽度。

## 状态恢复规则

| 展开前用户偏好 | 产物 expanded | 退出 expanded |
| --- | --- | --- |
| Sidebar 展开 | 临时收起 | 自动恢复展开 |
| Sidebar 已收起 | 继续收起 | 仍保持收起 |
| 视口强制收起 | 继续收起 | 仍由视口条件决定 |
| 工作流上下文收起 | 继续收起 | 仍由工作流上下文决定 |

展开期间 `canUserRestoreSidebar` 保持为 `false`，用户通过产物区域的“还原”按钮退出 expanded；不额外显示侧栏恢复按钮。

## 不采用的方案

不在展开和还原时调用 `setUserCollapsed(true/false)`。该方法会持久化设置，并可能在异常退出、Strict Mode effect 重放或状态竞争时覆盖用户真实偏好。

不提升全局 `ContentHeaderProvider` 来派生侧栏状态。该方案改动范围更大，并会把学习中心等其他 `preview-expanded` 页面一并纳入。

## 测试

- AppShell Provider：预览上下文为 `true` 时有效侧栏宽度为 `0`，但 user reason 和 Settings Store 保持不变。
- AppShell Provider：预览上下文清除后恢复原有效宽度。
- Chat preview：`split -> expanded -> split` 正确同步临时状态。
- Chat preview：关闭、切换会话和卸载均清理临时状态。
- 用户原本收起时，退出 expanded 不会把 Sidebar 错误展开。

## 验收标准

- 点击产物展开按钮后，Sidebar 与其拖拽手柄消失，产物区域使用完整 Workspace。
- 点击产物还原按钮后，恢复分栏预览，Sidebar 按展开前用户偏好恢复。
- 刷新或重启应用不会因产物展开状态改变用户的侧栏设置。
- 学习中心和其他非聊天展开页面行为不变。
