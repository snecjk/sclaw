# STO 应用 Runtime：Policy HTTP 与 Site 单点登录实施计划

> **供执行者使用：** 必须使用 `superpowers:subagent-driven-development`（推荐）或 `superpowers:executing-plans`，按照任务逐项实施。所有步骤使用复选框（`- [ ]`）跟踪状态。

**目标：** 构建并接入 `@sto/app-runtime`，使本地与发布后的 Site/Assets 应用都能查询九个 STO Policy Ontology HTTP 接口，同时支持发布态 Site 单点登录和发布态 Assets 宿主身份。

**架构：** 浏览器 Runtime 对应用只暴露统一的 Policy Operation API，并根据部署方注入的配置选择本地、发布 Site 或发布 Assets 身份适配器。本地由 SClaw 提供身份并由 Vite 解决 CORS；Site 使用用户中心 SSO；Assets 从可信外层宿主取得仅存于内存的 Token；技能围绕封闭的九个 HTTP Action 生成冻结 Operation。

**技术栈：** TypeScript 5.9、Vite 5/7 Plugin API、Fetch、MessageChannel/postMessage、Vitest 4、tsup、Electron Main Host API、React 19 模板、公司内部 npm 仓库。

**设计文档：** `docs/superpowers/specs/2026-08-23-sto-app-runtime-policy-sso-design.md`

## 全局约束

- 应用类型只有 `site` 和 `assets`；历史数据缺失或非法时归一化为 `site`。
- 发布环境只有 `daily`、`stage`、`online`。
- `daily` 对应 `https://zc-hybrid-test.sto.cn` 和 daily SSO；`stage` 对应 `https://pre-zc-hybrid.sto.cn` 和 pre SSO；`online` 对应 `https://zc-hybrid.sto.cn` 和 prod SSO。
- Policy 白名单只能包含 Spec 中的九个 Action 和 Path。任何接口都不能接受任意 Host、URL、Path、Method、Header、`cliAccessLevel` 或 `authOrg`。
- 本地 Site/Assets 使用当前 SClaw 身份，不能跳转 SSO。
- 发布 Site 负责 SSO 跳转、回跳换票、会话持久化和一次性 401 恢复。
- 发布 Assets 不得跳转 SSO；只能从可信宿主取得 Token，且 Token 只保存在内存。
- Token 和 SSO Code 不能出现在生成源码、Runtime 配置、清理后的 URL、日志、埋点、错误对象或构建产物中。
- Operation 校验只是前端正确性边界；Policy 后端仍须对每次请求执行身份和权限校验。
- 应用广场、任意外部服务配置页面、共享在线 BFF、第三方 Assets 不在本期范围内。
- 保留工作区已有的 `electron/services/app-dev-service.ts` 未提交修改；只暂存当前任务拥有的文件或 Hunk。
- 所有行为修改使用 TDD；每个任务以聚焦测试、`git diff --check` 和独立提交结束。

---

## 文件结构

### SClaw 共享合同

- 新建 `shared/sto-app-runtime-contract.v1.json`：环境矩阵和 Policy HTTP Action 的唯一数据源。
- 新建 `shared/sto-app-runtime-contract.ts`：类型、严格归一化、配置校验和只读合同导出。
- 新建 `tests/unit/sto-app-runtime-contract.test.ts`：环境、应用类型和九 Action 合同测试。

### 内部 npm 包

- 新建 `packages/sto-app-runtime/package.json`：导出主入口、`/vite` 和 `/host`。
- 新建 `packages/sto-app-runtime/tsconfig.json`、`tsup.config.ts`：分别产出 ESM、CJS 和类型声明。
- 新建 `packages/sto-app-runtime/src/config.ts`、`errors.ts`、`runtime.ts`：配置、错误模型和启动编排。
- 新建 `packages/sto-app-runtime/src/auth/`：本地身份、Site SSO、Assets 宿主身份和内存会话。
- 新建 `packages/sto-app-runtime/src/policy/`：固定 Action、Operation Registry 和 HTTP Client。
- 新建 `packages/sto-app-runtime/src/vite/`：本地配置注入与固定代理。
- 新建 `packages/sto-app-runtime/src/host/`：Assets 外层宿主工具。
- 新建 `packages/sto-app-runtime/tests/`：按职责拆分的包级测试。

### SClaw、模板、技能与部署

- 新建 `electron/services/app-runtime-local-session.ts`，修改 `app-dev-server-manager.ts` 和 `electron/api/routes/app-dev.ts`。
- 修改 `AppDevWorkbenchStage.tsx`、`app-dev-preview-url.ts`，删除 URL Token 注入。
- 修改 `resources/app-templates/react-a2ui-template/`，统一使用 Runtime。
- 修改 `sto-policy-database/SKILL.md` 和 `references/dynamic-site.md`。
- 新建部署合同和产物验证器。

---

### 任务 1：固化 Runtime 配置与 Policy Action 合同

**文件：**
- 新建：`shared/sto-app-runtime-contract.v1.json`
- 新建：`shared/sto-app-runtime-contract.ts`
- 测试：`tests/unit/sto-app-runtime-contract.test.ts`

**接口：**
- 产出：`StoAppPageType`、`StoDeployEnv`、`StoSsoEnv`、`StoRuntimeConfig`、`PolicyAction`。
- 产出：`POLICY_HTTP_ACTIONS`、`resolveStoRuntimeEnvironment()`、`normalizeStoRuntimeConfig()`、`resolvePolicyAction()`。
- 依赖：无新增接口。

- [ ] **步骤 1：编写失败的合同测试**

