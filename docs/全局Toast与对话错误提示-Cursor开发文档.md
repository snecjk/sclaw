# 全局 Toast 与对话错误提示 · Cursor 收敛修正版开发文档

> 适用项目：`/Users/tiancanyang/Documents/sto-claw/sto-claw`
>
> 当前分支：`canyang-ui-flow4`
>
> 核对基线：`0922052c`
>
> 风险等级：T2（中风险）
>
> 设计稿：<https://mastergo.com/goto/URrc9tdK?page_id=39:06193&layer_id=45:10535&file=195806630222772>
>
> 文档目的：纠正上一版实现中过度抽象、定位不准和视觉不一致的问题，以最小改动完成需求。

---

## 1. Cursor 先读：本次不是继续叠补丁

当前工作区已经有一版未完成实现。不要在它上面继续增加定位工具、公共组件或兼容层；应先收敛错误方向，再基于原代码直接修改。

本次最终目标不是建立新的“通知系统”，而是：

1. 在原有应用级 Sonner `<Toaster>` 上修改位置和样式。
2. 在原有 `HomeMainConversation` 错误区域上修改样式和位置。
3. 保证同一个对话错误只在输入框上方出现一次。
4. 不改变任何错误内容、业务行为、发送链路和错误数据结构。

### 1.1 最终运行时代码范围

正常情况下，最终只需要修改以下三个运行时文件：

- `src/App.tsx`
- `src/pages/Home/HomeMainConversation.tsx`
- `src/styles/globals.css`

当前任务不应继续修改：

- `src/components/layout/MainLayout.tsx`
- `src/pages/Home/HomeComposer.tsx`
- chat store、Gateway、IPC、发送和重试链路

### 1.2 应清理的本次新增抽象

以下文件是上一版为本任务新增的实现。如果确认没有其他真实调用方，应删除，而不是继续修补：

- `src/components/common/AppToaster.tsx`
- `src/lib/toast-anchor-geometry.ts`
- `src/components/chat/chat-error-notice.tsx`

同时删除 `MainLayout.tsx` 中仅为本任务新增的 `data-toast-anchor="main-content"`。

删除这些文件不是推翻产品需求，而是撤回不必要的实现方式。原有 `<Toaster>` 和原有错误区域已经具备正确的业务入口，本次只需要改变它们的呈现。

---

## 2. 必须遵循的 T2 流程

本任务按 `.cursor/rules/00-workflow-and-risk.mdc` 的 T2 执行。

Cursor 开始前必须完整读取：

1. 根目录 `AGENTS.md`
2. `.cursor/rules/README.md`
3. `.cursor/rules/00-workflow-and-risk.mdc`
4. `.cursor/rules/01-code-rules.mdc`
5. `.cursor/rules/02-styles.mdc`
6. `.cursor/rules/05-engineering-guardrails.mdc`
7. `docs/sto-design.md`
8. `openspec/config.yaml`
9. `openspec/changes/unify-toast-and-chat-error-feedback/` 下的全部现有工件
10. 本文列出的源代码文件

执行前先记录现场：

```bash
git branch --show-current
git status --short
git diff -- src/App.tsx src/components/layout/MainLayout.tsx src/pages/Home/HomeMainConversation.tsx src/styles/globals.css
```

要求：

- 保留工作区内与本任务无关的改动。
- 不使用 `git reset --hard`、`git checkout --` 等整文件粗暴回退命令。
- 清理当前错误实现时，应做目标明确的人工编辑。
- 不创建分支、不提交、不推送，除非用户另行明确要求。
- 不安装或升级依赖，不修改依赖、lockfile、构建配置、构建脚本和 CI。
- 不执行打包。
- React 19 下不要为了本任务新增 `useCallback`、`useMemo` 或 `React.memo`。

### 2.1 T2 三阶段

#### 阶段 A：分析与对齐

先通过设计稿 MCP 读取准确尺寸，并检查当前页面在以下状态的实际布局：

- 省区布局，侧栏展开
- 省区布局，侧栏折叠
- 普通布局，侧栏展开
- 普通布局，侧栏折叠
- 无侧栏页面

