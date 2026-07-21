<!-- 从自动加载规则移出的完整说明与示例。事实和强制边界以 ../01-code-rules.mdc 为准。 -->

# sto-claw 代码规则参考

> 视觉 / 样式规则在 `02-styles.mdc`（当前是骨架，跟设计稿边填边补）。
> 本文件覆盖 Renderer (`src/`) 的**代码侧规则**——架构、API、状态、表单、Electron 容器、业务专属、可访问性、性能、禁止清单、AI 自检。Main (`electron/`) 只受始终加载的工程红线和其所在模块的真实契约约束。

## 项目速览

- **Electron 桌面 AI agent 外壳**，跑在渲染进程 (`src/`) + 主进程 (`electron/`)
- React 19 + TypeScript（严格模式）+ Vite + **pnpm 10.31+**
- UI：**Tailwind CSS + shadcn/ui + Zustand + Framer Motion + Lucide React**
- 后端通信：**Main 进程独占 WS → HTTP → IPC 回退**；渲染端只调 `src/lib/` 的两个入口
- 持久化：**electron-store**（普通数据）+ **OS Keychain**（密钥）
- 接口契约：`docs/api-contracts/` + OpenSpec + 项目真实类型
- 错误监控：PostHog 埋点 + `AppError` 统一模型

---

## 目录结构

```
src/
├── lib/              统一前端 API + cn() 等工具
├── stores/           Zustand stores（大型按切片分多个 *-actions.ts）
├── hooks/            跨页面 / 跨 feature 复用的自定义 hooks
├── components/
│   ├── ui/           shadcn/ui 原件（通过 CLI 添加）
│   ├── channels/     按 feature 分子目录
│   ├── common/       跨页面共用
│   ├── file-preview/
│   ├── layout/
│   └── settings/
├── pages/            路由级页面
├── i18n/             本地化资源
├── styles/           全局样式 + 主题 CSS variables
├── types/            跨文件 TS 类型
├── assets/
├── App.tsx
└── main.tsx
```

- 接口调用进 `src/lib/`，**禁止**散落
- 新增 hook 文件默认使用 **`use-kebab-case.ts`**；跨页面复用放 `src/hooks/`，页面 / feature 私有 hook 与使用方就近放置
- 业务组件按 **feature/domain** 分子目录
- `src/` 内跨目录引用优先用 `@/`；同目录 / 同 feature 内允许相对引用
- 根目录 `shared/` 不在 `@/*` 映射内，沿用现有相对路径；不得为消除 `../../` 擅自修改 tsconfig 或复制 shared 代码
- 主进程代码在 `electron/`，不在本规则 src 作用域内

---

## 接口调用 & 错误模型（**最高优先级**）

### 两个入口

| 用途 | 调用 | channel / URL 形式 |
| --- | --- | --- |
| Gateway RPC / IPC / unified channels | `invokeApi` / `invokeIpc` | `module:action` |
| Host route（HTTP 风格） | `hostApiFetch<T>(path)` | `/api/...` |

```tsx
import { invokeApi } from '@/lib/api-client';
import { hostApiFetch } from '@/lib/host-api';

// IPC / RPC 模式
const parts = await invokeApi<Parts>('question:split', { prompt, sessionId });

// Host route（HTTP-style，token quota 检查等）
const quota = await hostApiFetch<QuotaResult>('/api/token-quota/check');

// POST + body
const result = await hostApiFetch<DoctorResult>(
  '/api/app/openclaw-doctor',
  { method: 'POST', body: JSON.stringify({ mode }) },
);
```

**禁止**：

- ❌ 业务代码裸 `fetch` / `axios` / `XMLHttpRequest`（规则禁止；其中部分模式由 ESLint 拦截）
- ❌ 业务代码 `fetch('http://127.0.0.1:*' / 'localhost:*')`（**ESLint error**）
- ❌ 业务代码 `window.electron.ipcRenderer.invoke()` 直接调（**ESLint error**）

### 写接口调用前的强制流程

1. 先查现有 API client、共享类型和相似调用，确认项目当前实现。
2. 再读 `docs/api-contracts/`、相关 OpenSpec 和后端提供的 Swagger / OpenAPI 文档。
3. 新功能按 `00-workflow-and-risk.mdc` 判断 Tier；涉及新能力或接口时先完成 OpenSpec 与技术确认。
4. 仍然没有真实契约时停止实现，明确列出缺少的 URL、method、字段、错误结构和状态。
5. **绝不**编一个看起来合理的接口签名。

### 命名约定

- 业务字段默认沿用真实接口契约；不得为了“统一”擅自做 snake_case ↔ camelCase 转换。
- ID 类型优先复用项目已有共享类型；长 ID 使用 string，禁止用 `string | number` 掩盖契约不确定性。
- 超过 2^53-1 的 ID 必须 string

### 数据格式标准

- 分页字段以具体接口契约为准；当前 workflow 契约常用 `page` / `pageSize`，不得从其他接口套用字段。
- 时间格式和类型以真实契约与现有共享类型为准；当前项目没有全局 `ISOTimestamp` branded type，不得为满足规则临时虚构
- 枚举优先复用契约或现有共享 union / enum；契约未确认时不得自行补字符串字面量
- `null` / `undefined` 按真实接口和现有类型处理，不擅自统一，也不用 `!value` 混淆 `0`、空字符串与缺失值
- 金额单位以真实契约为准；契约约定整数分时禁止自行转换成浮点元

### 错误响应格式

项目当前没有单一、全局统一的 `ApiError` 响应结构：Host routes 常见 `{ success, error? }`，STO workflow client 常见 `{ success, data, traceId, errCode?, errMessage? }`，Gateway / IPC 还有各自 envelope。实现时必须复用对应领域现有 client 和类型，不得把某一种结构套到全部接口。

### AppError 错误模型（`src/lib/error-model.ts`）

```ts
export type AppErrorCode =
  | 'AUTH_INVALID' | 'TIMEOUT' | 'RATE_LIMIT' | 'PERMISSION'
  | 'CHANNEL_UNAVAILABLE' | 'NETWORK' | 'CONFIG' | 'GATEWAY' | 'UNKNOWN';

export class AppError extends Error {
  code: AppErrorCode;
  cause?: unknown;
  details?: Record<string, unknown>;
}
```

业务用法：

```tsx
try {
  await invokeApi(...);
} catch (err) {
  if (err instanceof AppError) {
    switch (err.code) {
      case 'AUTH_INVALID': /* 引导重登 */ break;
      case 'RATE_LIMIT':   /* 限流提示 */ break;
      default:             toast.error(toUserMessage(err));
    }
    return;
  }
  throw err;
}
```

- Renderer 业务层新增用户可见错误时统一使用 `AppError + code`；`api-client` 等基础设施内部已有专用 Error 不要求迁移
- 展示给用户用 `toUserMessage(err)`
- 中间层包错误用 `normalizeAppError(err, details)` 保留 cause

---

## 接口文档驱动开发（**和后端工程师直接对话的关键**）

设计师 / AI 写代码时，**必须优先用项目里的真实接口文档**，**禁止**凭直觉编 URL / 字段名 / method。这是和后端工程师对话的核心机制：

```
后端写接口文档 → 放进 docs/api-contracts/ → AI 严格按文档写代码 → 代码可直接联调
```

### 接口文档存放位置（**当前事实 + 目录约定**）

```
docs/api-contracts/
└── workflows/
    ├── page.md
    └── template-mine.md
```

当前仓库只维护了以上 workflow 契约。新增契约按业务域建目录、每个接口一个 `.md` 文件；不得把尚不存在的 tasks / chat / settings 契约当成项目事实。

### 写接口调用前的强制流程（**升级版**）

AI 在生成任何 API 调用代码之前，**必须**按以下顺序：

1. **先看 `docs/api-contracts/<feature>/`** 看有没有这个接口的文档
2. 有文档 → **严格按文档**写代码（字段名、类型、URL、method、错误码完全一致）
3. 没有接口文档时，搜索项目现有 API client、共享类型和相似调用，只用于确认当前事实，不据此发明新契约
4. 再读取相关 OpenSpec、Swagger / OpenAPI 或后端确认材料
5. 都没有 → **停下来问用户**，提示："这个接口还没有真实契约，需要先和后端对齐"
6. **绝不**编一个看起来合理的接口签名

### 优先级

```
已确认接口文档 / OpenSpec / 后端契约 > 项目现有 API client 与共享类型 > 未确认口述
```

为什么 `docs/api-contracts/` 优先级最高：

- 文档和 OpenSpec 记录字段以外的业务说明、权限、状态与错误语义
- 现有实现可能落后于新需求，只能作为事实参考，不能代替契约确认
- 口述内容必须经过前后端确认后才能成为开发依据

### 接口文档使用规则

- AI 写接口调用时，**注释里引用文档路径**：

  ```ts
  // @api docs/api-contracts/workflows/page.md
  const result = await listWorkflowTemplates(params);
  ```

- 字段名 / 类型 / 错误码**必须**和文档对得上；如果发现实际接口和文档不符，**停下来通知用户**，由设计师 / 后端协商更新文档