```ts
import { describe, expect, it } from 'vitest';
import {
  POLICY_HTTP_ACTIONS,
  normalizeStoRuntimeConfig,
  resolvePolicyAction,
  resolveStoRuntimeEnvironment,
} from '../../shared/sto-app-runtime-contract';

describe('STO 应用 Runtime 合同', () => {
  it.each([
    ['daily', 'https://zc-hybrid-test.sto.cn', 'daily'],
    ['stage', 'https://pre-zc-hybrid.sto.cn', 'pre'],
    ['online', 'https://zc-hybrid.sto.cn', 'prod'],
  ] as const)('%s 映射到固定服务环境', (env, policyOrigin, ssoEnvironment) => {
    expect(resolveStoRuntimeEnvironment(env)).toMatchObject({ policyOrigin, ssoEnvironment });
  });

  it('只包含九个 Action', () => {
    expect(Object.keys(POLICY_HTTP_ACTIONS).sort()).toEqual([
      'describemetrictree', 'discover', 'executefunction', 'help',
      'queryobjectset', 'resolvereference', 'schema', 'schemagraph', 'searcharound',
    ]);
  });

  it('在联网前拒绝未知 Action 和非法配置', () => {
    expect(resolvePolicyAction('curl')).toBeNull();
    expect(() => normalizeStoRuntimeConfig({
      protocolVersion: 'sto-app-runtime/v1', pageType: 'site',
      runtimeMode: 'published', deployEnv: 'daily',
    })).toThrow('applicationId');
  });
});
```

- [ ] **步骤 2：运行测试并确认红灯**

```bash
pnpm vitest run tests/unit/sto-app-runtime-contract.test.ts
```

预期：失败，原因是共享合同文件尚不存在。

- [ ] **步骤 3：创建唯一 JSON 数据源**

```json
{
  "protocolVersion": "sto-app-runtime/v1",
  "environments": {
    "daily": { "policyOrigin": "https://zc-hybrid-test.sto.cn", "ssoEnvironment": "daily" },
    "stage": { "policyOrigin": "https://pre-zc-hybrid.sto.cn", "ssoEnvironment": "pre" },
    "online": { "policyOrigin": "https://zc-hybrid.sto.cn", "ssoEnvironment": "prod" }
  },
  "policyActions": {
    "discover": { "method": "POST", "path": "/sto-policy/api/v1/cli/ontology/discover" },
    "executefunction": { "method": "POST", "path": "/sto-policy/api/v1/cli/ontology/execute-function" },
    "resolvereference": { "method": "POST", "path": "/sto-policy/api/v1/cli/ontology/resolve-reference" },
    "queryobjectset": { "method": "POST", "path": "/sto-policy/api/v1/cli/ontology/query-object-set" },
    "searcharound": { "method": "POST", "path": "/sto-policy/api/v1/cli/ontology/search-around" },
    "schema": { "method": "POST", "path": "/sto-policy/api/v1/cli/ontology/schema" },
    "schemagraph": { "method": "GET", "path": "/sto-policy/api/v1/cli/ontology/schema-graph" },
    "describemetrictree": { "method": "POST", "path": "/sto-policy/api/v1/cli/ontology/describe-metric-tree" },
    "help": { "method": "POST", "path": "/sto-policy/api/v1/cli/ontology/help" }
  }
}
```

- [ ] **步骤 4：实现 TypeScript 类型和严格校验**

```ts
export type StoAppPageType = 'site' | 'assets';
export type StoDeployEnv = 'daily' | 'stage' | 'online';
export type StoSsoEnv = 'daily' | 'pre' | 'prod';
export type PolicyAction =
  | 'discover' | 'executefunction' | 'resolvereference'
  | 'queryobjectset' | 'searcharound' | 'schema'
  | 'schemagraph' | 'describemetrictree' | 'help';

export const POLICY_HTTP_ACTIONS = Object.freeze(
  contract.policyActions as Record<PolicyAction, { method: 'GET' | 'POST'; path: string }>,
);
```

模块加载时校验环境 Key 恰好为三个、Action Key 恰好为九个、Path 必须以 `/sto-policy/api/v1/cli/ontology/` 开头、Method 只能是 GET/POST。发布配置必须包含应用 ID、合法 PageType、固定环境 Origin，以及对应的 Site SSO 或 Assets Host 配置。

- [ ] **步骤 5：验证并提交**

```bash
pnpm vitest run tests/unit/sto-app-runtime-contract.test.ts tests/unit/sto-policy-report-host.test.ts
pnpm typecheck
git diff --check
git add shared/sto-app-runtime-contract.v1.json shared/sto-app-runtime-contract.ts tests/unit/sto-app-runtime-contract.test.ts
git commit -m "feat: define STO app runtime contracts"
```

---

### 任务 2：搭建多入口 `@sto/app-runtime` 包

**文件：**
- 新建：`packages/sto-app-runtime/package.json`
- 新建：`packages/sto-app-runtime/tsconfig.json`
- 新建：`packages/sto-app-runtime/tsup.config.ts`
- 新建：`packages/sto-app-runtime/src/index.ts`
- 新建：`packages/sto-app-runtime/src/vite.ts`
- 新建：`packages/sto-app-runtime/src/host.ts`
- 新建：`packages/sto-app-runtime/src/config.ts`
- 新建：`packages/sto-app-runtime/src/errors.ts`
- 测试：`packages/sto-app-runtime/tests/config.test.ts`

**接口：**
- 依赖：任务 1 的 `normalizeStoRuntimeConfig()` 和共享类型。
- 产出：`readStoRuntimeConfig()`、`StoAppRuntimeError`，以及主入口、`/vite`、`/host`。

- [ ] **步骤 1：创建包清单和构建配置**