给用户汇报计划后再开始实现。用户已经认可的主方向是“原位修改、删除多余抽象”，不需要再次提出通知系统重构方案。

#### 阶段 B：小步实现

按以下顺序做，每一步都检查 diff：

1. 修正 OpenSpec 工件，使其描述最小实现。
2. 清理 `AppToaster`、几何 helper、MainLayout anchor。
3. 在 `App.tsx` 直接修正全局 `<Toaster>`。
4. 在 `globals.css` 修正四类 Toast 视觉。
5. 清理 `ChatErrorNotice`，在 `HomeMainConversation.tsx` 原位改错误卡片。
6. 重写或删除与已删除抽象绑定的测试。
7. 做浏览器视觉验收与回归验证。

#### 阶段 C：复核

完成后向用户列出：

- 实际修改和删除的文件
- 与上一版相比减少了哪些抽象
- 自动测试结果
- 浏览器逐状态截图或测量结果
- 尚未验证的风险（如果有）

---

## 3. 产品需求和边界

### 3.1 全局 Toast（需求 1）

位置参考设计稿图一：

- Toast 位于右侧主内容区顶部居中。
- 不是整个浏览器窗口居中。
- 侧栏展开、折叠时仍应相对主内容区居中。
- 设计稿样例中，Toast 距主内容区顶部约 `23px`；最终以 MCP 图层测量为准。

样式参考设计稿图二：

- 通知：蓝色
- 警告：黄色
- 错误：红色
- 成功：绿色
- 普通 `toast()` / `toast.message()` 使用通知样式
- 保留 Sonner 原有的关闭、自动消失、多条堆叠、description、action、cancel、loading 和 promise 行为

不得逐个修改业务中的大量 `toast.*` 调用点。

### 3.2 对话错误提示（需求 2）

- 只保留输入框上方的一处错误卡片。
- 当前 `HomeComposer` 下方已经没有重复错误，不要再次修改它。
- 卡片继续展示 `useChatStore.error` 的原始内容。
- 关闭继续调用现有 `clearError()`。
- 图中的“复制文本”和“重试”只参考按钮样式和布局。
- 当前 store 只提供字符串错误和清除能力，因此不要凭空增加“复制文本”“重试”按钮。
- 如果未来上游确实提供 action，再按原本有什么展示什么；本任务不扩展错误类型。

### 3.3 明确不做

- 不修改错误产生、恢复、清除时机。
- 不修改 `ChatState.error` 或 runtime error 类型。
- 不分析错误字符串并生成按钮。
- 不新增复制、重试功能。
- 不修改发送、Gateway、watchdog、IPC 或历史恢复逻辑。
- 不把对话错误替换成短暂 Toast。
- 不统一全项目其他 Banner、表单校验或 inline error。
- 不创建新的通知中心或通用反馈组件库。

---

## 4. 当前工作区问题诊断

Cursor 应先通过 `git diff` 验证下列事实，不要机械相信行号。

### 4.1 补丁过大的原因

上一版为两个现有展示点新增了：

- `AppToaster` 封装
- `toast-anchor-geometry` 几何计算 helper
- `MainLayout` DOM anchor
- `ChatErrorNotice` 公共组件
- 与这些抽象绑定的测试

这些新增代码没有带来新的业务能力，却扩大了布局、组件和测试边界。尤其是 `ChatErrorNotice` 当前只有一个调用方，抽象收益不足。

### 4.2 Toast 当前可见问题

1. 虽然新增了锚点和几何计算，Toast 仍没有稳定居中在主内容区。
2. 当前自定义 Lucide 图标是描边图标，与设计稿的实心状态图标不一致。
3. `unstyled: true` 关闭了 Sonner 默认内容布局，但自定义 `content` class 没有完整重建 title、description 和 action 的布局，容易产生结构问题。
4. 测试主要检查源代码字符串和 wiring，不能证明真实位置、图标和样式正确。

### 4.3 对话错误当前可见问题

1. 为唯一调用方新增组件，属于提前抽象。
2. 视觉虽接近参考，但仍应直接在原有区域按 MCP 校准。
3. 不需要新增 action 插槽，因为当前数据模型没有 action。