### 反向：设计师驱动后端文档

设计师可以**反过来**让 AI 生成接口文档草稿，发给后端 review：

1. 设计师 → AI：「我设计了一个『新建任务』页面，按 `docs/api-contracts/` 的模板生成接口文档草稿」
2. AI 根据页面交互产出**候选接口文档**（含建议字段、类型、错误场景）
3. 设计师把草稿发给后端 → 后端调整 → 回传最终文档
4. 设计师 / AI 按最终文档写代码

### 类型同步（可选，提升联调精度）

当前项目没有 `src/api/contracts-generated/` 或统一的契约代码生成链路。优先复用现有领域 client、`shared/` 和 `src/types/` 中的真实类型；如要引入生成目录或同步工具，必须先按 Tier 2/3 评审放置位置和维护方式，不得根据规则示例直接创建。

---

## STO 后端 API 常见约定（**具体接口契约优先**）

以下内容是 workflow / template / run 等现有接口中出现的常见模式，只用于帮助阅读旧代码。AI 每次仍须读取对应接口文档，不得把这些模式自动套到其他服务。

真实契约位于 `docs/api-contracts/`、OpenSpec 和现有共享类型。三者不一致时停止实现并交由前后端确认。

### 摘要（10 条核心）

#### 1. 常见响应外层 `{success, data, traceId}`

```json
// 成功
{ "success": true, "data": {...}, "traceId": "..." }
// 失败
{ "success": false, "errCode": "401", "errMessage": "...", "data": null, "traceId": "..." }
```

业务代码不得重复手写响应拆包。优先复用对应领域的现有 API client；若没有统一封装，先在 Plan 中提出，不得假设项目存在 `callStoApi` 等未实现函数。

#### 2. 请求头三件套

由 client 自动加（业务代码**禁止**手动塞）：

- `stoToken`（必，鉴权）
- `X-Trace-Id`（建议，链路追踪）
- `X-Source-Client: sto-claw`（建议，幂等隔离）

#### 3. 幂等键 `idempotencyKey`

- 字段名**固定** `idempotencyKey`（不要 `requestId`/`dedupKey`）
- 创建类**建议传**；启动类（如 `POST /workflows/{id}/start`）**必须传**
- 用 `crypto.randomUUID()` 或业务上下文相关 key

#### 4. `schemaHash` 必须透传

任何 schema 驱动的接口（如启动参数 schema）：

- 客户端**透传**服务端返回的 `schemaHash`
- **禁止**自生成 / 修改 / 拼接
- 失效（409）→ 自动重拉 schema + 提示用户重填

#### 5. 业务 ID

- ID 的格式、前缀和类型以对应契约与项目现有类型为准。
- 长 ID 使用 string，禁止转为 number。
- 项目已经存在 branded type 时必须复用；不存在时不得为了满足规则虚构 `src/types/ids.ts`。

#### 6. 时间戳 ISO 8601 带时区

```
2026-06-07T14:36:34+08:00
```

展示前优先复用当前领域已有格式化工具；没有通用工具时可使用 `Intl.DateTimeFormat` 或经过有效性检查的 `Date`。项目当前不存在全局 `formatDate`，不得假设其存在。

#### 7. HTTP 状态码统一语义

| HTTP | 客户端处理 |
| --- | --- |
| 401 | 跳重登流程（清 token + 刷 SSO） |
| 403 | inline 报错 / 跳无权页（不要 toast） |
| 404 | inline 报错"资源不存在或已删除" |
| 409 | schemaHash 失效 → 重拉 schema；幂等冲突 → 提示重复操作 |
| 422 | **表单字段回填错误**（如果有 `details.field`） |
| 500 | 按页面层级展示现有 `FeedbackState` / feature 内错误态，并走项目现有错误上报能力 |

#### 8. workflow 类接口常用 1-based 分页

```json
{ "page": 1, "pageSize": 10 }
```

- `page` **1-based**（不是 0-based）
- 已确认的 workflow 契约使用 `page` / `pageSize` 和 `data` / `total`。
- 其他服务可能使用不同分页模型，必须按对应契约实现，禁止自行统一。

#### 9. Schema 驱动表单的 `component` 渲染

| `component` 值 | 渲染（sto-claw 用 shadcn）| 提交值 |
| --- | --- | --- |
| `single_select` | `<RadioGroup>` / `<Select>` | `string` |
| `multi_select` | `<Checkbox>` 组 / `<MultiSelect>` | `string[]` |
| `editable_list` | 可增删项文本列表 | `string[]` |
| 未知 component | **停下来问**，禁止猜 | — |

提交时**用 `fields[*].key`**，不是 `label`。`sourceNodes` 不要回传服务端。

#### 10. 异步任务三连 + SSE

```
POST .../start  →  返 { runId, queryUrl, streamUrl }
GET  /runs/{runId}        →  轮询
GET  /runs/{runId}/stream →  SSE 订阅
```

- 优先用 SSE，不支持时**降级轮询**（间隔 2-5s）
- 任务终态（`succeeded` / `failed` / `cancelled`）→ **主动关闭**连接
- 用响应里的 `queryUrl` / `streamUrl`，**禁止**自己拼接路径
- SSE 接口**无** `{success, data, traceId}` 外层；`traceId` 走响应头

### 实现要求（架构级）

- 先搜索当前领域已有 API 文件、类型和调用示例，沿用相同入口。
- Renderer 的最终入口仍然是 `src/lib/host-api.ts` 或 `src/lib/api-client.ts`。
- 需要新增领域 client 时，先说明放置位置、复用关系和错误模型，再由人确认。
- 不得因为规则中的示例而创建项目中不存在的 `sto-api.ts`、ID 类型或请求工具。

### AI 自检（STO API 部分）

- [ ] 响应复用项目现有领域 client，没有重复手写请求和错误拆包
- [ ] 创建 / 启动类传了 `idempotencyKey`
- [ ] schemaHash 透传，没自生成
- [ ] 业务 ID 与真实契约和项目已有类型一致
- [ ] 时间字段是 ISO 8601 带时区
- [ ] 错误码处理符合 7 条语义对照
- [ ] 分页用 1-based `page` / `pageSize`
- [ ] Schema 表单按 `component` 渲染，未知 component 停下问
- [ ] 提交字段名用 `fields[*].key`
- [ ] SSE 处理了终态自动关闭 + 支持降级轮询

完整字段和响应结构以 `docs/api-contracts/`、OpenSpec 和当前实现为准。

---

## Mock / 静态 / 占位数据的**强制标注**（前端 review 最看重的）

AI 写代码（特别是设计稿转代码）容易写死示例数据，前端无法快速识别"哪些要接 API"。

### 强制规则

**任何「从设计稿描摹来的样例」或「等接口好了要换掉」的数据，必须用以下方式之一显式标注**：

**方式 1：`@mock` 注释（推荐）**

```tsx
// @mock: 静态示例数据，待接入 GET /api/workflow/examples
const WORKFLOW_EXAMPLE_PROMPTS = [
  '帮我总结今天的待办',
  '分析上周销售数据',
];
```

**方式 2：`MOCK_` / `PLACEHOLDER_` 变量名前缀**

```tsx
const MOCK_WORKFLOW_EXAMPLES = [...];
const PLACEHOLDER_USER = {...};
```

**方式 3：集中 `*.mock.ts` 文件**

```tsx
// src/pages/Home/Home.mock.ts
export const MOCK_HOME_CARDS = [...];
```

### 标注必须说明「等接什么」

```tsx
// ❌ 不够
// @mock
const FOO = [...];

// ✅ 合格
// @mock: 待接入 GET /api/workflow/examples，等接口 review 后替换
const WORKFLOW_EXAMPLE_PROMPTS = [...];
```

前端一行命令找出所有待接位置：

```bash
grep -rn "@mock\|MOCK_\|\.mock\.ts" src/
```

### 例外（不需要标注）

- 枚举常量（从后端导出 / shared schema）
- i18n key 字面量
- 业务常量（pageSize、超时时长、tab 名）
- 路由路径、URL 模板
- CSS class 字符串
- 测试 fixture

判断标准：**「未来会被接口数据替代吗？」** 会 → mock；不会 → 静态。

---

## 状态：Loading / Empty / Error 三态

任何依赖异步数据的展示组件**必须**同时实现三态：

```tsx
function UserList() {
  const { data, isLoading, error, refetch } = useUsers();
  if (isLoading) return <FeedbackState state="loading" title={loadingLabel} />;
  if (error) return (
    <FeedbackState
      state="error"
      title={toUserMessage(error)}
      action={<Button onClick={refetch}>{retryLabel}</Button>}
    />
  );
  if (!data || data.length === 0) {
    return <FeedbackState state="empty" title={emptyLabel} />;
  }
  return <ul>{data.map(u => <li key={u.id}>{u.name}</li>)}</ul>;
}
```

项目当前提供 `src/components/common/FeedbackState.tsx` 和 `LoadingSpinner.tsx`。通用三态优先复用它们；已有 feature 专属 Skeleton / 空态 / 错误态时沿用现有实现。不要为了满足规则创建不存在的 `src/components/states/`。