```json
{
  "name": "@sto/app-runtime",
  "version": "1.0.0",
  "type": "module",
  "sideEffects": false,
  "files": ["dist", "README.md"],
  "exports": {
    ".": { "types": "./dist/index.d.ts", "import": "./dist/index.js", "require": "./dist/index.cjs" },
    "./vite": { "types": "./dist/vite.d.ts", "import": "./dist/vite.js", "require": "./dist/vite.cjs" },
    "./host": { "types": "./dist/host.d.ts", "import": "./dist/host.js", "require": "./dist/host.cjs" }
  },
  "publishConfig": { "registry": "http://snpm-registry.sto.cn" },
  "scripts": {
    "build": "tsup", "test": "vitest run", "typecheck": "tsc --noEmit",
    "prepublishOnly": "npm run test && npm run typecheck && npm run build"
  },
  "peerDependencies": { "vite": ">=5.4 <8" },
  "peerDependenciesMeta": { "vite": { "optional": true } },
  "devDependencies": {
    "@types/node": "^25.3.0", "tsup": "^8.5.0", "typescript": "^5.9.3",
    "vite": "^7.3.1", "vitest": "^4.0.18"
  }
}
```

`tsup.config.ts` 分别以 `src/index.ts`、`src/vite.ts`、`src/host.ts` 为入口，输出 ESM/CJS、类型声明和 Source Map，并将 `vite` Externalize。

- [ ] **步骤 2：编写失败的配置与错误测试**

```ts
it('从部署方全局变量读取配置', () => {
  expect(readStoRuntimeConfig({ __STO_APP_RUNTIME_CONFIG__: validSiteConfig }))
    .toEqual(validSiteConfig);
});

it('安全错误不包含原始配置和秘密值', () => {
  const error = captureError(() => readStoRuntimeConfig({
    __STO_APP_RUNTIME_CONFIG__: { token: 'secret' },
  }));
  expect(error.code).toBe('RUNTIME_CONFIG_INVALID');
  expect(JSON.stringify(error)).not.toContain('secret');
});
```

测试文件内明确声明 `validSiteConfig` 和 `captureError()`，不得引用未定义 Helper。

- [ ] **步骤 3：运行红灯测试**

```bash
npm --prefix packages/sto-app-runtime install
npm --prefix packages/sto-app-runtime test
```

预期：因配置和错误实现不存在而失败。

- [ ] **步骤 4：实现配置读取与安全错误**

`StoAppRuntimeError` 只允许 `code`、`message`、可选 HTTP `status`、上游 `errorCode` 和 `traceId`。构造函数不能接收原始 Header、URL Query、回跳 Code 或请求 Echo。

```ts
declare global {
  interface Window {
    __STO_APP_RUNTIME_CONFIG__?: unknown;
  }
}
```

`readStoRuntimeConfig()` 委托任务 1 校验，并分别映射为 `RUNTIME_CONFIG_MISSING` 和 `RUNTIME_CONFIG_INVALID`。tsup 必须将共享 JSON 打入 `dist`。

- [ ] **步骤 5：验证三个入口并提交**

```bash
npm --prefix packages/sto-app-runtime test
npm --prefix packages/sto-app-runtime run typecheck
npm --prefix packages/sto-app-runtime run build
test -f packages/sto-app-runtime/dist/index.js
test -f packages/sto-app-runtime/dist/vite.js
test -f packages/sto-app-runtime/dist/host.js
git diff --check
git add packages/sto-app-runtime
git commit -m "feat: scaffold STO app runtime package"
```

---

### 任务 3：实现封闭 Policy Client 与冻结 Operation

**文件：**
- 新建：`packages/sto-app-runtime/src/policy/actions.ts`
- 新建：`packages/sto-app-runtime/src/policy/operations.ts`
- 新建：`packages/sto-app-runtime/src/policy/client.ts`
- 修改：`packages/sto-app-runtime/src/index.ts`
- 测试：`packages/sto-app-runtime/tests/policy-client.test.ts`
- 测试：`packages/sto-app-runtime/tests/policy-operations.test.ts`

**接口：**
- 依赖：共享 Action/配置/错误，以及 `getToken()`。
- 产出：`PolicyOperation`、`createPolicyOperationRegistry()`、`createPolicyClient()`、`invoke()`、`execute()`。

- [ ] **步骤 1：编写失败的 HTTP 与 Action 测试**

```ts
it('本地使用同源 Action 地址', async () => {
  const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ success: true, data: { rows: [] } }));
  const client = createPolicyClient({ config: localConfig, getToken: () => 'token-a', fetch: fetchMock });
  await client.invoke('queryobjectset', { from: 'Site' });
  expect(fetchMock).toHaveBeenCalledWith(
    '/__sto/policy/queryobjectset', expect.objectContaining({ method: 'POST' }),
  );
});

it('发布态只使用固定 Origin 和 Path', async () => {
  const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ success: true }));
  const client = createPolicyClient({ config: dailySiteConfig, getToken: () => 'token-a', fetch: fetchMock });
  await client.invoke('schemagraph');
  expect(fetchMock).toHaveBeenCalledWith(
    'https://zc-hybrid-test.sto.cn/sto-policy/api/v1/cli/ontology/schema-graph',
    expect.objectContaining({ method: 'GET', body: undefined }),
  );
});

it('未知 Action 不触发 Fetch', async () => {
  const fetchMock = vi.fn();
  const client = createPolicyClient({ config: dailySiteConfig, getToken: () => 'token-a', fetch: fetchMock });
  await expect(client.invoke('curl' as never, {}))
    .rejects.toMatchObject({ code: 'POLICY_ACTION_DENIED' });
  expect(fetchMock).not.toHaveBeenCalled();
});
```

- [ ] **步骤 2：编写 Operation Registry 测试并确认红灯**