---

## 5. 方案比较和最终决策

### 5.1 方案 A：原位修改（最终采用）

- `App.tsx` 保留并直接配置原有 `<Toaster>`。
- 用现有侧栏状态和布局模式确定 Toaster 的水平中心偏移。
- `globals.css` 集中覆盖 Sonner 的状态样式。
- `HomeMainConversation.tsx` 直接修改原有错误区域 JSX 和 class。
- 删除三个只为本需求新增的抽象文件。

优点：

- 与原代码结构一致。
- 运行时改动面最小。
- 不增加 DOM 测量和 ResizeObserver 生命周期。
- 业务行为更容易保持不变。
- 后续定位视觉问题更直接。

### 5.2 方案 B：继续修补 `AppToaster` 和 geometry helper（否决）

否决原因：

- 当前实现已经证明复杂度没有换来正确定位。
- 固定应用壳层可以从现有布局状态计算，无需读取 DOM。
- 增加 observer、监听器和 geometry helper 会放大测试与维护成本。

### 5.3 方案 C：改每个 `toast.*` 调用点（否决）

否决原因：容易漏改，并把统一视觉分散到业务代码。

### 5.4 方案 D：保留 `ChatErrorNotice`（当前否决）

当前只有一个真实调用方，不满足抽象价值。如果以后出现至少两个结构和行为一致的真实消费者，可另开任务提取。

---

## 6. 全局 Toast 实施规范

### 6.1 `src/App.tsx`：直接配置原有 Toaster

恢复或保持直接导入：

```tsx
import { Toaster, toast } from 'sonner';
```

不要再通过 `AppToaster` 包一层。

原有结构大致为：

```tsx
<Toaster
  position="bottom-center"
  richColors
  closeButton
  style={{ zIndex: 99999 }}
/>
```

修改目标：

- `position="top-center"`
- 保留 `richColors`
- 保留 `closeButton`
- 保留高于页面普通内容的 z-index
- 增加稳定的 Toaster class，供 `globals.css` 覆盖
- 根据当前布局计算右侧主内容区中心
- 按设计稿确定 `offset`、`gap`、`visibleToasts`

示意结构，不要求逐字复制：

```tsx
<Toaster
  className="sto-global-toaster"
  position="top-center"
  richColors
  closeButton
  offset={toastTopOffset}
  gap={toastGap}
  visibleToasts={toastVisibleCount}
  style={{
    left: toastCenterX,
    right: 'auto',
    transform: 'translateX(-50%)',
    zIndex: 99999,
  }}
/>
```

Cursor 必须查阅当前 Sonner `2.0.7` 的类型和实际 DOM，确认 `style` 被施加在哪一层，以及 `position="top-center"` 的内置 transform 是否需要覆盖。不要仅凭示意代码盲写。

### 6.2 水平定位：使用现有布局状态，不做 DOM 几何系统

可使用项目已有状态：

- `useSettingsStore` 中的侧栏折叠状态
- 已有的 `getSidebarLayoutVariant()` 或当前布局模式来源
- 当前路由是否显示侧栏

不要新增：

- `ResizeObserver`
- `MutationObserver`
- `getBoundingClientRect()` 定位循环
- `data-toast-anchor`
- `toast-anchor-geometry.ts`
- 新的全局 Context 或布局 store

当前 CSS 中侧栏宽度应以真实 Token 为准核对，已知参考值为：

| 布局 | 主内容中心相对 viewport 中心的参考偏移 |
| --- | ---: |
| 普通布局，侧栏展开 260px | `+130px` |
| 普通布局，侧栏折叠 72px | `+36px` |
| 省区布局，侧栏展开且主内容左侧额外 8px | `+134px` |
| 省区布局，侧栏折叠且左右各有 8px 外边距 | `+36px` |
| 无侧栏 | `0px` |

这些数值是根据当前布局结构推导出的实施参考，不是不可变常量。Cursor 必须对照 `globals.css`、`MainLayout.tsx` 和浏览器实际边界验证。