### 错误分类（client 内部统一）

| 类型 | 判断 | UI |
| --- | --- | --- |
| 网络错误 | 请求未完成（断网/超时/CORS） | toast「网络异常，请重试」+ 内联重试 |
| 业务错误 | 对应领域错误响应或 `AppError.code` | 内联消息；契约提供字段错误时回填表单 |
| 系统错误 | 5xx / `AppError` 系统类 code | 页面或区块级 `FeedbackState` + 监控上报 |

业务代码**只关心业务错误**，网络 / 系统错误透给上层：

```tsx
try {
  await save(values);
} catch (e) {
  const appError = normalizeAppError(e);
  if (appError.code === 'CONFIG') {
    setInlineError(toUserMessage(appError));
    return;
  }
  throw appError;
}
```

**禁止**：

- ❌ 裸 try/catch 后吃掉错误
- ❌ 操作级 loading 做成全屏遮罩（按钮 disabled + 内嵌 spinner）
- ❌ 区块级错误用 toast（用 inline）

### 两条 loading 路径

```tsx
// 路径 1：首次加载 → 居中 spinner
const showLoadingPlaceholder = useMemo(
  () => loading && messages.length === 0, [loading, messages.length]
);

// 路径 2：后台刷新 → 透明覆盖（useMinLoading 防闪烁）
const minLoading = useMinLoading(loading && messages.length > 0);
```

**禁止**在 sending 中显示覆盖层（会和流式光标重叠）。

---

## 状态管理：Zustand

### 单字段 selector + 回调用 getState()

```tsx
// ✅ render 时取响应式值
const messages = useChatStore((s) => s.messages);
const sending = useChatStore((s) => s.sending);

// ✅ 回调里取当前值
const handleSend = useCallback(() => {
  const { currentSessionKey } = useChatStore.getState();
  useMessageQueueStore.getState().enqueue(currentSessionKey, text);
}, []);

// ❌ 禁止：订阅范围过大
const { messages, sending, error } = useChatStore();
```

**例外**：**页面级 owner 组件**（路由级页面、唯一消费 store 的 panel）允许解构，因为它本来就会随 store 重渲染（如 Settings 页消费整个 settingsStore）。

### 已知 stores

`useChatStore` / `useAuthStore` / `useAgentsStore` / `useGatewayStore` / `useMessageQueueStore` / `useStoTaskSubitemsStore` / `useSkillsStore` / `useSettingsStore`（团队按需补全）。

### 大型 store 切片模式（**> 10 actions 或 > 200 行必须拆**）

```
src/stores/chat/
├── types.ts                       ChatState 接口（state + actions 签名）+ 常量
├── store-api.ts                   ChatSet / ChatGet + 各组 Pick 类型
├── helpers.ts                     公开工具 + initialChatState + createChatActions
├── internal.ts                    私有 + 模块级可变状态（timers / caches）
├── session-actions.ts             会话操作切片
├── runtime-actions.ts             runtime 总入口
├── runtime-send-actions.ts        发消息 + 中断
├── runtime-event-actions.ts
├── runtime-event-handlers.ts
└── ...
```

每个 `*-actions.ts` 导出 `createXxxActions(set, get)` **工厂**，返回 `Pick<ChatState, ...>`。

`helpers.ts` 通过 spread 组合：

```ts
export function createChatActions(set: ChatSet, get: ChatGet) {
  return {
    ...createSessionHistoryActions(set, get),
    ...createRuntimeActions(set, get),
  };
}
```

### 模块级可变状态（`internal.ts`）

```ts
// 不需要触发 UI 重渲染的状态（timers、caches）
let _lastChatEventAt = 0;
let _historyPollTimer: ReturnType<typeof setTimeout> | null = null;
const _imageCache = loadImageCache();

// 用下划线前缀；只 export get/set 函数，不 export 变量
export { setLastChatEventAt, getLastChatEventAt, /* ... */ };
```

### Persist + 缓存

需要跨会话保留用 `persist` middleware；**禁止**持久化敏感数据。

性能缓存（如图片预览）允许 localStorage，**但必须有 eviction 上限**：

```ts
const IMAGE_CACHE_MAX = 100;
function saveImageCache(cache: Map<string, AttachedFileMeta>): void {
  try {
    const entries = Array.from(cache.entries());
    const trimmed = entries.length > IMAGE_CACHE_MAX
      ? entries.slice(entries.length - IMAGE_CACHE_MAX) : entries;
    localStorage.setItem('stoclaw:image-cache', JSON.stringify(trimmed));
  } catch { /* ignore quota */ }
}
```

---

## 自定义 Hooks

- 新增文件默认使用 **`use-kebab-case.ts`**；保留现有 `useDingTalkMention.ts`，不为统一命名单独重命名稳定文件
- 文件内导出仍用 React 标准 `useCamelCase` 命名
- 跨页面 / 跨 feature 复用的 hook 放 `src/hooks/`
- 页面或 feature 私有 hook 可就近放在 `src/pages/<feature>/`、`src/pages/<feature>/hooks/` 或 `src/components/<feature>/`，与当前项目结构一致

### 现有 hooks（**必须复用，禁止手撸**）

- `useStickToBottomInstant` — 对话窗口贴底、会话切换和用户滚动跟随
- `useMinLoading` — 防 loading 闪烁的最小展示时长

**对话窗口滚动跟随场景优先用 `useStickToBottomInstant`**，不要在对话页面重复实现 `useEffect + scrollTo`。列表定位、画布复位等非对话滚动可按场景使用 `scrollTo` / `scrollIntoView`。

**Loading 防闪烁场景必须用 `useMinLoading`**。

### Hook 输出命名对象（非 tuple）

```ts
// ✅ 项目惯例
return { handleHubSend, handleHubQueue };

// ❌ 禁止（除非模仿 React 内建 hook）
return [handleHubSend, handleHubQueue];
```

---

## React 19 特性（按项目模式使用）

### `useActionState` + form Action（条件使用）

项目默认表单模式仍是后文的 `useState draft + 显式 save handler`。只有现有模块已经采用 Action，且该写法不会破坏项目 API、错误回填和状态模式时，才继续使用 `useActionState`。不得复制规则示例来虚构 API client。

### `useTransition` / `useOptimistic`

- 非紧急更新出现可感知阻塞时，可评估 `startTransition`。
- 只有产品交互明确需要乐观反馈、失败回滚路径清楚且现有数据流支持时，才使用 `useOptimistic`。

### `ref` 作为 prop（业务组件可用，现有原件不强制迁移）

```tsx
// ✅ React 19 新写法
function Input({ ref, ...props }: InputProps & { ref?: Ref<HTMLInputElement> }) {
  return <input ref={ref} {...props} />;
}
```

现有 shadcn / Radix 原件保留其当前 `forwardRef` 签名；不要为了迁移 ref 写法单独改动稳定组件。

**`use(promise)` 主要给服务端组件，渲染进程不要乱用**。

---

## React 性能规则：先写清楚，再按证据优化

> 当前项目使用 React 19，但没有证据表明构建配置已启用 React Compiler。
> AI 不默认添加或删除 `useCallback`、`useMemo`、`React.memo`；是否使用由引用语义、现有模式和性能测量决定。

### 核心原则

| 项 | 默认做法 | 需要优化时 |
| --- | --- | --- |
| 子组件 props 稳定性 | 先写朴素回调 | 子组件确实依赖稳定引用时使用 `useCallback` |
| 计算密集的派生值 | 先直接计算 | profiling 证明昂贵时使用 `useMemo` |
| 防止重渲染 | 先隔离状态和组件职责 | 高频列表确认存在回归时使用 `React.memo` |
| 写法 | 保持依赖和数据流清晰 | 优化代码必须说明原因并验证效果 |

### ❌ 反例（无证据的全面 memo 化）

```tsx
// ❌ 不要这样写
function TaskList({ tasks, onSelect }) {
  // ❌ 未证明计算昂贵就使用 useMemo
  const sortedTasks = useMemo(
    () => [...tasks].sort((a, b) => a.priority - b.priority),
    [tasks]
  );

  // ❌ 子组件没有稳定引用要求却使用 useCallback
  const handleClick = useCallback((id) => {
    onSelect(id);
  }, [onSelect]);

  // ❌ 未检查重渲染来源就使用 React.memo
  const MemoizedItem = React.memo(TaskItem);

  return (
    <ul>
      {sortedTasks.map(t => <MemoizedItem key={t.id} task={t} onClick={handleClick} />)}
    </ul>
  );
}
```

### ✅ 正例（默认写清晰、可测的代码）

```tsx
// ✅ 默认直接写，发现真实性能问题后再优化
function TaskList({ tasks, onSelect }: TaskListProps) {
  // 数据量有限，直接计算更清晰
  const sortedTasks = [...tasks].sort((a, b) => a.priority - b.priority);

  // 子组件没有稳定引用契约，直接定义函数
  const handleClick = (id: TaskId) => {
    onSelect(id);
  };

  return (
    <ul>
      {sortedTasks.map(t => <TaskItem key={t.id} task={t} onClick={handleClick} />)}
    </ul>
  );
}

// 没有测量到列表重渲染问题，不预先添加 React.memo
function TaskItem({ task, onClick }: TaskItemProps) {
  return <li onClick={() => onClick(task.id)}>{task.title}</li>;
}
```