创建 `cross-site-shops` Operation，固定 `findCrossSiteShops@1.0`，只允许 `organizationObjectRef`、`start`、`end`、`limit`、`offset`，拒绝额外 `functionRef` 和越界值。

```bash
npm --prefix packages/sto-app-runtime test -- policy-client.test.ts policy-operations.test.ts
```

预期：Policy Client 和 Registry 尚不存在，因此失败。

- [ ] **步骤 3：实现固定 URL、超时和错误映射**

```ts
const contract = resolvePolicyAction(action);
if (!contract) {
  throw new StoAppRuntimeError('POLICY_ACTION_DENIED', '不支持的政策数据操作');
}
const url = config.runtimeMode === 'local'
  ? `/__sto/policy/${action}`
  : `${config.policyOrigin}${contract.path}`;
```

使用 30 秒 AbortController。401、403、Abort、非 JSON 和失败 Envelope 映射为稳定错误码；保留安全 `traceId`；`rows=[]` 和 `status=EMPTY` 是成功空数据。

- [ ] **步骤 4：实现 Registry 边界**

拒绝重复/空 ID、不支持 Action、非对象参数和未知参数。`execute()` 调用注册的 `buildBody()` 后复用 `invoke()`，不能接收调用方 URL、Method、Path、Header 或 `functionRef` 覆盖。

- [ ] **步骤 5：验证并提交**

```bash
npm --prefix packages/sto-app-runtime test
npm --prefix packages/sto-app-runtime run typecheck
npm --prefix packages/sto-app-runtime run build
git diff --check
git add packages/sto-app-runtime/src packages/sto-app-runtime/tests
git commit -m "feat: add controlled Policy operation client"
```

---

### 任务 4：将发布态 Site SSO 下沉到 Runtime

**文件：**
- 新建：`packages/sto-app-runtime/src/auth/memory-session.ts`
- 新建：`packages/sto-app-runtime/src/auth/site-sso.ts`
- 修改：`packages/sto-app-runtime/src/index.ts`
- 测试：`packages/sto-app-runtime/tests/site-sso.test.ts`

**接口：**
- 依赖：发布态 Site `StoRuntimeConfig` 和可注入的浏览器 Platform。
- 产出：`createSiteSsoAuth()`，包含 `bootstrap()`、`getToken()`、`getUser()`、`logout()`、`handleUnauthorized()`。
- 产出：`buildSsoLoginUrl()`、`buildSsoCallbackExchangeUrl()`。

- [ ] **步骤 1：移植现有换票响应并编写失败测试**

覆盖 `data.stoToken`、`data.userLogOnResult.stoToken`、`code`、`authorizationCode`、成功响应缺 Token、URL 清理保留 `?filter=active#/reports`、无会话触发精确 SSO 跳转、第二次 401 返回 `SSO_REDIRECT_LOOP`。

- [ ] **步骤 2：运行红灯测试**

```bash
npm --prefix packages/sto-app-runtime test -- site-sso.test.ts
```

预期：Site Auth 尚不存在，因此失败。

- [ ] **步骤 3：实现固定 SSO 状态机**

顺序不能调整：

```ts
if (callbackCode) return exchangeAndPersist(callbackCode);
if (hasValidStoredToken()) return currentSession();
if (redirectGuard.wasAttemptedForCurrentUrl()) throw redirectLoopError();
return redirectToLogin();
```

Token 使用 host-only `stoToken` Cookie，包含 `Path=/; SameSite=Lax`，HTTPS 下增加 `Secure`，不能设置 Domain。用户展示数据使用版本化 Key，例如 `sto.app-runtime.user.v1`。

- [ ] **步骤 4：实现安全换票与 URL 清理**

换票请求固定为 `GET <apiOrigin>/sso/login/callback?code=<encoded>`，使用 `credentials: 'omit'`，只接受 JSON。清理时只删除 `code`、`authorizationCode` 和历史 Token 参数，保留其他 Query 与 Hash。

- [ ] **步骤 5：验证并提交**

```bash
npm --prefix packages/sto-app-runtime test -- site-sso.test.ts
npm --prefix packages/sto-app-runtime run typecheck
git diff --check
git add packages/sto-app-runtime/src/auth packages/sto-app-runtime/src/index.ts packages/sto-app-runtime/tests/site-sso.test.ts
git commit -m "feat: add Site SSO to STO app runtime"
```

---

### 任务 5：实现不触发 SSO 的 Assets 宿主身份

**文件：**
- 新建：`packages/sto-app-runtime/src/auth/assets-host-auth.ts`
- 新建：`packages/sto-app-runtime/src/host/create-assets-host.ts`
- 修改：`packages/sto-app-runtime/src/host.ts`
- 测试：`packages/sto-app-runtime/tests/assets-host-auth.test.ts`
- 测试：`packages/sto-app-runtime/tests/assets-host.test.ts`

**接口：**
- 产出：iframe 使用的 `createAssetsHostAuth()`。
- 产出：父页面使用的 `createStoAssetsHost({ applicationId, iframe, assetOrigin, getSession })`。
- 依赖：宿主提供 `getSession(): Promise<{ token: string; user: StoRuntimeUser; deployEnv: StoDeployEnv }>`。

- [ ] **步骤 1：编写失败的握手安全测试**

覆盖 Source Window、精确 Origin、Application ID、Nonce、超时、重复响应和 `targetOrigin`；断言任何调用都不能使用 `'*'`。使用 Fake MessageChannel，确认 Token 只存在于转移 Port 的 Payload，不能进入 URL 和错误日志。

- [ ] **步骤 2：运行红灯测试**

```bash
npm --prefix packages/sto-app-runtime test -- assets-host-auth.test.ts assets-host.test.ts
```

预期：Host 与 iframe 适配器尚不存在，因此失败。

- [ ] **步骤 3：实现 iframe 握手**