可采用简单字符串计算：

```ts
const toastCenterX = `calc(50% + ${offset}px)`;
```

只有在布局模式或侧栏状态变化时重新渲染即可；窗口宽度变化由百分比自动适应。

无侧栏路由必须回到 `50%`。不得假定所有路由都有主侧栏；应从当前路由结构核对登录、初始化、设置或精灵窗口等页面。

### 6.3 垂直定位

- 目标是相对右侧主内容区顶部约 `23px`。
- 先通过 MCP 获取图层 y 值，再在浏览器测量主内容容器 top。
- Sonner 的 `offset` 相对 viewport，不一定等于相对主内容区的 23px。
- 如果应用壳层顶部有固定间距，应把它计入最终 offset。
- 不要为了垂直 1 个固定偏移新增 DOM anchor helper。

### 6.4 保留 Sonner styled 模式

本次不要使用全局 `unstyled: true`，除非 Cursor 能证明已经完整覆盖以下状态：

- title
- description
- icon
- action
- cancel
- close button
- loading
- promise success/error
- 多行换行
- 多 Toast 堆叠

推荐保留 Sonner styled DOM 和默认内容布局，只通过 `className` 与高优先级属性选择器覆盖视觉表面。这样可以避免重新实现它内部的 content/action 布局。

### 6.5 图标策略

优先使用 Sonner 内置状态图标。当前 Sonner 的 success、info、error 图标为实心圆形状态 SVG，通常比上一版自定义 Lucide 描边图标更接近设计稿。

规则：

- 不要统一替换成 `CheckCircle2`、`Info`、`AlertTriangle`、`XCircle` 等描边图标。
- 通过 CSS 控制 `[data-icon]` 和 SVG 的尺寸、颜色。
- 只有 MCP 明确显示某一类图标与 Sonner 内置图标不一致时，才单独替换该类型。
- 调用方显式传入自定义 `icon` 时，应保留调用方内容，不能被统一图标无条件覆盖。

### 6.6 四类视觉 Token

以下为设计稿已读取值，Cursor 仍应通过 MCP 再核对图层：

| 类型 | 背景 | 边框 | 图标 |
| --- | --- | --- | --- |
| 通知 info/default | `#F0F4FF` | `#D6E1FF` | `#4760FE` |
| 警告 warning | `#FFFBE6` | `#FFF1B8` | `#F4AA17` |
| 错误 error | `#FFF2F0` | `#FFE4E0` | `#FA3C3C` |
| 成功 success | `#EAF6EE` | `#C8EAD6` | `#31AF65` |

共同样式：

- 参考宽度：`260px`
- 宽度策略：内容自适应，但不能超出主内容区和窄窗口
- padding：`16px 18px`
- info / warning / error 圆角：`8px`
- success 圆角：`10px`
- 阴影：`0 2px 4px rgba(0, 0, 0, 0.03)`
- 图标：`18px × 18px`
- 图标与文字间距：`8px`
- 正文：`14px / 18px`
- 正文颜色：`#1D2129`

不要为了“统一”擅自把成功圆角改成 8px；以 MCP 精确值为准。如果设计稿不同状态确实不一致，应忠实实现并在交付说明中指出。

### 6.7 CSS 实现建议

在 `globals.css` 中使用项目命名空间，例如：

```css
[data-sonner-toaster].sto-global-toaster [data-sonner-toast] {
  /* 共同尺寸、字体、阴影 */
}

[data-sonner-toaster].sto-global-toaster
  [data-sonner-toast][data-type='info'],
[data-sonner-toaster].sto-global-toaster
  [data-sonner-toast][data-type='normal'] {
  /* 蓝色通知 */
}
```

实际 selector 必须以浏览器中的 Sonner DOM 为准。至少覆盖：

- `success`
- `info`
- `warning`
- `error`
- 普通 `toast()` / `toast.message()` 对应的 normal/default type
- loading

建议把反馈色整理为 `:root` 和 `.dark` 下的语义变量，但仅保留实际使用的变量。删除上一版仅服务 geometry helper 且已不用的变量，例如：