### ⚠️ 可以使用 memo 化的场景

以下场景可以使用，但需要满足真实语义或验证条件：

#### 1. 配合 React 内置 hook 的依赖（语义需要）

```tsx
// ✅ useEffect 订阅需要同一个回调引用才能正确解除
useEffect(() => {
  const subscription = subscribe(handleEvent);
  return () => subscription.unsubscribe();
}, [handleEvent]);
```

> 这里使用 `useCallback` 是为了订阅与解除订阅的引用语义，不是泛化的性能规则。

#### 2. 跨非 React 边界的回调（IPC / 浏览器 API）

```tsx
// ✅ Electron IPC 监听 - 跨边界，需要稳定引用便于取消
const handleIPCMessage = useCallback((event, data) => {
  /* ... */
}, [/* deps */]);

useEffect(() => {
  window.electron.ipcRenderer.on('xxx', handleIPCMessage);
  return () => window.electron.ipcRenderer.off('xxx', handleIPCMessage);
}, [handleIPCMessage]);
```

#### 3. 极端昂贵的计算（**实测验证后**）

```tsx
// ✅ 仅在 profiling 证明慢 + 输入很少变化时
const heavyResult = useMemo(() => {
  return computeMillionRowMatrix(rawData);
}, [rawData]);
```

> **必须**：有 profiling 或可复现的性能证据，并注释说明优化原因。

#### 4. 上下文 / Store 派生的稳定引用

```tsx
// ✅ Zustand selector 稳定引用，避免每次 re-subscribe
const selectActiveItems = useCallback(
  (state: AppState) => state.items.filter(i => i.active),
  []
);
const items = useStore(selectActiveItems);
```

### 🚨 禁止行为

- ❌ 写新代码默认用 `useCallback` / `useMemo` 包所有函数和值
- ❌ "为了性能" 而不是为了语义包装 hook
- ❌ 复制代码后不检查原有 memo 的语义和必要性
- ❌ 没有测量就批量添加或批量删除 `React.memo`
- ❌ 在不确定时认为“包了也无害”；多余 memo 会增加依赖和维护成本

### 🎯 判定流程（AI 写代码时）

```
我现在要不要用 useCallback / useMemo / React.memo？
   │
   ▼
┌────────────────────────────────────────┐
│ 是 useEffect / 自定义 hook 的依赖？     │
│ 是跨非 React 边界（IPC / addEventListener）│
│ 是 Zustand / 第三方 store 的 selector？  │
│ 是已 profile 证实的极端昂贵计算？        │
└──────────────┬─────────────────────────┘
               │
       全是「否」 → 不用包，写朴素代码
               │
       至少一个「是」 → 用，并在注释里说明 why
```

### ✅ AI 自检（性能优化）

- [ ] 没有为"图省事" 而用 useCallback / useMemo 包所有东西
- [ ] 没有无证据地批量添加或删除 React.memo
- [ ] useCallback / useMemo / React.memo 都有明确语义或性能证据
- [ ] 非显然的优化加了简短 why 注释

### 团队迁移建议

- **新代码**：直接按朴素风格写
- **老代码**：不强制全清，但 review 时遇到不必要的 useCallback / useMemo 可以建议删除
- **不要**为了"删 useCallback" 而专门提 PR —— 不值得

---

## 表单：`useState draft + 显式 save handler` 模式（**不是 Actions 也不是 react-hook-form**）

实际项目用的是 draft pattern：

```tsx
// 1. 从 store 取真值
const { proxyEnabled, proxyServer, setProxyEnabled, setProxyServer } = useSettingsStore();

// 2. 本地 draft state
const [proxyEnabledDraft, setProxyEnabledDraft] = useState(false);
const [proxyServerDraft, setProxyServerDraft] = useState('');
const [savingProxy, setSavingProxy] = useState(false);

// 3. useEffect 同步 store → draft
useEffect(() => { setProxyEnabledDraft(proxyEnabled); }, [proxyEnabled]);
useEffect(() => { setProxyServerDraft(proxyServer); }, [proxyServer]);

// 4. Save handler
const handleSaveProxySettings = async () => {
  setSavingProxy(true);
  try {
    const normalized = proxyServerDraft.trim();
    await invokeIpc('settings:setMany', {
      proxyEnabled: proxyEnabledDraft,
      proxyServer: normalized,
    });
    setProxyServer(normalized);
    setProxyEnabled(proxyEnabledDraft);
    toast.success(t('gateway.proxySaved'));
    trackUiEvent('settings.proxy_saved', { enabled: proxyEnabledDraft });
  } catch (error) {
    toast.error(`${t('gateway.proxySaveFailed')}: ${toUserMessage(error)}`);
  } finally {
    setSavingProxy(false);
  }
};

// 5. JSX
<Input value={proxyServerDraft} onChange={(e) => setProxyServerDraft(e.target.value)} />
<Button onClick={handleSaveProxySettings} disabled={savingProxy}>
  {savingProxy ? t('common:status.saving') : t('common:actions.save')}
</Button>
```

### 规则

- 表单字段值用本地 `useState` draft，**不直接绑 store**
- `useEffect` 同步 store → draft
- 提交前归一化（`trim()` 等）
- 提交流程严格 `try / catch / finally`
- 按钮 `disabled={saving}` + 文案 `saving ? '保存中' : '保存'` 切换
- **简单切换开关（Switch）不需要 draft**，直接绑 store setter

```tsx
<Switch checked={launchAtStartup} onCheckedChange={setLaunchAtStartup} />
```

**禁止**：

- ❌ 引入 `react-hook-form`（团队未采纳）
- ❌ 引入 `formik`
- ❌ 字段直接绑 store（每次按键触发整页重渲染）

---

## 组件层：shadcn/ui + 业务组件

### shadcn 原件（`src/components/ui/`）

- 现有 shadcn 原件**禁止**重新实现
- 需要新增 shadcn 原件时，先确认项目是否已有同等组件；CLI 和依赖操作由工程负责人手动执行，AI 不运行 `pnpm dlx`
- 按需定制：直接编辑 `src/components/ui/<name>.tsx`
- 保留 `cva` (`class-variance-authority`) variant 模式 + `forwardRef` + `displayName`
- 浮层组件（Dropdown / Popover / Tooltip）**必须**用 Radix Portal
- 状态动画用 `data-[state=...]:animate-*`（tailwindcss-animate），**不**用 Framer Motion

### shadcn 标准签名

```tsx
const buttonVariants = cva(
  'inline-flex items-center justify-center rounded-md ...',
  {
    variants: {
      variant: { default: '...', destructive: '...', outline: '...', secondary: '...', ghost: '...', link: '...' },
      size: { default: 'h-10 px-4 py-2', sm: '...', lg: '...', icon: 'h-10 w-10' },
    },
    defaultVariants: { variant: 'default', size: 'default' },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button';
    return <Comp className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />;
  },
);
Button.displayName = 'Button';
export { Button, buttonVariants };  // ← 两个都导出
```

### 业务组件（`src/components/`）

按 **feature/domain** 分子目录：`channels/` / `common/` / `file-preview/` / `layout/` / `settings/` / `ui/`。

业务组件**必须**基于 shadcn 原件组合，**禁止**绕开原件写底层 HTML。

新建业务组件前**必须**先翻 `src/components/` 避免重复。

### 🔥 重复结构 → 抽组件（**核心规则**）

**触发抽组件的硬条件**（满足任一即抽）：

1. **同一文件内出现 ≥ 2 次结构相同/类似的 JSX 块**（即使内容不同）
2. **JSX 嵌套深度 ≥ 4 层** 且块本身有独立语义
3. **同一行 className 长度 > 80 字符** 且会在多处复用
4. **某个 JSX 块超过 30 行**，可独立命名

**抽出来的组件必须做到**：

- **结构固定**：HTML/标签/className 写死
- **内容用 props 注入**：所有会变的文案 / 数据 / 状态全部走 props
- **语义命名**：`<TaskCard>` 不是 `<Card1>`；`<SkillTile>` 不是 `<Item>`
- **放对位置**：纯展示 + 跨页面用 → `src/components/common/`；某 feature 专用 → `src/components/<feature>/`
- **顶部写注释**说明组件用途 + 使用场景

#### 反例 → 正例