Nonce 使用 `crypto.randomUUID()`，请求只发给 `config.assetHostOrigin`，最多等待 10 秒。响应必须同时满足：

```ts
response.protocol === 'sto-app-runtime-host/v1'
response.type === 'sto.runtime.ready'
response.applicationId === config.applicationId
response.nonce === request.nonce
```

只将 Token/User 写入 `memory-session.ts`。失败分别抛出 `ASSET_HOST_AUTH_UNAVAILABLE` 或 `ASSET_HOST_ORIGIN_DENIED`，不得调用任何 Site SSO 函数。

- [ ] **步骤 4：实现可信父页面 Helper**

只监听 `sto.runtime.init`；依次比较 `event.source` 与 `iframe.contentWindow`、`event.origin` 与 `assetOrigin`，全部通过后才能调用 `getSession()`。通过转移的 MessagePort 返回结果，并提供 Disposer 清理 Listener。Helper 不缓存 Token。

- [ ] **步骤 5：验证并提交**

```bash
npm --prefix packages/sto-app-runtime test
npm --prefix packages/sto-app-runtime run typecheck
git diff --check
git add packages/sto-app-runtime/src packages/sto-app-runtime/tests
git commit -m "feat: add Assets host authentication"
```

---

### 任务 6：组合 Runtime Bootstrap 与适配器选择

**文件：**
- 新建：`packages/sto-app-runtime/src/auth/local-auth.ts`
- 新建：`packages/sto-app-runtime/src/runtime.ts`
- 修改：`packages/sto-app-runtime/src/index.ts`
- 测试：`packages/sto-app-runtime/tests/runtime.test.ts`

**接口：**
- 依赖：本地、Site、Assets 身份 Provider 和 `createPolicyClient()`。
- 产出：`bootstrapStoApp()`、`getStoApp()`、`StoAppRuntime`。

- [ ] **步骤 1：编写四模式适配矩阵测试**

```text
local + site       -> local auth + local Policy URL
local + assets     -> local auth + local Policy URL
published + site   -> Site SSO + direct Policy URL
published + assets -> Assets host auth + direct Policy URL
```

同时断言 React StrictMode 下 Bootstrap 只执行一次；成功启动前调用 `getStoApp()` 返回 `RUNTIME_CONFIG_MISSING`。

- [ ] **步骤 2：运行红灯测试**

```bash
npm --prefix packages/sto-app-runtime test -- runtime.test.ts
```

预期：Runtime 组合逻辑尚不存在，因此失败。

- [ ] **步骤 3：实现本地身份 Bootstrap**

本地调用 `/__sto/runtime/bootstrap`，使用 `credentials: 'same-origin'`，要求响应包含 `{ success: true, token, user }`，并写入内存。401 映射为 `AUTH_REQUIRED`，不能触发 SSO。

- [ ] **步骤 4：实现 Single-flight 启动与 401 分流**

使用模块级 Bootstrap Promise；只有失败时才能清空以允许重试。身份启动完成后创建 Policy Client，Token 使用 Closure 获取最新值。`POLICY_UNAUTHORIZED` 只在发布 Site 调用 `siteAuth.handleUnauthorized()`；本地和 Assets 将错误返回宿主/UI。

- [ ] **步骤 5：运行完整包级检查并提交**

```bash
npm --prefix packages/sto-app-runtime test
npm --prefix packages/sto-app-runtime run typecheck
npm --prefix packages/sto-app-runtime run build
git diff --check
git add packages/sto-app-runtime
git commit -m "feat: compose STO application runtime"
```

---

### 任务 7：增加 SClaw 本地 Runtime Session 与 Vite 代理

**文件：**
- 新建：`electron/services/app-runtime-local-session.ts`
- 修改：`electron/services/app-dev-server-manager.ts`
- 修改：`electron/api/routes/app-dev.ts`
- 修改：`packages/sto-app-runtime/src/vite/plugin.ts`
- 修改：`packages/sto-app-runtime/src/vite.ts`
- 测试：`tests/unit/app-runtime-local-session.test.ts`
- 测试：`packages/sto-app-runtime/tests/vite-plugin.test.ts`

**接口：**
- 产出：`createAppRuntimeLocalSession()`、`validateAppRuntimeLocalSession()`、`destroyAppRuntimeLocalSession()`。
- 产出：Host API `POST /api/app-dev/runtime/bootstrap` 和 `stoAppRuntimeVite()`。
- 依赖：`getStoToken()`、`getSsoEnvironment()`、`getStoPolicyHybridApiHostForSsoEnv()` 和 `.sclaw/app-dev.json`。

- [ ] **步骤 1：编写失败的 Session 生命周期测试**

断言 Secret 为 32 字节随机 URL-safe 值；同 Workspace 第二个 Session 使第一个失效；错误 Workspace/Secret 被拒绝；Destroy 后无法访问；历史 Marker 默认 Site；公开配置不包含 Secret。

- [ ] **步骤 2：编写失败的 Vite Plugin 测试**

直接调用 Plugin Hook，断言：`transformIndexHtml` 注入配置但没有 Secret；Bootstrap 转给 Host API 并由 Vite 添加 `x-sto-runtime-session`；只允许固定 Action；`curl` 在联网前被拒绝；Policy Target 不能来自浏览器 Query。

- [ ] **步骤 3：运行红灯测试**

```bash
pnpm vitest run tests/unit/app-runtime-local-session.test.ts
npm --prefix packages/sto-app-runtime test -- vite-plugin.test.ts
```

预期：Session Service 和 Plugin 尚不存在，因此失败。

- [ ] **步骤 4：实现环境映射和子进程变量**