- `--sto-toast-center-x`
- `--sto-toast-top`
- `--sto-toast-max-width`

如果新的直接实现仍真实使用其中某个变量，则可以保留，但必须有明确消费者。

### 6.8 宽度和长文本

- 单行短文案参考 260px，不等于所有 Toast 强制固定 260px。
- 多行 title/description 必须自然换行。
- 最大宽度不得超过 `主内容宽度 - 左右安全间距`。
- 窄窗口建议保留至少 16px viewport gutter。
- action/cancel 不能因强制 `width: max-content` 被挤出屏幕。
- 对超长无空格字符串应有 `overflow-wrap: anywhere` 或等价策略。

---

## 7. 对话错误卡片实施规范

### 7.1 直接修改 `HomeMainConversation.tsx`

保留现有数据：

```ts
const error = useChatStore((state) => state.error);
const clearError = useChatStore((state) => state.clearError);
```

在原有 `error && (...)` 区域直接修改 JSX 和 class。不要再导入 `ChatErrorNotice`。

结构应保持简单：

```tsx
{error && (
  <div role="alert" className="...">
    <StatusIcon aria-hidden="true" className="..." />
    <div className="...">{error}</div>
    <button
      type="button"
      aria-label={t('common.close')}
      onClick={clearError}
      className="..."
    >
      <X aria-hidden="true" className="..." />
    </button>
  </div>
)}
```

图标名称和无障碍文案应使用项目已有依赖及真实 i18n key，不要凭空创建不需要的新体系。

### 7.2 布局和样式

设计参考值：

- 与聊天输入框同一内容轨道宽度
- 背景：`#FFFBE6`
- 边框：`#FFF1B8`
- 圆角：`10px`
- padding：`8px`
- 警告图标：`16px`
- 图标色：`#FAAD14`
- 正文：`13px / 20px`
- 正文色：`#1D2129`
- 关闭按钮位于右上侧，图标参考 `16px`
- 与输入框垂直间距以 MCP 图层为准

使用现有聊天内容轨道 class（当前代码中的 `stoChatColumnContentTrackClass` 或真实等价项），不要重新复制一套宽度计算。

长错误文本必须：

- 保留完整内容
- 正常换行
- 超长无空格内容可断行
- 必要时卡片内容区可滚动，避免把输入框完全挤出视口

### 7.3 不展示虚构操作

当前 `error` 是 `string | null`，当前调用方没有 action。因此本次卡片只显示：

1. 状态图标
2. 原始错误文本
3. 关闭按钮

不要显示：

- 复制文本
- 重试
- 查看详情
- 根据错误字符串猜测出的任何按钮

### 7.4 重复提示验证

`HomeComposer.tsx` 当前不应订阅或渲染 `useChatStore.error`。原则上不要修改该文件，只做搜索验证：

```bash
rg -n "useChatStore.*error|state\.error|clearError|No response received" src/pages/Home
```

验收结果必须是：同一个首页对话错误只有 `HomeMainConversation` 输入框上方一个可见 owner。

---

## 8. OpenSpec 修正要求

继续使用现有 change：

```text
openspec/changes/unify-toast-and-chat-error-feedback/
```

不要新建第二个 change。

### 8.1 `proposal.md`

修改为：

- 在 `App.tsx` 直接调整既有 Toaster。
- 在 `HomeMainConversation.tsx` 直接调整既有错误区域。
- 删除本次过度新增的定位和展示抽象。
- 不改变错误模型、业务行为和 action。

### 8.2 `design.md`

删除或改写以下旧决策：

- 新建 `AppToaster`
- MainLayout anchor + geometry helper
- `unstyled: true` 全量重建 Sonner
- 新建 `ChatErrorNotice`

替换为：

- 直接配置应用级 Toaster
- 基于现有布局模式与侧栏状态计算固定中心偏移
- 保留 Sonner styled 结构，用全局命名空间 CSS 覆盖视觉
- 首页对话错误原位修改

记录设计稿 MCP 的准确值和浏览器验证结果。

### 8.3 `specs/`