```tsx
// ❌ 反例：首页 3 个指标卡，结构相同，内容不同，全部硬编码堆在 home/index.tsx
function Home() {
  return (
    <div className="grid grid-cols-3 gap-4">
      <div className="rounded-2xl bg-white p-6 shadow-elevated">
        <div className="flex items-center gap-2">
          <FileText className="h-6 w-6 text-primary" />
          <span className="text-base font-semibold">周会材料</span>
        </div>
        <p className="mt-[14px] text-sm text-muted-foreground">本周待整理 12 份</p>
        <Button className="mt-4">查看</Button>
      </div>
      <div className="rounded-2xl bg-white p-6 shadow-elevated">
        <div className="flex items-center gap-2">
          <AlertCircle className="h-6 w-6 text-primary" />
          <span className="text-base font-semibold">客户异常</span>
        </div>
        <p className="mt-[14px] text-sm text-muted-foreground">未处理 3 条</p>
        <Button className="mt-4">查看</Button>
      </div>
      {/* 又一份几乎一样的 JSX… */}
    </div>
  );
}

// ✅ 正例：抽成 <SignalCard>，结构写死，数据走 props
//   src/components/home/signal-card.tsx
/**
 * SignalCard - 首页 3 大指标卡通用组件
 *
 * 用途：展示一个业务领域（周会材料 / 客户异常 / 总部结算）的
 *      统计 + CTA，固定圆角 16 / 阴影 elevated / 24 内距风格。
 *
 * 使用位置：仅首页 src/pages/home/index.tsx
 */
export interface SignalCardProps {
  /** 卡片图标（Lucide 组件，h-6 w-6 内自渲染） */
  icon: LucideIcon;
  /** 卡片标题（如"周会材料"） */
  title: string;
  /** 副文案描述（如"本周待整理 12 份"） */
  description: string;
  /** CTA 按钮文字 */
  actionLabel: string;
  /** 点击 CTA 触发的回调 */
  onAction: () => void;
  /** 可选样式覆盖（透传给根元素） */
  className?: string;
}

export function SignalCard({
  icon: Icon,
  title,
  description,
  actionLabel,
  onAction,
  className,
}: SignalCardProps) {
  return (
    <div className={cn('rounded-2xl bg-white p-6 shadow-elevated', className)}>
      <div className="flex items-center gap-2">
        <Icon className="h-6 w-6 text-primary" aria-hidden />
        <span className="text-base font-semibold">{title}</span>
      </div>
      <p className="mt-[14px] text-sm text-muted-foreground">{description}</p>
      <Button className="mt-4" onClick={onAction}>
        {actionLabel}
      </Button>
    </div>
  );
}

// 使用方：home/index.tsx
<div className="grid grid-cols-3 gap-4">
  <SignalCard icon={FileText}   title={t('home.weekly')}  description={...} actionLabel={t('common.view')} onAction={...} />
  <SignalCard icon={AlertCircle} title={t('home.alerts')}  description={...} actionLabel={t('common.view')} onAction={...} />
  <SignalCard icon={Wallet}      title={t('home.settle')}  description={...} actionLabel={t('common.view')} onAction={...} />
</div>
```

#### Cursor 转译 HTML → 代码时的判定流程

设计师交付的 HTML 里出现重复结构时，AI **必须**：

1. **先识别**：扫描 HTML，找结构相同/类似的块（如多个卡片、多行 list item、多个 tab）
2. **再抽组件**：按上面的硬条件判断，满足就抽
3. **预留接口**：结构相同的部分写死，**所有会变的内容（文案 / 图标 / 颜色 / 行为）一律用 props 注入**
4. **写明注释**：组件顶部 TSDoc 说明用途 + 使用位置；每个 prop 写一行注释说明业务含义
5. **正确放置**：单页面用的 → `src/pages/<页面>/<组件名>.tsx`；跨页面用的 → `src/components/<feature>/<组件名>.tsx`

#### 不要过度抽

- ❌ **不要**为只用一次的结构强行抽组件（会增加跳转成本）
- ❌ **不要**抽出 props 超过 10 个的"上帝组件"（说明该拆成 2-3 个小组件）
- ❌ **不要**为节省 5 行 JSX 抽组件（成本 > 收益）

### 🔥 Props 设计：语义命名 + 类型清晰 + 注释完整（**核心规则**）

#### 命名

- ✅ **业务语义**：`title` / `description` / `status` / `onConfirm` / `isLoading`
- ❌ **位置/外观**：`text1` / `text2` / `leftIcon` / `topColor`（除非组件本身就是布局型）
- 布尔 props 用 `is*` / `has*` / `can*` / `should*` 前缀
- 事件 props 用 `on*` 前缀；内部回调用 `handle*`

#### 类型定义

**必须**用 `interface` 显式声明（不要 inline `{...}` 类型）：

```tsx
// ✅ 正例
export interface TaskCardProps {
  /** 任务唯一 ID（来自后端，branded type） */
  taskId: TaskId;
  /** 任务标题（用户可见，必须走 i18n） */
  title: string;
  /** 当前状态：决定边框色 + 图标 */
  status: 'running' | 'completed' | 'error';
  /** 创建时间（ISO 8601 字符串，组件内部用 dayjs 格式化） */
  createdAt: string;
  /** 是否禁用点击 */
  isDisabled?: boolean;
  /** 点击卡片触发，传入 taskId 给上层处理 */
  onClick?: (taskId: TaskId) => void;
  /** 可选样式覆盖 */
  className?: string;
}

export function TaskCard({ taskId, title, status, ... }: TaskCardProps) { ... }
```

```tsx
// ❌ 反例：inline 类型 + 含糊命名 + 无注释
export function TaskCard({ id, t, s, d, cb }: {
  id: string;
  t: string;
  s: string;
  d?: boolean;
  cb?: (id: string) => void;
}) { ... }
```

#### 注释规范（TSDoc）

- **组件顶部**：用 `/** */` 写组件用途、使用场景、特殊约束
- **每个 prop**：用 `/** */` 写一行业务含义，必要时写格式 / 取值范围
- **复杂逻辑**：函数内部用 `//` 注释 why（不是 what）
- **mock 数据**：用 `// @mock` 标记（见后文 Mock 章节）

#### 默认值

- 可选 props 在解构时给默认值：`{ isDisabled = false, className = '' }`
- 不要在类型上给默认值，**也不要用 `defaultProps`**（React 19 已废弃）

#### 复杂场景：discriminated union

互斥的 props 用 discriminated union（按状态联合类型）：

```ts
// ✅ 不同 status 决定哪些 props 必填
type ToolCallCardProps =
  | {
      status: 'running';
      toolName: string;
      startedAt: string;
      onCancel?: () => void;
    }
  | {
      status: 'completed';
      toolName: string;
      result: string;
      duration: number;
    }
  | {
      status: 'error';
      toolName: string;
      error: AppError;
      onRetry?: () => void;
    };
```

这样 TS 编译器会在你写 `status: 'running'` 时强制要求 `startedAt`，写 `status: 'error'` 时强制要求 `error`，避免业务里漏字段。

#### 通用约束（已确定）

- 几乎所有可视组件接受 `className?: string` 并 `cn()` 合并：

```tsx
<Button className={cn('shrink-0', isActive && '...', className)} />
```

- 子组件透传 `children` 时用 `React.ReactNode`，不要用 `JSX.Element`
- 透传原生事件用 `React.ButtonHTMLAttributes<HTMLButtonElement>` 等

### className 拼接：用 `cn()`

```tsx
import { cn } from '@/lib/utils';
<Button className={cn('shrink-0', isActive && 'bg-primary', className)} />
```

**禁止**裸模板字符串拼接：

```tsx
// ❌
<Button className={`shrink-0 ${isActive ? 'bg-primary' : ''} ${className}`} />
```

### 类名抽离

重复 className **必须**抽：

- 跨文件共用 → `src/lib/surfaces.ts`（如 `glassSectionSurface`）
- 同文件重复 ≥ 2 次 → 文件级 `const` 或函数

---

## i18n（**必须**）

所有用户可见文案**必须**走 i18n，**禁止**裸字符串字面量出现在 JSX。

```tsx
// ❌
<Button>发送</Button>
toast.error('网络异常，请重试');

// ✅
const { t } = useTranslation('chat');
<Button>{t('chat.send')}</Button>
toast.error(t('common.error.network'));
```

### 多 namespace

```tsx
const { t } = useTranslation(['chat', 'common']);
<button>{t('common:actions.dismiss')}</button>
```

### 可选文案给默认值

```tsx
t(`${p}.bodyCaption`, { defaultValue: '' })
```

注释、日志、错误码内部字符串不需要 i18n。

---

## 环境变量

- 渲染进程**必须** `import.meta.env.VITE_*`，**禁止** `process.env.*`
- 标准 env：
  - `VITE_APP_ENV`：`development` / `test` / `staging` / `production`
  - `VITE_STOCLAW_*`：项目特性开关
- **禁止**把密钥 / token 写进 `.env`——走 OS Keychain（通过 Main IPC）
- 新增 env 必须更新 `.env.example` + TS 类型声明

---

## 浏览器存储（**三档**）

| 档 | 适用 | 例 |
| --- | --- | --- |
| 1 — 业务数据 source of truth | `electron-store` / OS Keychain | 会话、消息、设置真值、API key |
| 2 — UI flags / 跨路由临时态 | `localStorage` / `sessionStorage`（必须 `try/catch`）| 诊断标志 `stoclaw:api-log`、跨路由草稿 |
| 3 — 性能缓存（可重新生成）| `localStorage`（**必须**带 eviction 上限）| 图片预览缓存 `stoclaw:image-cache` |

---

## 路由与导航