`daily-external`、`local` 映射为 `daily`；`pre-release` 映射为 `stage`；两个生产模式映射为 `online`。PageType 从 `.sclaw/app-dev.json` 读取并归一化。

```ts
STO_APP_RUNTIME_SESSION: session.secret,
STO_APP_RUNTIME_WORKSPACE_ID: workspaceId,
STO_APP_RUNTIME_PAGE_TYPE: session.pageType,
STO_APP_RUNTIME_DEPLOY_ENV: session.deployEnv,
STO_APP_RUNTIME_HOST_API: 'http://127.0.0.1:3210',
STO_APP_RUNTIME_POLICY_ORIGIN: session.policyOrigin,
```

正常停止、Crash、Ready Probe 失败、Restart 和 App Quit 都必须销毁 Session。

- [ ] **步骤 5：实现受保护 Bootstrap、固定代理并提交**

Host API 先校验 Workspace/Session，再读取身份；缺失 Token 返回 401，非法 Session 返回 403，不能记录 Header/Body。Vite 代理使用共享 Action Map；Method 不匹配返回 405。

```bash
pnpm vitest run tests/unit/app-runtime-local-session.test.ts tests/unit/app-dev-preview-url.test.ts
npm --prefix packages/sto-app-runtime test
pnpm typecheck
git diff --check
git add electron/services/app-runtime-local-session.ts electron/services/app-dev-server-manager.ts electron/api/routes/app-dev.ts packages/sto-app-runtime tests/unit/app-runtime-local-session.test.ts
git commit -m "feat: provide local app runtime identity and proxy"
```

`app-runtime-local-session.ts` 直接读取 Marker，不修改或暂存用户已有的 `electron/services/app-dev-service.ts` 变更。

### 任务 8：迁移 React A2UI 模板到 Runtime

**文件：**
- 修改：`resources/app-templates/react-a2ui-template/package.json`
- 修改：`resources/app-templates/react-a2ui-template/vite.config.ts`
- 修改：`resources/app-templates/react-a2ui-template/src/main.tsx`
- 修改：`resources/app-templates/react-a2ui-template/src/lib/request.ts`
- 新建：`resources/app-templates/react-a2ui-template/src/lib/policy.ts`
- 修改：`resources/app-templates/react-a2ui-template/.env.example`
- 修改：`resources/app-templates/react-a2ui-template/README.md`
- 删除：`resources/app-templates/react-a2ui-template/src/lib/sso-config.ts`
- 删除：`resources/app-templates/react-a2ui-template/src/lib/sso-api.ts`
- 删除：`resources/app-templates/react-a2ui-template/src/lib/sso.ts`
- 删除：`resources/app-templates/react-a2ui-template/src/lib/auth-token.ts`
- 删除：`resources/app-templates/react-a2ui-template/src/lib/session.ts`
- 测试：`tests/unit/react-a2ui-runtime-template.test.ts`

**接口：**
- 依赖：`@sto/app-runtime`、`bootstrapStoApp()`、`getStoApp()` 和 `stoAppRuntimeVite()`。
- 产出：只负责业务 UI 和业务 Operation 声明、不再自行实现 SSO、Token 存储及环境判断的模板。

- [ ] **步骤 1：构建并打包本地 Runtime**

```bash
npm --prefix packages/sto-app-runtime run build
cd packages/sto-app-runtime && npm pack --silent
```

- [ ] **步骤 2：编写失败的模板契约测试**

断言模板依赖 `@sto/app-runtime`，Vite 使用 `stoAppRuntimeVite()`，入口调用 `bootstrapStoApp()`，请求层从 Runtime 获取 Token，URL 不再携带 Token Query，并提供 Policy Operation Helper。

- [ ] **步骤 3：运行红灯测试**

```bash
pnpm vitest run tests/unit/react-a2ui-runtime-template.test.ts
```

预期：模板仍包含旧 SSO 适配层，因此失败。

- [ ] **步骤 4：迁移模板启动和请求链路**

在 `package.json` 增加 `"@sto/app-runtime": "^1.0.0"`，入口统一启动 Runtime：

```ts
const runtime = await bootstrapStoApp({ operations: POLICY_OPERATIONS });
createRoot(container).render(
  <StrictMode><App runtime={runtime} /></StrictMode>,
);
```

请求层统一使用 `getStoApp().auth.getToken()`，不再出现 PageType 分支；业务接口通过 `policy.ts` 中声明的 Operation 调用。

- [ ] **步骤 5：删除重复适配层、更新文档并验证**

```bash
npm --prefix resources/app-templates/react-a2ui-template install --no-save --package-lock=false ../../../packages/sto-app-runtime/sto-app-runtime-1.0.0.tgz
npm --prefix resources/app-templates/react-a2ui-template run typecheck
npm --prefix resources/app-templates/react-a2ui-template run build
pnpm vitest run tests/unit/react-a2ui-runtime-template.test.ts
git diff --check
git add resources/app-templates/react-a2ui-template tests/unit/react-a2ui-runtime-template.test.ts
git commit -m "feat: base generated apps on STO app runtime"
```

不要暂存生成的 `.tgz`、`node_modules` 或构建目录。

### 任务 9：移除开发预览 URL 中的 Token

**文件：**
- 修改：`src/pages/apps/components/AppDevWorkbenchStage.tsx`
- 修改：`src/utils/app-dev-preview-url.ts`
- 测试：`tests/unit/app-dev-preview-url.test.ts`
- 测试：`tests/unit/app-dev-workbench-preview-auth.test.tsx`

**接口：**
- 依赖：任务 7 的本地 Runtime Bootstrap。
- 产出：不含 `stoToken`、`token` 或其他身份 Query 的预览 URL。

- [ ] **步骤 1：先修改测试，定义干净 URL 契约**

