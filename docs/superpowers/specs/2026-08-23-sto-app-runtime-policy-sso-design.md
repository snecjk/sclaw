# STO 应用 Runtime：Policy HTTP 与 Site 单点登录设计

**状态：** 已根据 2026-08-23 的架构讨论确认

**范围：** SClaw 应用开发、生成的 Site/Assets 应用、STO Policy Ontology HTTP 接入，以及 Site 单点登录。不包含应用广场改造，也不包含任意外部服务的配置页面。

## 目标

提供统一的应用 Runtime API，使 `site` 和 `assets` 应用都能查询 `sto-policy-database` 技能描述的九个 HTTP 接口，同时为发布后的 Site 应用提供内置单点登录能力。

## 已确认的设计决策

1. 将 `@sto/app-runtime` 发布到公司内部 npm 仓库，并由 Vite 打入每个应用产物，不依赖运行时 CDN。
2. 应用代码只调用逻辑 Policy Operation，不能选择 Policy Host、Path、Method 或认证 Header。
3. 本地 Site/Assets 预览统一走 Vite 同源 Runtime 代理，并使用当前 SClaw 登录身份。
4. 发布后的 Site 应用自行完成 SSO，取得 `stoToken` 后直接请求 Policy HTTP。
5. 发布后的 Assets 应用不跳转 SSO。外层可信宿主通过受控 Bridge 提供当前用户的 `stoToken`，Token 仅保存在 iframe 内存中，随后由 iframe 直接请求 Policy HTTP。
6. 发布时选择的环境是唯一权威来源。Hostname 推断和 `VITE_SSO_ENV` 只作为兼容兜底，不能作为发布态主要判断依据。
7. `sto-policy-database` 技能允许直接调用同一组九个 HTTP 接口，但仍必须遵守封闭 Action 白名单、Schema 优先、只读、不得输出 Token 等规则。
8. 浏览器端 Operation 清单用于提升生成代码的正确性，但不是权限边界；最终用户身份与数据权限必须由 Policy 服务端校验。

## 应用运行模式

| 运行场景 | 身份来源 | Policy 调用方式 | SSO 行为 |
|---|---|---|---|
| 本地 Site | 当前 SClaw 会话 | Vite 代理 `/__sto/policy/:action` | 不跳转 |
| 本地 Assets | 当前 SClaw 会话 | Vite 代理 `/__sto/policy/:action` | 不跳转 |
| 发布 Site | Site SSO 回跳换票 | 直连 `https://zc-hybrid*.sto.cn` | Token 缺失或失效时必须登录 |
| 发布 Assets | 外层宿主 Bridge | 直连 `https://zc-hybrid*.sto.cn` | 永不自行跳转 |

## 包边界

使用一个 npm 包提供三个独立入口：

- `@sto/app-runtime`：浏览器启动、身份 Provider、Policy Client、Operation 校验、响应标准化和公共类型。
- `@sto/app-runtime/vite`：Vite 插件，负责注入公开 Runtime 配置以及注册本地同源代理。
- `@sto/app-runtime/host`：Assets 外层宿主使用的身份桥接工具。

Vite 和 Host 使用独立导出，避免 Node 专用代码误进入浏览器 Bundle。

## 公共 Runtime API

```ts
export type StoAppRuntime = {
  readonly config: StoRuntimeConfig;
  readonly auth: {
    getUser(): StoRuntimeUser | null;
    getToken(): string | null;
    logout(): Promise<void>;
  };
  readonly policy: {
    execute<T>(operationId: string, parameters?: Record<string, unknown>): Promise<T>;
    invoke<T>(action: PolicyAction, body?: Record<string, unknown>): Promise<T>;
  };
};

export function bootstrapStoApp(options?: {
  operations?: readonly PolicyOperation[];
}): Promise<StoAppRuntime>;
```

生成的业务页面优先使用 `policy.execute()`。`policy.invoke()` 只供技能生成的基础设施和诊断逻辑使用，但同样只能接受九个 `PolicyAction`。

## Runtime 配置

Runtime 读取一个不含秘密信息的配置对象。本地由 `@sto/app-runtime/vite` 注入，发布后由 code-deploy 构建流水线注入：

```ts
export type StoRuntimeConfig = {
  protocolVersion: 'sto-app-runtime/v1';
  applicationId: string;
  pageType: 'site' | 'assets';
  runtimeMode: 'local' | 'published';
  deployEnv: 'daily' | 'stage' | 'online';
  policyOrigin: string;
  sso?: {
    environment: 'daily' | 'pre' | 'prod';
    systemCode: string;
    loginOrigin: string;
    apiOrigin: string;
  };
  assetHostOrigin?: string;
};
```

配置通过 `window.__STO_APP_RUNTIME_CONFIG__` 暴露，任何情况下都不能包含 Token 或其他凭证。

### 环境映射