```tsx
import { useNavigate } from 'react-router-dom';
import { taskDetailPath, type StoTaskId } from '@/lib/sto-tasks';

const navigate = useNavigate();
const path = taskDetailPath(taskId, entryId);
navigate(path);
navigate(path, { state: { ... } });
```

**禁止**字符串拼接：``navigate(`/tasks/${id}`)`` → 用 `taskDetailPath(id)`

路径构造函数集中 `src/lib/<domain>.ts`。

---

## Electron 容器约束

### 进程模型

```
Main (electron/) — 唯一可 fs.* / require('electron') / process.*
   │ contextBridge（preload 白名单）
   ▼
Renderer (src/) — 只通过 window.electron API 与 Main 通信
```

### IPC 通道白名单（**preload 维护，新增必须三处同步**）

新通道必须同步更新：
1. `electron/preload/index.ts` 白名单
2. Main handler（`electron/api/routes/` 或 `electron/main/ipc-handlers.ts`）
3. 渲染端 `src/lib/api-client.ts`（如需 invokeApi）

通道命名：
- `invoke` 用 `module:action`（`gateway:rpc` / `provider:list` / `settings:setMany`）
- `on` / `once` 用 `<scope>:<event>`（`gateway:status-changed`、`oauth:success`）

白名单外的通道渲染端会 throw `Invalid IPC channel`。

### ESLint 硬规则（**CI 会卡**）

```ts
// ❌ ESLint error: Use invokeIpc from @/lib/api-client instead
const status = await window.electron.ipcRenderer.invoke('gateway:status');

// ❌ ESLint error: Do not call local endpoints directly from renderer
const res = await fetch('http://127.0.0.1:18789/rpc');
const res = await fetch('http://localhost:5000/api/foo');
```

**例外**：`src/lib/api-client.ts` 自己豁免。

### `window.electron` API 完整面

```ts
window.electron = {
  ipcRenderer: {
    invoke(channel, ...args)  // 白名单内才能调
    on(channel, callback)     // 返回 unsubscribe
    once(channel, callback)   // 一次性
    off(channel, callback?)
  },
  openExternal(url)            // shell:openExternal
  platform                     // 'win32' | 'darwin' | 'linux'
  isDev
  appEnv                       // import.meta.env.VITE_APP_ENV
}
```

外链**必须** `window.electron.openExternal(url)`，**禁止** `<a target=_blank>`。

事件订阅：

```ts
useEffect(() => {
  const unsubscribe = window.electron.ipcRenderer.on(
    'openclaw:cli-installed',
    (...args: unknown[]) => { ... },
  );
  return () => { unsubscribe?.(); };
}, []);
```

### 窗口关闭行为（**业务代码必须知道**）

- 开发包：close X = 退出进程
- 打包后：close X = **隐藏到托盘**（不是退出）
- 真正退出走托盘菜单 / Cmd+Q

业务代码**禁止**：

- ❌ `beforeunload` 上报"用户离开"（隐藏托盘时会误触发）
- ❌ 卸载时清理关键 session 状态（窗口可能再显示）

### 单实例锁

- Electron `app.requestSingleInstanceLock()` + 文件锁双层
- 第二实例触发 `app.on('second-instance')` 聚焦现有窗口
- 开发用 `STOCLAW_DEV_SKIP_SINGLE_INSTANCE=1` 绕过

### 退出生命周期

```ts
app.on('before-quit', (event) => {
  setQuitting();
  event.preventDefault();

  hostEventBus?.closeAll();
  hostApiServer?.close();

  // 5s Gateway 优雅退出 → 超时强杀
  const stopPromise = gatewayManager.stop();
  const timeoutPromise = new Promise(r => setTimeout(() => r('timeout'), 5000));

  Promise.race([stopPromise, timeoutPromise]).then((result) => {
    if (result === 'timeout') gatewayManager?.forceTerminateOwnedProcessForQuit();
    app.quit();
  });
});
```

5s 超时**禁止**延长。

### Gateway 事件桥接

Main 内部 EventEmitter → `HostEventBus` 统一转 IPC event → 渲染端订阅。新事件需要：Main emit + HostEventBus 桥接 + preload `on` 白名单 + 渲染端订阅。

### Vite 构建约束

- `base: './'`（Electron `file://` 必须相对路径）
- 别名 `@` → `src`，**`@electron` → `electron`**
- Dev server 端口 5173
- 输出：renderer → `dist/`，main → `dist-electron/main/`，preload → `dist-electron/preload/`
- External 模块（不打包）：main `electron-store, electron-updater, ws, openclaw/extensions/*`；preload `electron`
- `VITE_APP_ENV` 必须手动 `define` 注入到 electron 子构建

---

## 业务专属规则（sto-claw 独有）

### Token quota guard（发送聊天前必查）

```ts
const quota = await hostApiFetch<TokenQuotaCheckResult>('/api/token-quota/check');
if (quota && quota.allowed === false) {
  setError(formatQuotaExceededMessage(quota.used_today, quota.limit));
  setSending(false);
  return;
}
// ...继续发送
```

AI 生成「发送消息」相关代码**必须**包含这层 pre-check。

### SSO + 政策白名单

- 登录后从 STO policy service 拉白名单
- policy API host 由 `VITE_APP_ENV` 决定：dev/test → `zc-test.sto.cn`，staging → `pre-zc.sto.cn`，prod → `zc.sto.cn`
- 失败 / 超时按**不**在白名单处理（**fail-closed**），**禁止** fail-open
- 不在白名单走 legacy 布局；`/tasks/*` 重定向到 `/`

### 侧边栏布局

- 默认 **省区版本样式**（provincial sidebar）
- `VITE_STOCLAW_SIDEBAR_LAYOUT=full` 切换完整导航
- AI 写侧边栏代码**两种 layout 都不能崩**

### 路由约定

- Dashboard：`/`
- 任务总览：`/tasks/:taskId`
- 任务日报：`/tasks/:taskId/YYYY-MM-DD`
- `/chat` 重定向 `/`
- 任务日报独立 OpenClaw session key：`agent:main:session-sto-*`
- 任务子项软删除（重命名 `.jsonl` → `.deleted.jsonl`）

### 软删除模式

业务"删除"大多数是**软删除**（重命名 / mark flag），**禁止**真删。

---

## 桌面 AI 工具 UI 特有模式

### 流式渲染（先隔离更新，再按测量优化）

```tsx
export function ChatMessage({ ... }) { ... }
export function AssistantTurnMessage({ ... }) { ... }
```

流式列表必须先通过稳定 key、局部状态和组件边界隔离更新。只有 profiling 证明父级更新导致明显回归时，才对具体组件使用 `memo`，并记录原因。

- 增量渲染，每 token 局部更新，**禁止**整段重渲染
- 用 `requestAnimationFrame` 节流
- 流式期间输入框 `disabled` + 显示"生成中…" + 可中断按钮
- 流式 markdown 用支持增量的解析器
- 流式期间 `aria-busy="true"`

### ReactMarkdown 自定义渲染

```tsx
<ReactMarkdown
  remarkPlugins={[remarkGfm]}
  components={{
    code({ className, children, ...props }) {
      const match = /language-(\w+)/.exec(className || '');
      const isInline = !match && !className;
      return isInline ? <code className="..." /> : <pre><code /></pre>;
    },
    a({ href, children }) {
      // preview://path → 内置预览按钮
      // http(s):// → 外链 target=_blank rel=noopener
    },
  }}
>{text}</ReactMarkdown>
```

`preview://` 是项目独有协议——`preprocessTextForPreviewLinks(text)` 把本地路径 / `file://` URL / localhost URL 统一改写。

外链**必须** `target="_blank" rel="noopener noreferrer"`。

### 代码块

- 必须 `<CodeBlock />` 统一组件，**禁止** `<pre>` + 手写高亮
- 必须支持复制（按钮 + 反馈）+ 显示语言标签 + 超长可折叠

### 长任务运行时模式

`sendMessage` 等长任务模板（**禁止简化**，是被 production bug 打磨的）：

```ts
// 1. 早 return（空消息）
// 2. 切换会话（如需）
// 3. Pre-flight check（token quota）
// 4. 乐观添加用户消息 + setSending(true) + 立即清 streaming 状态
// 5. 启动 history polling（防 RPC 阻塞期间无中间状态）
// 6. 启动 safety timeout（90s 无任何事件 = 卡死）
// 7. 真正发请求（带 idempotencyKey = crypto.randomUUID() + 长 timeout 120s）
// 8. 处理结果 / 错误 → clearHistoryPoll
```

- **Idempotency key**：`crypto.randomUUID()` 防重发
- **长 timeout**：120s 容忍高延迟网络
- **预启动 polling**：3s 后开始，每 4s 一次
- **Safety timeout**：90s 无事件 → 卡死错误提示

### 对话窗口滚动

```tsx
// ✅ 必须复用 hook，禁止业务页面内手撸
const { contentRef, scrollRef, scrollToBottom } = useStickToBottomInstant(currentSessionKey);
```

- 用户在底部时新消息自动滚到底
- 用户向上浏览时**不**强制拉回底部 → 底部出现「↓ 有新消息」按钮
- 长 markdown / 代码块出现避免视口跳动