断言预览 URL 只保留导航所需字段；首次加载、刷新和 HMR 都由 Runtime Bootstrap 获取身份。

- [ ] **步骤 2：运行红灯测试**

```bash
pnpm vitest run tests/unit/app-dev-preview-url.test.ts tests/unit/app-dev-workbench-preview-auth.test.tsx
```

预期：现有实现仍向 URL 注入 Token，因此失败。

- [ ] **步骤 3：删除 Token Selector 和 Query 注入**

`AppDevWorkbenchStage` 只构造预览地址，不读取登录 Token；`app-dev-preview-url.ts` 删除身份字段拼接和兼容分支。

- [ ] **步骤 4：验证 UI 契约并提交**

```bash
pnpm vitest run tests/unit/app-dev-preview-url.test.ts tests/unit/app-dev-workbench-preview-auth.test.tsx
pnpm typecheck
git diff --check
git add src/pages/apps/components/AppDevWorkbenchStage.tsx src/utils/app-dev-preview-url.ts tests/unit/app-dev-preview-url.test.ts tests/unit/app-dev-workbench-preview-auth.test.tsx
git commit -m "fix: remove identity from app preview urls"
```

### 任务 10：定义并校验 code-deploy 注入契约

**文件：**
- 新建：`docs/contracts/sto-app-runtime-deploy-v1.md`
- 新建：`scripts/verify-sto-app-runtime-artifact.mjs`
- 新建：`tests/unit/sto-app-runtime-deploy-contract.test.ts`
- 外部修改：`code-deploy` Pipeline 的环境变量/运行时配置注入步骤。

**接口：**
- 依赖：发布请求中的 `env`、`applicationId` 和 `pageType`。
- 产出：构建变量或等价的不可变 Runtime 配置，以及可在 CI 中执行的产物校验器。

- [ ] **步骤 1：写清发布环境映射和 PageType 约束**

```text
env=daily -> deployEnv=daily, policy=test, SSO=daily
env=stage -> deployEnv=stage, policy=pre, SSO=pre
env=online -> deployEnv=online, policy=prod, SSO=prod
pageType=site -> require SSO systemCode; omit assetHostOrigin
pageType=assets -> require exact assetHostOrigin; no SSO redirect
```

文档同时规定：部署输入覆盖仓库默认值；浏览器 Query、Local Storage 和生成代码不能覆盖这些字段。

- [ ] **步骤 2：编写失败的部署契约测试**

覆盖三套环境、两个 PageType、缺失 `applicationId`、Site 缺少 `systemCode`、Assets 缺少精确宿主 Origin，以及 `pre`/`stage` 术语边界。

- [ ] **步骤 3：运行红灯测试**

```bash
pnpm vitest run tests/unit/sto-app-runtime-deploy-contract.test.ts
```

预期：产物校验脚本尚不存在，因此失败。

- [ ] **步骤 4：实现 CI 产物校验器**

```bash
node scripts/verify-sto-app-runtime-artifact.mjs <build-dir> --env daily --page-type site --application-id app-123
```

脚本读取任务 1 的共享 JSON，校验产物包含正确 PageType、环境、ApplicationId、Policy Origin 和必要的 SSO/宿主配置，并拒绝 Token、开发 Session Secret 及任意 Target URL。

- [ ] **步骤 5：接入外部 Pipeline，保存证据并提交仓库内契约**

```bash
pnpm vitest run tests/unit/sto-app-runtime-deploy-contract.test.ts
node scripts/verify-sto-app-runtime-artifact.mjs <daily-site-build-dir> --env daily --page-type site --application-id app-123
node scripts/verify-sto-app-runtime-artifact.mjs <daily-assets-build-dir> --env daily --page-type assets --application-id app-456
git diff --check
git add docs/contracts/sto-app-runtime-deploy-v1.md scripts/verify-sto-app-runtime-artifact.mjs tests/unit/sto-app-runtime-deploy-contract.test.ts
git commit -m "feat: define STO app runtime deployment contract"
```

外部 Pipeline 的变更单和运行日志作为验收证据，不将其伪装成当前仓库内的代码改动。

### 任务 11：更新 `sto-policy-database` Skill 的传输约定

**文件：**
- 外部修改：`/Users/linqiang/.stoclaw/skills-store/users/1207669/skills/sto-policy-database/SKILL.md`
- 外部修改：该 Skill 直接引用的传输说明与示例。
- 新建：`scripts/verify-sto-policy-database-skill.mjs`
- 新建：`tests/fixtures/sto-policy-database-skill/valid-operation.md`
- 新建：`tests/unit/sto-policy-database-skill-contract.test.ts`

**接口：**
- 依赖：任务 3 的九个固定 Policy Operation 和 `@sto/app-runtime` 调用方式。
- 产出：同时支持 CLI 发现/验证与浏览器 HTTP 运行时生成的 Skill 说明。

- [ ] **步骤 1：编写失败的 Skill 规则测试**

断言 Skill 不再要求每个应用创建 SCloud/BFF；必须只允许九个固定 Action；生成代码不得指定 Host、转发 Token、使用 Cookie 凭据或构造任意 URL。

- [ ] **步骤 2：运行红灯测试**

```bash
pnpm vitest run tests/unit/sto-policy-database-skill-contract.test.ts
```

预期：现有 Skill 仍以原传输方式描述，因此失败。

- [ ] **步骤 3：重写传输矩阵和生成规则**

```text
SClaw 发现/验证：精确 sai-cli policy ontology Action 或精确 Policy HTTP Action
生成应用本地：@sto/app-runtime -> Vite 同源代理
发布 Site：@sto/app-runtime -> Site SSO Token 直连 Policy HTTP
发布 Assets：@sto/app-runtime -> 宿主 Token 直连 Policy HTTP
```