规范中的用户可观察行为可以保留，但不得把内部实现名称写成强制要求。把 `ChatErrorNotice` 等具体组件名改为“首页对话错误区域”。

必须覆盖：

- Toast 相对主内容区顶部居中
- 四种语义视觉
- 普通 Toast 映射为通知
- 保留 description/action/loading 等已有内容
- 错误只出现一次
- 原始错误文本和关闭行为不变
- 无 action 时不展示虚构 action

### 8.4 `tasks.md`

之前标记完成、但实际采用错误方案的任务应重新打开或替换。增加：

- 清理三个新增抽象文件
- 清理 MainLayout anchor
- 恢复 App 直接 Toaster
- 原位修改 HomeMainConversation
- 重写行为测试
- 五种布局状态的视觉校验

不得因为旧任务曾被勾选，就保留与最终方案冲突的代码。

---

## 9. 测试策略

### 9.1 不要继续使用脆弱的源码字符串测试

当前新增测试如果主要通过 `readFileSync`、字符串查找来证明文件里存在某段代码，应重写或删除。此类测试只能证明 wiring 文本存在，不能证明 Toast 真正居中或样式正确。

与已删除组件/helper 绑定的 import 必须清理：

- 不再 import `AppToaster`
- 不再 import `toast-anchor-geometry`
- 不再 import `ChatErrorNotice`

### 9.2 推荐自动测试

根据现有测试基础设施，至少验证：

1. App 渲染唯一 Toaster。
2. `toast.success/info/warning/error/message` 产生对应 type 的 Toast。
3. title、description、action、close button 没有被 CSS/配置破坏。
4. `HomeMainConversation` 有 error 时显示原始文本。
5. 点击关闭按钮调用现有 `clearError()`。
6. 没有 error 时不显示卡片。
7. 首页不存在第二处相同错误展示。

如果完整 App 测试代价过高，允许做最小集成测试，但不要为了测试而重新创建生产抽象。

### 9.3 推荐命令

先运行定向测试，再运行项目级检查：

```bash
pnpm exec vitest run tests/unit/app-toaster.test.tsx tests/unit/chat-error-notice.test.tsx
pnpm run typecheck
pnpm run lint
git diff --check
```

如果测试文件重命名，使用实际路径。

遵守项目限制：不要运行安装命令。若依赖缺失，只报告环境问题。

本任务不触及通信路径，因此通常不要求 `comms:replay` / `comms:compare`；如果 Cursor 意外改到通信或发送链路，应立即停止，因为已经超出范围。

---

## 10. 浏览器视觉验收

自动测试不能替代位置和视觉验收。Cursor 应使用用户提供的设计稿 MCP 与实际应用逐项对照。

### 10.1 全局 Toast 矩阵

| 场景 | 必测 |
| --- | --- |
| 省区布局 + 侧栏展开 | 是 |
| 省区布局 + 侧栏折叠 | 是 |
| 普通布局 + 侧栏展开 | 是 |
| 普通布局 + 侧栏折叠 | 是 |
| 无侧栏页面 | 是 |
| 窄窗口 | 是 |
| 暗色模式 | 是 |

每个场景至少检查：

- Toast 中心 x 是否等于主内容区中心 x，允许最多 1–2px 渲染误差。
- 顶部距离是否符合 MCP。
- 不被侧栏、标题栏和内容卡片裁切。
- 多条 Toast 堆叠方向和间距正确。
- close button 可点击。

### 10.2 四类样式

分别触发：

```ts
toast.info('这是一段普通通知文本')
toast.warning('这是一段警告通知文本')
toast.error('这是一段错误通知文本')
toast.success('这是一段成功通知文本')
toast.message('这是一段普通通知文本')
```

再验证：

- 多行 description
- 超长文本
- action + cancel
- loading / promise
- 调用方自定义 icon

核对背景、边框、圆角、图标形态、图标颜色、字体、间距、阴影和宽度。

### 10.3 对话错误卡片

构造与用户截图相近的长错误文本，验证：

- 只出现一处
- 位于输入框上方
- 与输入框共用内容轨道
- 长文本完整且可读
- 不出现复制/重试按钮
- 关闭后调用 `clearError()` 并消失
- 不改变输入框高度、按钮位置和发送行为