### 命令面板

- `Cmd/Ctrl + K` 触发
- 模糊搜索匹配命令、最近文件、设置
- Esc 关闭，方向键导航，Enter 执行
- 关闭时焦点还原触发元素

---

## 错误展示（**三档**）

```tsx
// 档 1：阻断主流程 → 内联条 + clearError()
{error ? (
  <div className="shrink-0 border-t border-destructive/20 bg-destructive/10 px-4 py-2">
    <p className="flex items-center gap-2 text-sm text-destructive">
      <AlertCircle className="h-4 w-4 shrink-0" aria-hidden />
      {error}
    </p>
    <button onClick={() => clearError()}>{t('common:actions.dismiss')}</button>
  </div>
) : null}

// 档 2：可重试 / 非阻断 → sonner toast
import { toast } from 'sonner';
toast.error(t('assistant.sendFailed'));
toast.error(toUserMessage(err));

// 档 3：非关键 → 静默 catch + 注释
try { /* ... */ } catch {
  // Silent fallback — same as Chat page
}
```

---

## API 调用模式（再次强调）

```tsx
import { invokeApi, invokeIpc, invokeIpcWithRetry, toUserMessage } from '@/lib/api-client';

const data = await invokeApi<T>('module:action', payload);
const data = await invokeIpcWithRetry<T>(channel, args, retries, ['TIMEOUT', 'NETWORK']);
```

---

## 用户行为埋点

```tsx
import { trackUiEvent } from '@/lib/telemetry';
trackUiEvent('settings.proxy_saved', { enabled: proxyEnabledDraft });
trackUiEvent('chat.message_sent', { sessionKey, hasMedia });
```

- 事件名 `<scope>.<action>`（小写 + 下划线）
- payload **禁止** PII（API key、token、邮箱）
- API 请求性能 / 错误已由 api-client 自动埋

---

## 可访问性（自研 UI 必须人工保证）

### 必备

- 装饰图标 `aria-hidden`
- 按钮必须 `type` 属性（默认 `type="button"`）
- 图标按钮必须 `aria-label`
- 输入控件必须 `<label htmlFor>` 或 `aria-label`
- Modal / Drawer：`role="dialog" + aria-modal="true"` + focus trap + Esc 关闭 + 点遮罩关闭
- 颜色对比度：正文 ≥ 4.5:1，大字号 ≥ 3:1
- 不能仅用颜色传达信息（错误态除颜色还要图标 / 文字）

### sto-claw 特殊关注

- 对话消息列表 `role="log"` 或 `aria-live="polite"`
- 流式输出 `aria-busy="true"`
- 工具调用卡片标题用 `<h3>` 而非 `<div>`
- 全键盘可达：`Cmd/Ctrl + Enter` 发送、`Esc` 取消、`Cmd/Ctrl + K` 命令面板
- 快捷键**禁止**覆盖系统级（`Cmd + Q`）

### section 加标签

```tsx
<section aria-label={t('assistant.placeholder')}>...</section>

<section aria-labelledby="home-summary-heading">
  <h2 id="home-summary-heading" className="sr-only">{t('summary.heading')}</h2>
  ...
</section>
```

---

## 性能（Electron 资源约束）

- **列表 > 50 项必须虚拟化**（对话历史易超 50）
- 长消息按段懒渲染
- 大对话超阈值自动归档
- 图片懒加载 + `aspect-ratio` 占位
- 重计算放 Web Worker
- 动画走 `transform` / `opacity`，**禁止** `top` / `left` / `width` / `height`
- React.memo / useMemo / useCallback **有判断标准**地用，不无脑加

---

## 资源导入

```tsx
import logoSvg from '@/assets/logo.svg';
import avatar01 from '@/assets/avatars/avatar-01.png.png';

<img src={logoSvg} alt="" width={58} height={58} />
```

- **禁止**裸路径 `<img src="/assets/...">`（Vite 不会处理）
- 装饰图片 `alt=""`，有语义的写描述
- 显式 `width` + `height` 防布局抖动

---

## 🔥 功能模块隔离（Feature Isolation）

> **新开发一个完整功能时，所有相关代码集中在一个目录下，防止污染其他功能。**

### 核心原则

**一个完整新功能 = 一个目录**。打开这个目录能看到该功能的全部代码，**关闭这个目录该功能就消失**。

### 目录结构标准

新业务组件放 `src/components/<feature>/`，新页面放 `src/pages/<feature>/`：

```
src/components/<feature>/             ← 一个目录 = 一个完整功能
├── index.tsx                          入口组件
├── <SubComponent>.tsx                 子组件
├── hooks/useXxx.ts                    功能内部 hooks
├── types.ts                           共享类型 / interface / 常量
├── utils.ts                           功能内部工具
├── index.module.css / .scss           样式
└── api.ts / service.ts                功能独有的接口

src/pages/<feature>/                  ← 路由级页面
├── index.tsx
├── components/<Inner>.tsx             页面专属组件（不跨页面复用）
├── hooks/
├── service/
├── store/                             页面专属 Zustand 切片
└── types.ts
```

### ✅ 必须遵守

1. **新功能优先建独立目录**（不要散落到 components/ 各处）
2. **子组件 / hooks / types 默认放在功能目录内** —— 除非 ≥ 2 个已确认复用方
3. **跨功能引用走显式 import**（不要 window.* / 全局变量）
4. **功能下线时能"一删了之"**（`rm -rf` 整目录后只剩 1-2 处路由引用）

### 🚨 修改老代码时强制流程

**任何对 `src/components/common/` / `src/hooks/` / `src/lib/surfaces.ts` / `src/styles/globals.css` 的修改，必须先 grep 影响范围**：

```bash
grep -r "CommonCard" src/        # 改 common 组件前
grep -r "useDebounce" src/       # 改 hooks 前
grep -r "glassCardSurface" src/  # 改 surfaces 前
```

**AI 写代码时必须报告**：

```
我要修改 src/lib/surfaces.ts 的 glassCardSurface，但被 [N] 处引用：
- src/pages/home/SignalCard.tsx
- src/pages/tasks/TaskCard.tsx
- ...

方案 A: 修改 + 同步改所有引用
方案 B: 在 surfaces 加新别名（默认行为不变）
方案 C: 不动 surfaces，在我的功能目录里写新版本

请你决定 A / B / C。
```

### 禁止

- ❌ 不经评估就改 `common/` / `hooks/` / `lib/` / 全局样式
- ❌ 改完老代码不 grep 检查影响范围
- ❌ 为图方便把功能专属组件塞到 `common/` 污染 common
- ❌ 跨功能用 window.* / 全局变量隐式依赖

### AI 自检

- [ ] 新功能所有文件都在**一个目录**下（除已确认跨功能复用的）
- [ ] 子组件 / hooks / types / 样式都在功能目录内
- [ ] 没有为图方便往 `common/` 塞功能专属组件
- [ ] 修改 `common/` / 全局样式时先 grep 报告影响范围

---

## 注释风格（只解释非显然信息）

> 注释的核心是**解释 why（为什么这么写）**，不是 **what（代码做了什么）**。

### ✅ 必须加注释的 8 种情况

1. **复杂业务逻辑 / 非显然的业务规则**
   ```tsx
   // 业务规则：省区管理员可看所有任务；普通员工只能看自己创建+被指派的
   ```
2. **非显然的边界条件 / Workaround**
3. **临时方案 / 待优化**（用 `TODO:`）
4. **性能优化的原因**
   ```tsx
   // 用 useRef 而不是 useState：避免每次值变化触发重渲染（SSE 高频 token）
   ```
5. **与外部系统 / IPC / 第三方交互**
6. **正则 / 算法 / 数学公式**
7. **接口字段映射 / 业务概念转换**
8. **跨模块复用的公共组件、函数或 Hook 的整体契约**（需要时写 TSDoc）

### ✅ TSDoc 适用范围

TSDoc 只用于跨模块公共 API、复杂业务组件和类型本身无法表达的约束。局部组件、明显 Props 和简单函数不强制添加，避免 AI 生成大段重复注释。

```tsx
/**
 * SignalCard - 首页指标卡（指经营管理 / 任务监控 / 结算对账）
 *
 * 用途：首页 3 大主卡片通用组件，固定 rounded-2xl + shadow-elevated 风格
 * 使用位置：src/pages/home/index.tsx
 */
export interface SignalCardProps {
  /** 卡片图标（Lucide 组件，内部渲染为 h-6 w-6） */
  icon: LucideIcon;
  /** 卡片标题（用户可见，走 i18n） */
  title: string;
  /** 副文案（如 "本周待整理 12 份"） */
  description: string;
  /** CTA 按钮文字 */
  actionLabel: string;
  /** CTA 点击回调 */
  onAction: () => void;
  /** 样式覆盖（透传给根 div） */
  className?: string;
}
```

### ❌ 不需要加的 4 种情况

- 自解释的代码（`const userName = user.name; // 获取用户名` ❌ 多余）
- 明显的解构 / 赋值
- 标准模式（如 useState 不需要解释）
- TypeScript 类型已经表达的信息

### 风格