把“必须创建 BFF”改为“声明 Operation，由 Runtime 选择传输”；每个示例都使用 `operationId`、固定 Action 和结构化 Payload。

- [ ] **步骤 4：运行完整 Skill 校验**

```bash
node scripts/verify-sto-policy-database-skill.mjs /Users/linqiang/.stoclaw/skills-store/users/1207669/skills/sto-policy-database
pnpm vitest run tests/unit/sto-policy-database-skill-contract.test.ts
git diff --check
```

校验器递归检查 Skill 引用的文档，避免只修改入口文件而遗漏旧示例。

- [ ] **步骤 5：提交仓库内校验器**

```bash
git add scripts/verify-sto-policy-database-skill.mjs tests/fixtures/sto-policy-database-skill/valid-operation.md tests/unit/sto-policy-database-skill-contract.test.ts
git commit -m "test: enforce STO policy skill transport contract"
```

Skill 位于当前仓库外，不纳入此 Git 提交；实施时单独记录其版本或变更快照。

### 任务 12：接入 Assets 宿主并完成四场景验收

**文件：**
- 外部修改：SClaw Assets Iframe 宿主的挂载组件。
- 新建：`tests/e2e/fixtures/sto-app-runtime-site-app/`
- 新建：`tests/e2e/fixtures/sto-app-runtime-assets-app/`
- 新建：`tests/e2e/sto-app-runtime-contexts.spec.ts`
- 修改：`packages/sto-app-runtime/README.md`

**接口：**
- 依赖：`createStoAssetsHost()`、发布产物配置和 SClaw 当前登录 Session。
- 产出：本地 Site、本地 Assets、发布 Site、发布 Assets 四种上下文的一致应用调用接口。

- [ ] **步骤 1：在宿主中挂载受约束的 Assets Bridge**

```ts
export function mountAssetsRuntimeHost(input: {
  applicationId: string;
  artifactUrl: string;
  iframe: HTMLIFrameElement;
  getCurrentSession(): Promise<{
    token: string;
    user: StoRuntimeUser;
    deployEnv: StoDeployEnv;
  }>;
}) {
  return createStoAssetsHost({
    applicationId: input.applicationId,
    iframe: input.iframe,
    assetOrigin: new URL(input.artifactUrl).origin,
    getSession: input.getCurrentSession,
  });
}
```

宿主只能向精确 Origin、精确 `applicationId` 的 Iframe 发送短生命周期 Session；Iframe 销毁、用户登出或身份切换时立即撤销。

- [ ] **步骤 2：创建最小 Site/Assets Fixture**

两个 Fixture 使用完全相同的业务代码调用九个 Operation 中至少一个，只允许引导方式不同；Fixture 暴露当前 PageType、DeployEnv、用户和请求结果供测试断言。

- [ ] **步骤 3：编写四上下文端到端测试**

覆盖：本地预览无 CORS、发布 Site 无 Token 时 SSO 回跳、发布 Assets 不触发 SSO 且从宿主获得身份、错误 Origin/ApplicationId 被拒绝，以及 URL/日志/产物均无 Token。

- [ ] **步骤 4：运行完整验证矩阵**

```bash
pnpm vitest run tests/unit/sto-app-runtime-contract.test.ts tests/unit/app-runtime-local-session.test.ts tests/unit/app-dev-preview-url.test.ts tests/unit/app-dev-workbench-preview-auth.test.tsx tests/unit/react-a2ui-runtime-template.test.ts tests/unit/sto-app-runtime-deploy-contract.test.ts tests/unit/sto-policy-database-skill-contract.test.ts
npm --prefix packages/sto-app-runtime test
npm --prefix packages/sto-app-runtime run typecheck
npm --prefix packages/sto-app-runtime run build
npm --prefix resources/app-templates/react-a2ui-template run typecheck
npm --prefix resources/app-templates/react-a2ui-template run build
pnpm playwright test tests/e2e/sto-app-runtime-contexts.spec.ts
pnpm typecheck
pnpm build
git diff --check
```

- [ ] **步骤 5：执行真实 Daily 冒烟验证**

使用测试账号和测试应用验证：Site 首次 SSO、Site 已登录直连、Assets 宿主身份注入、本地 Vite 代理，以及至少一个真实 Policy Database Action。保存去敏后的 Network 截图、发布配置和测试应用 ID。

- [ ] **步骤 6：更新文档并提交**

```bash
git add packages/sto-app-runtime/README.md tests/e2e
git commit -m "test: verify STO app runtime across hosting contexts"
```

- [ ] **步骤 7：仅在审批后发布 Runtime**

```bash
npm publish --registry=http://snpm-registry.sto.cn
```

发布属于外部状态变更，不在普通实现任务中自动执行；必须先确认版本号、Registry 权限和发布审批。

## 实施前自检

- [ ] **设计覆盖：** 每项已确认需求都能映射到任务、接口和验收测试。
- [ ] **边界清晰：** `@sto/app-runtime`、SClaw Host、code-deploy、模板和 Skill 的职责没有相互泄漏。
- [ ] **类型一致：** JSON 契约、TypeScript 导出、部署校验器和 Skill 校验器使用相同 Action、环境与 PageType 枚举。
- [ ] **无占位描述：** 不包含需要实施者自行猜测的待补充标记或“以后实现”。
- [ ] **脏工作区安全：** 不覆盖、不暂存 `electron/services/app-dev-service.ts` 中用户已有的修改。

## 执行方式

计划确认后可选择：

1. **子代理驱动（推荐，`Subagent-Driven`）：** 在当前会话中按任务逐项委派，每项完成后进行契约和代码复核。
2. **内联执行（`Inline Execution`）：** 在单一执行上下文中按任务顺序实施，并在每个提交点运行对应验证。
