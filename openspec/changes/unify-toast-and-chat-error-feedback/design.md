## Context

- 基线分支：`canyang-ui-flow4`
- 需求文档：`docs/全局Toast与对话错误提示-Cursor开发文档.md`
- 设计稿 MCP：`https://mastergo.com/goto/URrc9tdK?page_id=39:06193&layer_id=45:10535&file=195806630222772`
- `/chat` 路由重定向到 `/`；首页对话错误 owner 为 `HomeMainConversation`

## MCP 视觉参数（已提取）

### Toast（主内容区样例 + 四态条）

| 项 | 值 |
| --- | --- |
| 水平位置 | 相对主内容区水平居中（`calc(50% + sidebarOffset)` 方式） |
| 距主内容顶 | 23px |
| 样例宽 / 策略 | 样例 260；实现：内容自适应 |
| padding | 16px 18px |
| 圆角 | info/warn/error 8px；success 10px |
| 阴影 | `0 2px 4px rgba(0,0,0,0.03)` |
| 图标 | 18×18；与正文 gap 8px |
| 正文 | 14px / 18 / `#1D2129` |

| 态 | 背景 | 边框 | 图标色 |
| --- | --- | --- | --- |
| 通知 info/message | `#F0F4FF` | `#D6E1FF` | `#4760FE` |
| 警告 | `#FFFBE6` | `#FFF1B8` | `#F4AA17` |
| 错误 | `#FFF2F0` | `#FFE4E0` | `#FA3C3C` |
| 成功 | `#EAF6EE` | `#C8EAD6` | `#31AF65` |

### 对话错误卡片

| 项 | 值 |
| --- | --- |
| 宽 | 跟随输入轨（样例 780） |
| 背景 / 边框 | `#FFFBE6` / `#FFF1B8` |
| 圆角 | 10px |
| padding | 8px |
| 图标 | 16 warning `#FAAD14` |
| 正文 | 13px / 20 / `#1D2129` |
| 关闭 | 右上 16 图标 |

## Decisions

1. **直接配置应用级 Toaster，不新建封装组件**
   - 在 `App.tsx` 直接使用 Sonner `<Toaster>` 并传入 `className`、`style` 等。
   - 备选：新建 `AppToaster` 封装 → 否决（过度抽象、DOM 测量复杂度无收益）。

2. **基于侧栏状态 + `calc()` 定位，不做 DOM 几何系统**
   - 使用 `useSettingsStore.sidebarCollapsed` + `getSidebarLayoutVariant()` 计算偏移。
   - 备选：`ResizeObserver` + `data-toast-anchor` → 否决（复杂度高、定位仍不准确）。

3. **保留 Sonner styled 结构，用命名空间 CSS 覆盖视觉**
   - 保留 `richColors`，在 `globals.css` 用 `[data-sonner-toaster].sto-global-toaster` 选择器覆盖。
   - 备选：`unstyled: true` 全量重建 → 否决（需完整重建 content/action 布局）。

4. **首页对话错误原位修改，不新建组件**
   - 在 `HomeMainConversation.tsx` 原有 error 区域直接修改 JSX 和 class。
   - 备选：新建 `ChatErrorNotice` → 否决（当前只有一个调用方，提前抽象）。

5. **`error: string | null` 不变；不展示虚构操作按钮**。

6. **`HomeMainConversation` 唯一首页错误 owner；`HomeComposer` 保持无 error**。

## Risks

- [Risk] 侧栏折叠时定位偏移 → Mitigation：`calc()` 自动响应，百分比适应窗口变化。
- [Risk] 长错误撑破卡片 → Mitigation：正文 `max-height` + `overflow-y-auto` + `break-words`。
- [Risk] 暗色对比度不足 → Mitigation：为 feedback Token 提供 `.dark` 值。
- [Risk] 重复错误提示回归 → Mitigation：Home 只有 `HomeMainConversation` 订阅 error。