- **中文优先**
- **简短**：1-3 句说清楚 why
- `TODO:` / `FIXME:` / `HACK:` 前缀分别标"待办 / 已知 bug / workaround"
- mock 数据用 `@mock`

### AI 自检

- [ ] 公共或复杂组件的契约有必要的 TSDoc
- [ ] 只有类型无法表达的 Props 约束才补充注释
- [ ] 复杂业务逻辑有注释解释 why
- [ ] 临时方案 / workaround 用 `TODO:` / `HACK:` 标
- [ ] 没有"解释 what" 的多余注释
- [ ] 注释中文简洁

---

## 依赖白名单

**实际项目已用**：

- Tailwind 生态：`tailwindcss` 3.4 / `tailwindcss-animate` / `class-variance-authority` / `clsx` / `tailwind-merge` / `autoprefixer` / `postcss`
- shadcn/ui：通过 CLI，底层 `@radix-ui/react-*`
- Zustand 5.x
- Framer Motion
- Lucide React
- react-router-dom 7
- react-i18next + i18next
- react-markdown + remark-gfm
- sonner（toast）
- use-stick-to-bottom
- electron-store + electron-updater
- posthog-node（埋点）
- ws + clawhub

**禁止**：

- 任何 UI 组件库（Ant Design / Arco / MUI / Chakra / Mantine 等）
- 其他图标库（统一 Lucide）
- 其他状态管理（统一 Zustand）
- 其他 toast 库（统一 sonner）
- 其他 markdown 库（统一 react-markdown）
- **任何 date 第三方库**（date-fns / dayjs / moment 都不引）
- 其他 className 工具（用项目内 `cn()`）

---

## 禁止清单（代码层）

- ❌ inline `style={...}`（特殊情况必须注释）
- ❌ `` className={`${a} ${b}`} `` 模板拼接（用 `cn()`）
- ❌ 重新实现 shadcn 原件
- ❌ 引入任何第三方 UI 组件库
- ❌ 渲染进程裸 `fetch` / `axios` / 直连 Gateway（**ESLint error**）
- ❌ `window.electron.ipcRenderer.invoke()` 直接调（**ESLint error**）
- ❌ `process.env.*`（用 `import.meta.env.VITE_*`）
- ❌ 业务数据写入 `localStorage`（性能缓存 + UI flags 例外）
- ❌ `fs.*` / `require('electron')` / `process.*` 出现在 `src/`
- ❌ 用户文案裸字符串（必须 i18n）
- ❌ 密钥写进 `.env`（走 Keychain）
- ❌ Context + useState 模拟全局状态（用 Zustand）
- ❌ 跳过 token quota check 直接发消息
- ❌ SSO 白名单 fail-open
- ❌ `beforeunload` 上报 / 清理（X 是隐藏到托盘）
- ❌ `<div onClick>` 模拟 button
- ❌ 流式内容整段重渲染（先用 key、局部状态和子组件隔离）
- ❌ **默认用 `useCallback` / `useMemo` 包所有函数和值**
- ❌ 未测量就批量添加或删除 `React.memo`
- ❌ 用户上滚时强制拉回底部
- ❌ `npm` / `yarn` 命令（必须 pnpm）
- ❌ 字符串路径拼接（用路径构造函数）
- ❌ `src/` 内跨 feature 滥用深层相对路径（优先 `@/`；引用根目录 `shared/` 的现有相对路径例外）
- ❌ Hook 输出 tuple（除非模仿 React 内建）
- ❌ 裸 `<img src="/assets/...">`（用 `import`）
- ❌ 用 `<a target=_blank>` 开外链（用 `window.electron.openExternal`）
- ❌ Renderer 业务层为用户可见错误另建 `class XxxError extends Error`（统一 `AppError`；基础设施内部专用错误例外）
- ❌ 大型 store 单文件堆所有 actions（按 action 域切片）
- ❌ 永久删除业务数据（用软删除）
- ❌ 表单字段直接绑 store（用 draft pattern）

---

## 代码修改注释（**必须**）

对**非自解释**的业务/架构改动，必须在代码里留下简短注释，说明 **改了什么 + 为什么**（中文，1–3 句）。便于后续 review 与 AI/同事接续。

### 必须写注释的场景

| 场景 | 写法示例 |
| --- | --- |
| 修 bug / 对齐交互规格 | `// 图二：tool 跑完后短 text 必须 flush 成独立 phase-text，不能挂在组内` |
| 引擎差异（OpenClaw / Claude） | `// Claude：多条 text-only 消息后再吐 thinking，pre-batch 走 interleave` |
| Workaround / 临时方案 | `// HACK: 最终回复不参与 hasTextAfterThinkingStarted，避免完成态拆段失败` |
| 从 flat 迁到分段 UI | `// Phase 4：ChatMessage 统一走 parseThinkingTurnLayout，消灭双轨` |

### 注释位置

- **函数/模块级**：非显然的分支、兜底逻辑、跨文件契约 → 函数上方 `/** */` 或分支前 `//`
- **不宜**在每条语句后写 what 注释；**必须**在「为何这样」不显然时写 why

### AI 自检（修改注释）

- [ ] 本次 diff 里新增/修改的非显然逻辑都有 why 注释
- [ ] 注释为中文且简短，未重复类型/变量名已表达的信息
- [ ] 临时方案带 `TODO:` / `HACK:` 前缀

---

## AI 生成代码后必须自检（代码层）

- [ ] 写死的数组 / 对象字面量都加了 `@mock` 注释 + 待接接口描述
- [ ] 跨组件状态用了 Zustand store，没用 Context 模拟
- [ ] 用户文案走 i18n，没裸字符串
- [ ] env 用 `import.meta.env.VITE_*`，不是 `process.env`
- [ ] 后端调用走 `src/lib/` 的 host-api / api-client，没裸 fetch
- [ ] 没有 `window.electron.ipcRenderer.invoke()` 直接调
- [ ] 没有 `localStorage` 存业务数据
- [ ] 没有 `fs.*` / `require('electron')` 出现在 `src/`
- [ ] 所有 `<button>` 有 `type` 属性
- [ ] 图标按钮有 `aria-label`
- [ ] Modal / Drawer 有 focus trap + Esc
- [ ] form 用 useState draft + save handler 模式
- [ ] 长任务有「已开始」即时反馈 + 可取消 + 阶段性进度
- [ ] 流式渲染增量更新，没整段重渲染
- [ ] 流式列表先靠稳定 key、局部状态和子组件边界隔离更新
- [ ] 没有默认批量添加或删除 `useCallback` / `useMemo` / `React.memo`
- [ ] 使用 memo 化的地方有引用语义或可复现的性能证据，非显然处有 why 注释
- [ ] 列表 > 50 项虚拟化
- [ ] 发送聊天前查了 token quota
- [ ] 涉及 SSO 白名单功能 fail-closed
- [ ] 新增 hook 文件名使用 `use-kebab-case.ts`；共享 hook 放 `src/hooks/`，feature 私有 hook 就近放置
- [ ] 对话滚动跟随场景复用了 `useStickToBottomInstant`
- [ ] Loading 防闪烁用了 `useMinLoading`
- [ ] 业务组件按 feature 放进了 `src/components/<domain>/` 子目录
- [ ] 包管理命令是 pnpm
- [ ] 没有 `beforeunload` 假设 X = 退出的逻辑
- [ ] 通道命名 `module:action`（invoke）/ `<scope>:<event>`（event），白名单已加
- [ ] `src/` 内跨 feature 引用优先用 `@/`；同目录和根目录 `shared/` 引用沿用项目现有路径

### 组件封装自检（**新增 v1.1**）

- [ ] 同一文件内**没有**结构相同/类似的 JSX 块出现 ≥ 2 次（应抽组件）
- [ ] 没有嵌套深度 ≥ 4 层且有独立语义的内联 JSX 块（应抽组件）
- [ ] 没有 30+ 行的内联 JSX 块可以独立命名（应抽组件）
- [ ] 抽出的组件**结构固定**（HTML/className 写死）+ **内容用 props 注入**
- [ ] 组件命名是**业务语义**（`<TaskCard>` / `<SkillTile>`），不是 `<Card1>` / `<Item>`
- [ ] 组件放对位置（单页面 → `pages/<页>/`，跨页面 → `components/<feature>/`）

### Props 设计自检（**新增 v1.1**）

- [ ] Props 类型用 `interface` 显式声明，不是 inline `{...}`
- [ ] Props 命名是**业务语义**（`title` / `status` / `onConfirm`），不是 `text1` / `cb`
- [ ] 布尔 props 用 `is*` / `has*` / `can*` / `should*` 前缀
- [ ] 事件 props 用 `on*` 前缀，内部回调用 `handle*`
- [ ] **每个 prop 都有 TSDoc 注释**（`/** ... */`）说明业务含义
- [ ] 组件顶部有 TSDoc 注释说明用途 + 使用场景
- [ ] 互斥 props 用 discriminated union（按 `status` / `kind` 联合）
- [ ] 可视组件接受 `className?: string` 并 `cn()` 合并
- [ ] 没有 `defaultProps`（React 19 已废弃，用解构默认值）