| 发布环境 | Policy Origin | SSO 环境 |
|---|---|---|
| `daily` | `https://zc-hybrid-test.sto.cn` | `daily` |
| `stage` | `https://pre-zc-hybrid.sto.cn` | `pre` |
| `online` | `https://zc-hybrid.sto.cn` | `prod` |

现有 code-deploy 请求已经携带 `env` 和 `applicationId`。发布服务从 code-application 记录取得 `pageType`，在 Vite 构建前注入完整配置。环境、应用 ID、应用类型或对应 SSO/宿主配置缺失时，发布构建必须失败，不能猜测或降级。

## Site 单点登录

发布态 Site 的启动顺序固定如下：

1. 在检查本地 Token 前，先从当前 URL 领取 `code` 或 `authorizationCode`。
2. 使用当前发布环境配置的用户中心回调接口完成换票。
3. 校验换票响应，并要求返回非空 `stoToken`。
4. 将 Token 写入当前 Site 域的 host-only Cookie，包含 `Path=/`、`SameSite=Lax`，HTTPS 下增加 `Secure`。
5. 将不敏感的用户展示信息写入当前 Site 自己的 `localStorage`。
6. 使用 `history.replaceState` 清理认证参数，同时保留业务 Query 和 Hash Route。
7. 如果既没有有效 Token，也没有回跳 Code，则调用 `buildSsoLoginUrl()`，并使用当前完整 Site URL 作为 `returnUrl`。
8. 后续认证请求同时携带 `stoToken` 和 `Authorization: Bearer <token>`。
9. 第一次遇到 `401` 时清理会话并重新登录；会话级 Guard 阻止重复重定向循环。

本地 Site 预览不执行上述跳转，而是使用 SClaw 当前身份完成启动。

## Assets 宿主身份

Assets iframe 启动后向配置的父页面 Origin 发起初始化请求：

```ts
type AssetInitRequest = {
  protocol: 'sto-app-runtime-host/v1';
  type: 'sto.runtime.init';
  applicationId: string;
  nonce: string;
};
```

宿主必须校验 `event.source`、精确的 `event.origin`、`applicationId`、期望的产物 URL 和 nonce。校验通过后，宿主通过指定 `targetOrigin` 和转移的 `MessagePort` 返回：

```ts
type AssetInitResponse = {
  protocol: 'sto-app-runtime-host/v1';
  type: 'sto.runtime.ready';
  applicationId: string;
  nonce: string;
  token: string;
  user: StoRuntimeUser;
  deployEnv: 'daily' | 'stage' | 'online';
};
```

Assets Runtime 只在内存中保存 Token，不得写入 URL、Cookie、localStorage、Console 或错误响应。宿主缺失或握手被拒绝时返回 `ASSET_HOST_AUTH_UNAVAILABLE`，绝不能在 iframe 内触发 Site SSO。

第一期方案默认 Assets 都是公司内部可信代码，因为 iframe 最终会获得完整 `stoToken`。如果以后开放第三方或未经审核的 Assets，必须将 Assets Transport 升级为宿主侧 `policy.execute` 代请求；应用侧 Runtime API 不需要变化。

## 本地身份与 CORS

SClaw 启动用户应用 Vite 进程前，生成不可猜测的 Runtime Session，并向子进程传入以下仅服务端可见的环境变量：

- `STO_APP_RUNTIME_SESSION`
- `STO_APP_RUNTIME_WORKSPACE_ID`
- `STO_APP_RUNTIME_PAGE_TYPE`
- `STO_APP_RUNTIME_DEPLOY_ENV`
- `STO_APP_RUNTIME_HOST_API`
- `STO_APP_RUNTIME_POLICY_ORIGIN`

Vite 插件使用这些变量完成：

1. 向 HTML 注入本地公开 Runtime 配置。
2. 提供 `/__sto/runtime/bootstrap`，使用仅 Vite 服务端可见的 Session Secret 从 SClaw Host API 取得当前用户 Token 和用户信息。
3. 提供 `/__sto/policy/:action`，只代理九个固定 Policy 路径到 `STO_APP_RUNTIME_POLICY_ORIGIN`。

浏览器只在 Bootstrap 响应中获得当前 Token，并仅保存在内存。Session Secret 永远留在 Vite 进程中。Runtime 迁移完成后，删除当前通过预览 URL Query 注入 Token 的实现。

## Policy HTTP 合同

| Action | Method | Path |
|---|---|---|
| `discover` | POST | `/sto-policy/api/v1/cli/ontology/discover` |
| `executefunction` | POST | `/sto-policy/api/v1/cli/ontology/execute-function` |
| `resolvereference` | POST | `/sto-policy/api/v1/cli/ontology/resolve-reference` |
| `queryobjectset` | POST | `/sto-policy/api/v1/cli/ontology/query-object-set` |
| `searcharound` | POST | `/sto-policy/api/v1/cli/ontology/search-around` |
| `schema` | POST | `/sto-policy/api/v1/cli/ontology/schema` |
| `schemagraph` | GET | `/sto-policy/api/v1/cli/ontology/schema-graph` |
| `describemetrictree` | POST | `/sto-policy/api/v1/cli/ontology/describe-metric-tree` |
| `help` | POST | `/sto-policy/api/v1/cli/ontology/help` |