---

## 11. 完成定义（Definition of Done）

以下全部满足才算完成：

- [ ] 现有 OpenSpec 已改为最小实现方向。
- [ ] `App.tsx` 直接渲染并配置唯一全局 Toaster。
- [ ] `AppToaster.tsx` 已删除且无引用。
- [ ] `toast-anchor-geometry.ts` 已删除且无引用。
- [ ] `MainLayout.tsx` 不再包含本任务新增的 toast anchor。
- [ ] `ChatErrorNotice.tsx` 已删除且无引用。
- [ ] `HomeMainConversation.tsx` 原位呈现设计稿错误卡片。
- [ ] `HomeComposer.tsx` 没有重复 error 展示。
- [ ] Toast 相对主内容区顶部居中，而非 viewport 居中。
- [ ] 展开、折叠、普通、省区和无侧栏状态均通过。
- [ ] info/default、warning、error、success 四类样式符合 MCP。
- [ ] 使用实心状态图标或 MCP 指定图标，不再使用不符设计的统一描边图标。
- [ ] title、description、action、cancel、loading、promise、close 行为未退化。
- [ ] 对话错误保持原始内容和 `clearError()` 行为。
- [ ] 没有凭空新增复制、重试等功能。
- [ ] 没有修改 store、Gateway、IPC、发送和错误模型。
- [ ] 没有修改依赖、lockfile、构建配置、构建脚本或 CI。
- [ ] 定向测试、typecheck、lint、`git diff --check` 通过，或明确记录与本任务无关的既有失败。
- [ ] 最终 diff 中没有无消费者的新增变量、组件和 helper。

---

## 12. Cursor 最终执行提示词

可以把下面内容直接作为 Cursor 的实施指令：

```text
请严格按 docs/全局Toast与对话错误提示-Cursor开发文档.md 执行本次 T2 修正。

先读取 AGENTS.md、Cursor rules、现有 OpenSpec、设计稿 MCP 和当前 git diff。当前工作区已有一版过度实现，不要继续叠补丁。

目标是最小化运行时改动：
1. 删除本任务新增且无其他调用方的 AppToaster、toast-anchor-geometry、ChatErrorNotice。
2. 删除 MainLayout 中仅为 Toast 新增的 data-toast-anchor。
3. 在 src/App.tsx 直接修改原有 Sonner Toaster 的位置和配置。
4. 保留 Sonner styled 结构，在 globals.css 集中覆盖 info/default、warning、error、success 样式；不要用统一 Lucide 描边状态图标。
5. 使用现有布局模式、侧栏折叠状态和路由信息计算主内容区中心，不新增 DOM 测量、ResizeObserver 或定位 helper。
6. 在 HomeMainConversation.tsx 原有 error 区域直接修改样式；保持原始 error 文本和 clearError；不新增复制/重试。
7. HomeComposer 当前已无重复错误，原则上不修改，只验证。
8. 更新现有 openspec/changes/unify-toast-and-chat-error-feedback，不新建 change。
9. 重写或删除仅检查源码字符串、或依赖已删除抽象的测试。
10. 完成后必须实际验证省区/普通布局、侧栏展开/折叠、无侧栏、窄窗口、暗色，以及 Toast 的 description/action/loading/promise。

不要修改依赖、lockfile、构建配置、构建脚本、CI、store、Gateway、IPC、发送链路或错误类型。每一步都先检查 diff，避免覆盖用户其他改动。先给出分析和具体修改清单，再按小步骤执行。
```

---

## 13. 给实施者的最后判断标准

这次修正的质量不以“新增了多少可复用代码”衡量，而以以下结果衡量：

- Toast 真正居中并与设计稿一致。
- 对话错误卡片只出现一次并与设计稿一致。
- 原有 Sonner 和错误业务行为没有退化。
- 最终补丁比上一版更小、更直接、更容易验证。

如果为完成以上结果仍需要再新增布局组件、geometry helper 或错误展示抽象，应先停止并说明现有结构为什么无法完成，不要自行扩大方案。