任何 Runtime API 都不能接受任意 Host、URL、Method、Path、认证 Header、`cliAccessLevel` 或 `authOrg`。

## Policy Operation

每个生成的网站需求都固化为一个 Operation：

```ts
export type PolicyOperation = {
  operationId: string;
  action: PolicyAction;
  parameterSchema: Record<string, unknown>;
  buildBody(parameters: Record<string, unknown>): Record<string, unknown> | undefined;
};
```

技能在完成 Discover 和真实查询验证后，固定 `functionRef`、对象类型、关系名、指标 Key、Scope 结构和 Select 字段。只有日期、引用文本、筛选值、Cursor、Offset、Limit 等交互值可以作为页面参数。Runtime 在发起 HTTP 前拒绝未知字段、非法日期、非法不透明引用和越界分页。

## 技能调整

实施阶段需要修改以下技能文件：

- `/Users/linqiang/.stoclaw/skills-store/users/1207669/skills/sto-policy-database/SKILL.md`
- `/Users/linqiang/.stoclaw/skills-store/users/1207669/skills/sto-policy-database/references/dynamic-site.md`

修改后的规则必须：

- 允许在发现、验证和生成应用运行时直接调用精确的九个 Policy HTTP 接口。
- CLI 继续作为等价可用 Transport，但不再是唯一强制路径。
- 只允许当前环境对应的 `zc-hybrid*.sto.cn` Origin，拒绝其他 Host 和 Route。
- 身份只能由 SClaw 或 Runtime 提供，禁止要求用户粘贴、输出、持久化或嵌入 Token。
- 生成页面必须通过 `@sto/app-runtime` 调用 Operation。
- 分别说明本地代理、发布 Site 直连和发布 Assets 宿主身份直连。
- 删除“发布后必须有在线 BFF”的硬性约束。
- 保留只读语义、Discover/Schema/Reference 查询规则、分页、空状态、重试上限和响应 Envelope 解析规则。

## 错误模型

Runtime 对外提供稳定错误码：

- `RUNTIME_CONFIG_MISSING`
- `RUNTIME_CONFIG_INVALID`
- `AUTH_REQUIRED`
- `SSO_EXCHANGE_FAILED`
- `SSO_REDIRECT_LOOP`
- `ASSET_HOST_AUTH_UNAVAILABLE`
- `ASSET_HOST_ORIGIN_DENIED`
- `POLICY_ACTION_DENIED`
- `POLICY_OPERATION_NOT_FOUND`
- `POLICY_PARAMETERS_INVALID`
- `POLICY_UNAUTHORIZED`
- `POLICY_FORBIDDEN`
- `POLICY_TIMEOUT`
- `POLICY_UPSTREAM_FAILED`
- `POLICY_RESPONSE_INVALID`

错误可以携带 HTTP Status、Policy 错误码和 `traceId`，但不得包含认证 Header、Token、回跳 Code 或原始认证请求信息。

## 安全不变量

- 只能调用精确的 Policy Action 和 Path。
- 发布配置来自部署环境，不能由页面请求覆盖。
- Site Cookie 必须是 host-only，禁止使用 `Domain=.sto.cn`。
- Assets 消息必须校验精确 Origin、Source Window、Nonce，并使用 `MessageChannel`。
- 本地 Runtime Session Secret 不能进入浏览器 Bundle 或 HTML。
- Token 不能出现在 URL、生成源码、构建产物、日志、埋点或错误响应中。
- 每次 Policy 请求仍必须由后端完成身份与权限校验。

## 不在本期范围内

- 应用广场筛选或展示改造。
- 面向用户的外部服务配置页面。
- 任意通配的开发代理。
- 共享在线 BFF 或 API Gateway。
- 用户中心 Refresh Token 协议调整。
- Assets 自行跳转 SSO。
- 第三方或未经审核的 Assets 执行。

## 验收标准

1. 同一份生成页面代码能在本地 Site、本地 Assets、发布 Site、发布 Assets 四种场景中成功查询同一个冻结的 Policy Operation。
2. 本地浏览器请求全部同源，不出现 CORS 错误。
3. 发布 Site 未登录时跳转 SSO，回跳后完成换票、清理 URL Code，并发起第一次认证 Policy 请求。
4. 发布 Assets 永不跳转 SSO；可信宿主未提供身份时明确失败。
5. `daily`、`stage`、`online` 精确映射到环境矩阵中的 Policy 与 SSO 地址。
6. 九个允许 Action 全部可用，未知 Action 或任意 URL 在发起网络请求前失败。
7. Loading、Empty、Success、401、403、Timeout、非法响应和安全重试均有自动化测试。
8. 对源码、日志、URL 和构建产物扫描时，不得发现任何凭证值。
9. 修改后的技能只允许九个 HTTP 接口，并保留原有查询正确性规则。
