# SClaw SSO Auth Plugin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 构建单一 npm 包 `@sto/sclaw-plugin-sso-auth`，让新建 Site 应用在本地使用当前 SClaw 身份、发布后自动完成 STO SSO，并保证 Assets 应用永不加载该插件。

**Architecture:** `@sto/sclaw-plugin-sso-auth` 同时提供浏览器认证 API、插件 Runtime 入口和 Vite 开发入口。SClaw/应用模板负责静态插件装配，不再创建额外的通用 Runtime npm 包；本地预览通过短期 Session Secret 和 Vite 同源端点取得当前 SClaw 身份，发布 Site 则执行 Cookie 检查、登录跳转和 Code 换票。

**Tech Stack:** TypeScript 5.9、tsup 8、Vitest 4、Vite 5–7、React 19、Electron Host API、公司内部 npm。

**Spec:** `docs/superpowers/specs/2026-08-27-sso-auth-plugin-design.md`。

## Global Constraints

- 唯一正式 npm 包名是 `@sto/sclaw-plugin-sso-auth`，不得再创建同义或通用 Runtime 包。
- 插件只支持 `pageType: "site"`；Assets 应用不得安装、导入或启动它。
- 本地 Site 预览使用当前登录 SClaw 的用户身份，不执行浏览器 SSO 跳转。
- 发布 Site 缺少有效 Token 时必须跳转 SSO；回跳后使用 Code 换取 `stoToken`。
- 发布环境以注入的 SSO Auth 配置为权威来源；Hostname 和 `VITE_SSO_ENV` 只允许作为旧应用兼容回退。
- Token Cookie 必须为 host-only，包含 `Path=/`、`SameSite=Lax`，HTTPS 下包含 `Secure`，禁止设置 `Domain`。
- Token、回跳 Code、Session Secret 不得进入 URL、源码、构建产物、日志、埋点或错误响应。
- URL 清理只能删除认证参数，必须保留业务 Query 与 Hash Route。
- 本地 Session Secret 只能存在于 Electron 主进程和 Vite 服务端环境变量中，不能注入 HTML 或浏览器 Bundle。
- npm 包必须发布编译后的 ESM、CJS 和类型声明；版本由 `package.json.version` 与应用 `package-lock.json` 固化。
- 本计划不实现 Policy HTTP、Policy Operation、Assets Host Bridge、插件市场 UI、插件升级或卸载。
- 不修改既有 `packages/sto-policy-ontology-sdk`。
- 不发布 npm 包、不发布模板、不推送远程，除非用户在执行阶段明确授权。

---

## File Structure

### `@sto/sclaw-plugin-sso-auth`

- `packages/sclaw-plugin-sso-auth/package.json`：内部 npm 元数据及 `.`、`./runtime`、`./vite` 导出。
- `packages/sclaw-plugin-sso-auth/tsconfig.json`：严格 TypeScript 配置。
- `packages/sclaw-plugin-sso-auth/tsup.config.ts`：三个入口的构建配置。
- `packages/sclaw-plugin-sso-auth/vitest.config.ts`：Node 测试环境。
- `packages/sclaw-plugin-sso-auth/src/types.ts`：配置、用户、会话、插件和认证接口。
- `packages/sclaw-plugin-sso-auth/src/config.ts`：配置读取、环境兼容回退和严格校验。
- `packages/sclaw-plugin-sso-auth/src/errors.ts`：安全错误模型。
- `packages/sclaw-plugin-sso-auth/src/index.ts`：`bootstrapSsoAuth()`、`getSsoAuth()` 公共入口。
- `packages/sclaw-plugin-sso-auth/src/runtime.ts`：供静态注册表导入的插件入口。
- `packages/sclaw-plugin-sso-auth/src/provider.ts`：本地和发布态 Provider 选择。
- `packages/sclaw-plugin-sso-auth/src/site-sso.ts`：发布态 SSO 状态机。
- `packages/sclaw-plugin-sso-auth/src/local-auth.ts`：本地身份 Bootstrap。
- `packages/sclaw-plugin-sso-auth/src/session.ts`：Cookie、用户存储和内存 Session。
- `packages/sclaw-plugin-sso-auth/src/sso-url.ts`：登录与换票 URL 构造。
- `packages/sclaw-plugin-sso-auth/src/browser-platform.ts`：可测试浏览器 API 适配层。
- `packages/sclaw-plugin-sso-auth/src/vite.ts`：Vite 公共入口。
- `packages/sclaw-plugin-sso-auth/src/vite/plugin.ts`：本地公开配置注入和同源身份端点。
- `packages/sclaw-plugin-sso-auth/sclaw/plugin.json`：插件 Manifest。
- `packages/sclaw-plugin-sso-auth/sclaw/schemas/config.schema.json`：公开配置 Schema。
- `packages/sclaw-plugin-sso-auth/sclaw/skills/sso-auth/SKILL.md`：AI 开发边界。
- `packages/sclaw-plugin-sso-auth/tests/*.test.ts`：包契约、配置、SSO、本地身份与 Vite 测试。

### SClaw 本地身份桥接

- `electron/services/sso-auth-local-session.ts`：预览 Session 创建、校验和销毁。
- `electron/services/app-dev-server-manager.ts`：向 Vite 注入服务端环境变量，并同步 Session 生命周期。
- `electron/api/routes/app-dev.ts`：受 Secret 保护的本地身份 Bootstrap 路由。
- `tests/unit/sso-auth-local-session.test.ts`：Session 生命周期与越权测试。
- `tests/unit/sso-auth-bootstrap-route.test.ts`：Host API 身份和敏感信息测试。

### Site 模板接入

- `resources/app-templates/site-minimal/package.json`：默认依赖 SSO Auth 插件。
- `resources/app-templates/site-minimal/vite.config.ts`：启用 `ssoAuthVite()`。
- `resources/app-templates/site-minimal/src/main.tsx`：认证完成后挂载应用。
- `resources/app-templates/site-minimal/src/sclaw/plugin-host.ts`：模板内最小插件激活与能力注册。
- `resources/app-templates/site-minimal/src/sclaw/plugins.generated.ts`：默认静态导入 SSO Auth。
- `resources/app-templates/site-minimal/src/sclaw/bootstrap.ts`：启动生成插件列表。
- `resources/app-templates/site-minimal/src/components/RuntimeBootstrapShell.tsx`：通用 Loading/Error 展示。
- `resources/app-templates/site-minimal/.env.example`：本地兼容配置说明。
- `resources/app-templates/site-minimal/README.md`：Site SSO 基础能力说明。
- `tests/unit/builtin-app-template-resources.test.ts`：Site/Assets 差异契约。
- `tests/unit/site-minimal-sso-auth-contract.test.ts`：Site 静态装配测试。

### 移除预览 URL Token

- `src/components/app-dev/AppDevWorkbenchStage.tsx`：不再读取 Token 或注入预览 URL。
- `src/lib/app-dev-preview-url.ts`：仅清理旧认证 Query。
- `tests/unit/app-dev-preview-url.test.ts`：干净预览 URL 契约。
- `tests/unit/app-dev-workbench-preview-auth.test.tsx`：工作台不传递 Token。

---

### Task 1: Scaffold the Single SSO Auth Plugin Package

**Files:**
- Create: `packages/sclaw-plugin-sso-auth/package.json`
- Create: `packages/sclaw-plugin-sso-auth/package-lock.json`
- Create: `packages/sclaw-plugin-sso-auth/README.md`
- Create: `packages/sclaw-plugin-sso-auth/tsconfig.json`
- Create: `packages/sclaw-plugin-sso-auth/tsup.config.ts`
- Create: `packages/sclaw-plugin-sso-auth/vitest.config.ts`
- Create: `packages/sclaw-plugin-sso-auth/src/types.ts`
- Create: `packages/sclaw-plugin-sso-auth/src/config.ts`
- Create: `packages/sclaw-plugin-sso-auth/src/errors.ts`
- Create: `packages/sclaw-plugin-sso-auth/src/index.ts`
- Create: `packages/sclaw-plugin-sso-auth/src/runtime.ts`
- Create: `packages/sclaw-plugin-sso-auth/src/vite.ts`
- Create: `packages/sclaw-plugin-sso-auth/sclaw/plugin.json`
- Create: `packages/sclaw-plugin-sso-auth/sclaw/schemas/config.schema.json`
- Create: `packages/sclaw-plugin-sso-auth/sclaw/skills/sso-auth/SKILL.md`
- Create: `packages/sclaw-plugin-sso-auth/tests/package-contract.test.ts`
- Create: `packages/sclaw-plugin-sso-auth/tests/config.test.ts`

**Interfaces:**
- Consumes: Site/Assets `pageType` 语义和发布环境 `daily | stage | online`。
- Produces: `StoSsoAuthConfig`、`StoSsoUser`、`StoSsoAuth`、`SclawFrontendPlugin`、`readStoSsoAuthConfig()`、三个 npm 入口。

- [ ] **Step 1: Create package metadata and build configuration**

Use this exact package identity:

```json
{
  "name": "@sto/sclaw-plugin-sso-auth",
  "version": "0.1.0",
  "description": "Site SSO authentication plugin for SClaw applications",
  "license": "UNLICENSED",
  "type": "module",
  "main": "./dist/index.cjs",
  "module": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "sideEffects": false,
  "files": ["dist/**", "sclaw/**", "README.md"],
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js",
      "require": "./dist/index.cjs"
    },
    "./runtime": {
      "types": "./dist/runtime.d.ts",
      "import": "./dist/runtime.js",
      "require": "./dist/runtime.cjs"
    },
    "./vite": {
      "types": "./dist/vite.d.ts",
      "import": "./dist/vite.js",
      "require": "./dist/vite.cjs"
    }
  },
  "sclaw": { "manifest": "./sclaw/plugin.json" },
  "peerDependencies": { "vite": ">=5.4 <8" },
  "peerDependenciesMeta": { "vite": { "optional": true } },
  "devDependencies": {
    "@types/node": "^25.3.0",
    "tsup": "^8.5.0",
    "typescript": "^5.9.3",
    "vite": "^7.3.1",
    "vitest": "^4.0.18"
  },
  "publishConfig": { "registry": "http://snpm-registry.sto.cn" },
  "scripts": {
    "build": "tsup",
    "test": "vitest run --testTimeout=30000",
    "typecheck": "tsc --noEmit",
    "prepublishOnly": "npm run test && npm run typecheck && npm run build"
  },
  "engines": { "node": ">=18" }
}
```

`tsup.config.ts` uses `src/index.ts`, `src/runtime.ts`, and `src/vite.ts` as entries, emits ESM/CJS, declarations, and Source Maps, and externalizes `vite`.

- [ ] **Step 2: Write the failing package and config contract tests**

Package assertions:

```ts
expect(pkg).toMatchObject({
  name: '@sto/sclaw-plugin-sso-auth',
  version: '0.1.0',
  sclaw: { manifest: './sclaw/plugin.json' }
});
expect(manifest).toMatchObject({
  schemaVersion: 1,
  id: 'sto.sso-auth',
  pageTypes: ['site'],
  runtime: { entry: './runtime', activation: 'bootstrap' },
  provides: { hostCapabilities: ['auth.sto-token'] }
});
```

Config assertions:

```ts
const publishedSite = {
  protocolVersion: 'sto-sso-auth/v1',
  applicationId: 'app-1001',
  pageType: 'site',
  runtimeMode: 'published',
  deployEnv: 'daily',
  sso: {
    environment: 'daily',
    systemCode: 'STO_CLAW_APP',
    loginOrigin: 'https://baseinfo-usercenterserviceapi-hq-test.sto.cn',
    apiOrigin: 'https://baseinfo-usercenterapi-hq-test.sto.cn'
  }
} as const;

expect(readStoSsoAuthConfig(publishedSite)).toEqual(publishedSite);
expect(() => readStoSsoAuthConfig({ ...publishedSite, pageType: 'assets' }))
  .toThrowError(expect.objectContaining({ code: 'SSO_AUTH_PAGE_TYPE_UNSUPPORTED' }));
expect(() => readStoSsoAuthConfig({ ...publishedSite, stoToken: 'secret-a' }))
  .toThrowError(expect.objectContaining({ code: 'SSO_AUTH_CONFIG_INVALID' }));
```

- [ ] **Step 3: Run tests and verify the red state**

```bash
npm --prefix packages/sclaw-plugin-sso-auth install
npm --prefix packages/sclaw-plugin-sso-auth test
```

Expected: FAIL because contracts and package assets are not implemented.

- [ ] **Step 4: Implement exact public types and safe errors**

```ts
export type StoSsoDeployEnv = 'daily' | 'stage' | 'online';
export type StoSsoEnvironment = 'daily' | 'pre' | 'prod';

export interface StoSsoAuthConfig {
  protocolVersion: 'sto-sso-auth/v1';
  applicationId: string;
  pageType: 'site';
  runtimeMode: 'local' | 'published';
  deployEnv: StoSsoDeployEnv;
  sso?: {
    environment: StoSsoEnvironment;
    systemCode: string;
    loginOrigin: string;
    apiOrigin: string;
  };
}

export interface StoSsoAuth {
  bootstrap(): Promise<void>;
  getToken(): string | null;
  getUser(): StoSsoUser | null;
  logout(): Promise<void>;
  handleUnauthorized(): Promise<void>;
}

export interface SclawFrontendPluginContext {
  pageType: 'site' | 'assets';
  provide(key: 'auth.sto-token', value: StoSsoAuth): void;
}

export interface SclawFrontendPlugin {
  id: string;
  pageTypes: readonly ('site' | 'assets')[];
  activate(context: SclawFrontendPluginContext): Promise<void> | void;
}
```

`StoSsoAuthError` allows only the codes defined by the design and an optional safe `traceId`. Its constructor cannot accept raw Headers, request bodies, Token, Code, Cookie, or arbitrary serialized Cause.

- [ ] **Step 5: Implement strict config resolution**

Resolution order is fixed:

1. Explicit `bootstrapSsoAuth({ config })` value.
2. `window.__STO_SSO_AUTH_CONFIG__`.
3. Local-only compatibility values generated by the Vite entry.

Published Site config requires HTTPS `loginOrigin` and `apiOrigin`, non-empty `applicationId` and `systemCode`, and a complete SSO object. Reject unknown root and SSO fields.

- [ ] **Step 6: Create Manifest, Schema, Skill, and fail-closed entry shells**

`SKILL.md` must require:

- Business pages never reimplement login.
- Site code uses `getSsoAuth()` when it needs current identity.
- Assets code never imports this package.
- Token is never logged, added to source, or passed in URL Query.

Until Task 2 implements behavior, `bootstrapSsoAuth()` must fail closed with `SSO_AUTH_CONFIG_MISSING`, and the `/runtime` plugin must reject Assets before calling Bootstrap.

- [ ] **Step 7: Verify package structure and commit**

```bash
npm --prefix packages/sclaw-plugin-sso-auth test
npm --prefix packages/sclaw-plugin-sso-auth run typecheck
npm --prefix packages/sclaw-plugin-sso-auth run build
test -f packages/sclaw-plugin-sso-auth/dist/index.js
test -f packages/sclaw-plugin-sso-auth/dist/runtime.js
test -f packages/sclaw-plugin-sso-auth/dist/vite.js
git diff --check
git add packages/sclaw-plugin-sso-auth
git commit -m "feat(sso-auth): scaffold the Site SSO plugin"
```

---

### Task 2: Implement the Published Site SSO State Machine

**Files:**
- Create: `packages/sclaw-plugin-sso-auth/src/provider.ts`
- Create: `packages/sclaw-plugin-sso-auth/src/site-sso.ts`
- Create: `packages/sclaw-plugin-sso-auth/src/session.ts`
- Create: `packages/sclaw-plugin-sso-auth/src/sso-url.ts`
- Create: `packages/sclaw-plugin-sso-auth/src/browser-platform.ts`
- Modify: `packages/sclaw-plugin-sso-auth/src/index.ts`
- Modify: `packages/sclaw-plugin-sso-auth/src/runtime.ts`
- Test: `packages/sclaw-plugin-sso-auth/tests/sso-url.test.ts`
- Test: `packages/sclaw-plugin-sso-auth/tests/session.test.ts`
- Test: `packages/sclaw-plugin-sso-auth/tests/site-sso.test.ts`
- Test: `packages/sclaw-plugin-sso-auth/tests/bootstrap.test.ts`

**Interfaces:**
- Consumes: published `StoSsoAuthConfig` and injected `fetch`.
- Produces: `createPublishedSiteSsoAuth()`、Single-flight `bootstrapSsoAuth()`、`getSsoAuth()` and Runtime plugin activation.

- [ ] **Step 1: Write failing URL and Cookie tests**

Cover the exact environment matrix from the design. Assert HTTPS Cookie output:

```ts
expect(cookieWrites[0]).toBe(
  'stoToken=token-a; Path=/; Max-Age=604800; SameSite=Lax; Secure'
);
expect(cookieWrites[0]).not.toContain('Domain=');
```

Login URL includes `autoLogin=false`, configured `systemCode`, and the complete current URL as encoded `returnUrl`.

- [ ] **Step 2: Write failing Bootstrap tests**

Cover:

1. Existing Cookie returns without network or redirect.
2. `code` and `authorizationCode` trigger the configured callback endpoint.
3. Response accepts `data.stoToken` and `data.userLogOnResult.stoToken`.
4. Successful exchange stores Token and user, then removes only auth Query keys.
5. `?filter=active&code=abc#/reports` becomes `?filter=active#/reports`.
6. Success response without Token returns `SSO_EXCHANGE_FAILED`.
7. No Cookie and no Code triggers exactly one redirect.
8. A second redirect for the same return URL returns `SSO_REDIRECT_LOOP`.
9. First 401 clears the session and redirects; repeated 401 returns `SSO_REDIRECT_LOOP`.
10. Concurrent Bootstrap calls share one exchange request.
11. Serialized errors contain neither Token nor Code.

- [ ] **Step 3: Run focused tests and verify the red state**

```bash
npm --prefix packages/sclaw-plugin-sso-auth test -- sso-url.test.ts session.test.ts site-sso.test.ts bootstrap.test.ts
```

Expected: FAIL because the state machine is absent.

- [ ] **Step 4: Implement the browser adapter**

```ts
export interface SsoBrowserPlatform {
  readonly href: string;
  readonly protocol: string;
  readonly cookie: string;
  setCookie(value: string): void;
  replaceUrl(pathAndQueryAndHash: string): void;
  redirect(url: string): void;
  getLocalStorage(key: string): string | null;
  setLocalStorage(key: string, value: string): void;
  removeLocalStorage(key: string): void;
  getSessionStorage(key: string): string | null;
  setSessionStorage(key: string, value: string): void;
  removeSessionStorage(key: string): void;
}
```

State-machine modules depend only on this interface. The production adapter is the only module allowed to access `window`, `document.cookie`, `history`, `localStorage`, and `sessionStorage`.

- [ ] **Step 5: Implement fixed storage keys and session rules**

```ts
export const TOKEN_COOKIE_KEY = 'stoToken';
export const USER_STORAGE_KEY = 'sto.sso-auth.user.v1';
export const REDIRECT_GUARD_KEY = 'sto.sso-auth.redirect.v1';
export const UNAUTHORIZED_GUARD_KEY = 'sto.sso-auth.unauthorized.v1';
```

Token is stored only in host-only Cookie and provider memory. User display data is stored in localStorage without Token. Guards use sessionStorage. Logout clears all state before redirecting.

- [ ] **Step 6: Implement the fixed Bootstrap order**

```ts
const callbackCode = readCallbackCode(platform.href);
if (callbackCode) await exchangeAndPersist(callbackCode);
else if (readTokenCookie(platform.cookie)) hydrateFromStorage();
else redirectToLoginOnce();
```

Exchange is fixed to:

```ts
await fetch(`${config.sso.apiOrigin}/sso/login/callback?code=${encodeURIComponent(code)}`, {
  method: 'GET',
  credentials: 'omit',
  headers: { Accept: 'application/json' }
});
```

Callers cannot override Origin, Path, Method, Code parameter name, or Headers.

- [ ] **Step 7: Implement Single-flight and plugin activation**

`bootstrapSsoAuth()` caches one Promise, publishes the initialized singleton only after success, and clears the Promise after failure. The Runtime entry rejects `context.pageType !== "site"`, initializes auth, then calls `context.provide('auth.sto-token', auth)`.

- [ ] **Step 8: Verify and commit published Site SSO**

```bash
npm --prefix packages/sclaw-plugin-sso-auth test
npm --prefix packages/sclaw-plugin-sso-auth run typecheck
npm --prefix packages/sclaw-plugin-sso-auth run build
git diff --check
git add packages/sclaw-plugin-sso-auth
git commit -m "feat(sso-auth): implement published Site SSO"
```

---

### Task 3: Add Secure Local Preview Identity

**Files:**
- Create: `electron/services/sso-auth-local-session.ts`
- Modify: `electron/services/app-dev-server-manager.ts`
- Modify: `electron/api/routes/app-dev.ts`
- Create: `tests/unit/sso-auth-local-session.test.ts`
- Create: `tests/unit/sso-auth-bootstrap-route.test.ts`
- Create: `packages/sclaw-plugin-sso-auth/src/local-auth.ts`
- Create: `packages/sclaw-plugin-sso-auth/src/vite/plugin.ts`
- Modify: `packages/sclaw-plugin-sso-auth/src/provider.ts`
- Modify: `packages/sclaw-plugin-sso-auth/src/vite.ts`
- Create: `packages/sclaw-plugin-sso-auth/tests/local-auth.test.ts`
- Create: `packages/sclaw-plugin-sso-auth/tests/vite-plugin.test.ts`

**Interfaces:**
- Consumes: Electron `getAuthState()`, `.sclaw/app-dev.json`, `.sto/workspace.json`, and SSO Auth config.
- Produces: `POST /api/app-dev/sso-auth/bootstrap`, `GET /__sto/sso-auth/bootstrap`, `ssoAuthVite()`, and local in-memory auth.

- [ ] **Step 1: Write failing Session lifecycle tests**

Use injectable random bytes and clock. Assert:

- Secret contains 32 bytes of URL-safe entropy.
- Creating a second Session for one Workspace invalidates the first.
- Workspace ID, app path, Secret, page type and expiry must match.
- Application ID comes from `.sto/workspace.json`; an unbound workspace uses `local:<workspaceId>`.
- Session expires after 12 hours.
- Destroy immediately invalidates the Session.
- Public config contains neither Secret nor Host API URL.

- [ ] **Step 2: Implement the Session service**

```ts
export interface SsoAuthLocalSession {
  workspaceId: string;
  appPath: string;
  applicationId: string;
  pageType: 'site' | 'assets';
  secret: string;
  expiresAt: number;
}

export function createSsoAuthLocalSession(input: {
  workspaceId: string;
  appPath: string;
}): Promise<SsoAuthLocalSession>;

export function validateSsoAuthLocalSession(input: {
  workspaceId: string;
  secret: string;
}): SsoAuthLocalSession | null;

export function destroySsoAuthLocalSession(workspaceId: string): void;
```

Missing or invalid legacy page type normalizes to `site`, but the Bootstrap route rejects non-Site Sessions.

- [ ] **Step 3: Write failing Host route tests**

The route accepts only:

```text
POST /api/app-dev/sso-auth/bootstrap
x-sto-sso-auth-workspace: <workspace-id>
x-sto-sso-auth-session: <secret>
```

Assert invalid Session returns 403 before reading auth state; missing current Token returns 401 `AUTH_REQUIRED`; valid Session returns normalized `{ success: true, token, user }`; logger calls contain no Headers, Token, Secret, or response body.

- [ ] **Step 4: Implement the Host route**

Use `getAuthState()` from `electron/utils/auth-store.ts`. Require authenticated state, user, Token, and future `stoTokenExpiresAt`. Return only fields declared by `StoSsoUser`.

- [ ] **Step 5: Inject server-only values into Vite**

Before spawning Vite, create the Session and extend the child environment:

```ts
{
  ...getNodeSpawnEnv(),
  STO_SSO_AUTH_SESSION: session.secret,
  STO_SSO_AUTH_WORKSPACE_ID: workspaceId,
  STO_SSO_AUTH_APPLICATION_ID: session.applicationId,
  STO_SSO_AUTH_PAGE_TYPE: session.pageType,
  STO_SSO_AUTH_DEPLOY_ENV: 'daily',
  STO_SSO_AUTH_HOST_API: `http://127.0.0.1:${PORTS.CLAWX_HOST_API}`
}
```

Destroy the Session on explicit stop, restart replacement, child exit, readiness failure, final crash escalation, and Electron `before-quit`.

- [ ] **Step 6: Write failing Vite entry tests**

Invoke Vite hooks directly and assert:

- HTML receives `window.__STO_SSO_AUTH_CONFIG__` with `runtimeMode: "local"`.
- Injected HTML contains neither Secret nor Host API URL.
- `/__sto/sso-auth/bootstrap` forwards only server-side identity headers.
- Browser Query and Headers cannot override Workspace or Secret.
- Host 401/403 responses are normalized without sensitive echoes.

- [ ] **Step 7: Implement `ssoAuthVite()`**

```ts
export function ssoAuthVite(): Plugin;
```

The Vite entry reads only server environment variables, injects public SSO Auth config, and registers the same-origin middleware. Missing required server values fail Vite startup with `LOCAL_AUTH_UNAVAILABLE`.

- [ ] **Step 8: Implement the local Provider branch**

```ts
return config.runtimeMode === 'local'
  ? createLocalSsoAuth({ fetch })
  : createPublishedSiteSsoAuth({ config, fetch });
```

Local Provider requests `/__sto/sso-auth/bootstrap` with `credentials: "same-origin"`, stores Token and user only in module memory, and never touches Cookie, localStorage, sessionStorage, or redirect APIs.

- [ ] **Step 9: Run focused tests and commit**

```bash
pnpm vitest run tests/unit/sso-auth-local-session.test.ts tests/unit/sso-auth-bootstrap-route.test.ts
npm --prefix packages/sclaw-plugin-sso-auth test -- local-auth.test.ts vite-plugin.test.ts
npm --prefix packages/sclaw-plugin-sso-auth run typecheck
pnpm typecheck
git diff --check
git add electron/services/sso-auth-local-session.ts electron/services/app-dev-server-manager.ts electron/api/routes/app-dev.ts tests/unit/sso-auth-local-session.test.ts tests/unit/sso-auth-bootstrap-route.test.ts packages/sclaw-plugin-sso-auth
git commit -m "feat(sso-auth): use SClaw identity in local Site previews"
```

---

### Task 4: Make SSO Auth the Default Site Template Plugin

**Files:**
- Modify: `resources/app-templates/site-minimal/package.json`
- Modify: `resources/app-templates/site-minimal/vite.config.ts`
- Modify: `resources/app-templates/site-minimal/src/main.tsx`
- Create: `resources/app-templates/site-minimal/src/sclaw/plugin-host.ts`
- Create: `resources/app-templates/site-minimal/src/sclaw/plugins.generated.ts`
- Create: `resources/app-templates/site-minimal/src/sclaw/bootstrap.ts`
- Create: `resources/app-templates/site-minimal/src/components/RuntimeBootstrapShell.tsx`
- Modify: `resources/app-templates/site-minimal/.env.example`
- Modify: `resources/app-templates/site-minimal/README.md`
- Delete: `resources/app-templates/site-minimal/src/lib/sso.ts`
- Delete: `resources/app-templates/site-minimal/src/lib/sso-api.ts`
- Delete: `resources/app-templates/site-minimal/src/lib/sso-config.ts`
- Delete: `resources/app-templates/site-minimal/src/lib/auth-token.ts`
- Delete: `resources/app-templates/site-minimal/src/lib/session.ts`
- Delete: `resources/app-templates/site-minimal/src/components/SsoAuthShell.tsx`
- Delete: `resources/app-templates/site-minimal/scripts/sso-env.mjs`
- Modify: `tests/unit/builtin-app-template-resources.test.ts`
- Create: `tests/unit/site-minimal-sso-auth-contract.test.ts`

**Interfaces:**
- Consumes: plugin Runtime default export, `ssoAuthVite()`, and `StoSsoAuth`.
- Produces: Site templates with static plugin registration and no copied SSO implementation.

- [ ] **Step 1: Write failing Site/Assets contract tests**

```ts
expect(sitePackage.dependencies).toMatchObject({
  '@sto/sclaw-plugin-sso-auth': '0.1.0'
});
expect(siteVite).toContain('ssoAuthVite');
expect(siteRegistry).toContain("@sto/sclaw-plugin-sso-auth/runtime");
expect(assetsPackage.dependencies).not.toHaveProperty('@sto/sclaw-plugin-sso-auth');
expect(assetsMain).not.toContain('@sto/sclaw-plugin-sso-auth');
```

Also assert the Site template no longer contains `buildSsoLoginUrl`, `checkAndRedirectToLogin`, `/sso-api`, `VITE_SSO_ENV`, or Token Query parsing.

- [ ] **Step 2: Run tests and verify the red state**

```bash
pnpm vitest run tests/unit/builtin-app-template-resources.test.ts tests/unit/site-minimal-sso-auth-contract.test.ts
```

Expected: FAIL because the Site template still owns SSO code.

- [ ] **Step 3: Add the exact dependency and Vite entry**

Add `"@sto/sclaw-plugin-sso-auth": "0.1.0"` to Site dependencies. Keep existing React, A2UI, antd, TypeScript, Vite, Rollup override, build output and external-service proxy behavior unchanged.

Vite plugins must be ordered:

```ts
plugins: [ssoAuthVite(), react()]
```

Remove the standalone `/sso-api` proxy and `scripts/sso-env.mjs` import.

- [ ] **Step 4: Implement the template-local plugin host**

`plugin-host.ts` defines a small structural interface, activates plugins in order, rejects unsupported page types, rejects duplicate capability keys, and returns the registered `auth.sto-token` capability. It does not contain SSO URLs, Cookie logic, environment mapping, or Token persistence.

```ts
export async function activateInstalledPlugins(
  plugins: readonly InstalledFrontendPlugin[],
  pageType: 'site' | 'assets'
): Promise<{ auth: StoSsoAuth }>;
```

- [ ] **Step 5: Add static plugin registration**

```ts
// Generated by SClaw. Do not edit manually.
import ssoAuthPlugin from '@sto/sclaw-plugin-sso-auth/runtime';

export const installedPlugins = [ssoAuthPlugin] as const;
```

`bootstrap.ts` calls `activateInstalledPlugins(installedPlugins, 'site')` and returns the registered auth capability.

- [ ] **Step 6: Replace template-owned SSO startup**

`main.tsx` renders a generic loading shell, calls the SClaw Bootstrap, then renders `<App />`. Failure renders a generic error and “重新加载” button. It must not inspect SSO error codes, read Cookies, build login URLs, or call callback APIs.

- [ ] **Step 7: Remove duplicated Site SSO files**

Before deletion:

```bash
rg -n "lib/(sso|sso-api|sso-config|auth-token|session)|SsoAuthShell|sso-env" resources/app-templates/site-minimal
```

Expected before: matches only in files being replaced/deleted. Expected after deletion: no matches.

- [ ] **Step 8: Update README and `.env.example`**

Document that SSO comes from the npm plugin, local identity comes from SClaw, and deployment injects `window.__STO_SSO_AUTH_CONFIG__`. Remove `VITE_SSO_ENV`, `VITE_SSO_BASE_URL`, `VITE_SSO_API_BASE_URL`, and `VITE_SSO_API_PROXY_TARGET`. Do not add Token values.

- [ ] **Step 9: Verify and commit the template migration**

```bash
pnpm vitest run tests/unit/builtin-app-template-resources.test.ts tests/unit/site-minimal-sso-auth-contract.test.ts
pnpm typecheck
git diff --check
git add resources/app-templates/site-minimal tests/unit/builtin-app-template-resources.test.ts tests/unit/site-minimal-sso-auth-contract.test.ts
git commit -m "feat(app-template): use the Site SSO auth plugin"
```

---

### Task 5: Remove Authentication Data from Preview URLs

**Files:**
- Modify: `src/components/app-dev/AppDevWorkbenchStage.tsx`
- Modify: `src/lib/app-dev-preview-url.ts`
- Modify: `tests/unit/app-dev-preview-url.test.ts`
- Create: `tests/unit/app-dev-workbench-preview-auth.test.tsx`

**Interfaces:**
- Consumes: Task 3 local same-origin identity Bootstrap.
- Produces: preview URLs without Token or Code.

- [ ] **Step 1: Replace URL injection tests with cleanup tests**

```ts
expect(stripLegacyAppDevPreviewAuth(
  'http://127.0.0.1:58967/?stoToken=tok-1&x=1#/home'
)).toBe('http://127.0.0.1:58967/?x=1#/home');

expect(stripLegacyAppDevPreviewAuth(
  'http://127.0.0.1:58967/?code=abc&authorizationCode=def#/home'
)).toBe('http://127.0.0.1:58967/#/home');
```

Delete the exported `injectAppDevPreviewStoToken()` contract. Rename cleanup to `stripLegacyAppDevPreviewAuth()`.

- [ ] **Step 2: Write the failing workbench test**

Mock auth state and assert preview mount, refresh, navigation, address display, and open-in-browser paths never append `stoToken`, `token`, `code`, or `authorizationCode`.

- [ ] **Step 3: Run tests and verify the red state**

```bash
pnpm vitest run tests/unit/app-dev-preview-url.test.ts tests/unit/app-dev-workbench-preview-auth.test.tsx
```

Expected: FAIL because the workbench still injects Token.

- [ ] **Step 4: Remove renderer Token injection**

Delete the Token selector and `withPreviewAuth`. Pass clean preview URLs directly to the iframe. Apply `stripLegacyAppDevPreviewAuth()` only to historical or user-entered addresses.

- [ ] **Step 5: Verify source and tests**

```bash
rg -n "injectAppDevPreviewStoToken|withPreviewAuth|stoToken=" src/components/app-dev src/lib/app-dev-preview-url.ts
pnpm vitest run tests/unit/app-dev-preview-url.test.ts tests/unit/app-dev-workbench-preview-auth.test.tsx
pnpm typecheck
git diff --check
```

Expected: `rg` returns no matches and all checks PASS.

- [ ] **Step 6: Commit the clean preview flow**

```bash
git add src/components/app-dev/AppDevWorkbenchStage.tsx src/lib/app-dev-preview-url.ts tests/unit/app-dev-preview-url.test.ts tests/unit/app-dev-workbench-preview-auth.test.tsx
git commit -m "fix(app-dev): remove auth data from preview urls"
```

---

### Task 6: Verify Packaging, Deployment Contract, and Security

**Files:**
- Create: `scripts/verify-sso-auth-package.mjs`
- Create: `tests/unit/sso-auth-package-security.test.ts`
- Create: `docs/contracts/sclaw-sso-auth-runtime-v1.md`
- Modify: `packages/sclaw-plugin-sso-auth/README.md`

**Interfaces:**
- Consumes: Tasks 1–5.
- Produces: reproducible package/template verification and the code-deploy handoff contract.

- [ ] **Step 1: Write failing package security tests**

Pack the local package into a temporary directory and assert:

- Tarball contains `dist/index.js`, `dist/runtime.js`, `dist/vite.js`, declarations, Manifest, Schema and Skill.
- Tarball excludes `src/`, `tests/`, `.env`, npm credentials, Token fixtures and absolute developer paths.
- Manifest paths resolve inside the unpacked package root.
- Assets template has no dependency/import for this package.

- [ ] **Step 2: Create the verification script**

The script must:

1. Run plugin test, typecheck and build.
2. Run `npm pack --json` into a `mkdtemp` directory.
3. Inspect tarball file lists.
4. Copy `site-minimal` into the temporary directory.
5. Replace version `0.1.0` in the temporary copy with the exact local `.tgz` path.
6. Run `npm install --ignore-scripts --no-audit --no-fund` in the temporary Site.
7. Run `npm run typecheck` and `npm run build` in the temporary Site.
8. Scan `build/` for `SKILL.md`, `stoToken=`, `x-sto-sso-auth-session`, `STO_SSO_AUTH_SESSION`, and absolute `/Users/` paths.
9. Remove the temporary directory in `finally`.

The script must not modify checked-in template files or create repository-local `.tgz` files.

- [ ] **Step 3: Document the code-deploy configuration contract**

```js
window.__STO_SSO_AUTH_CONFIG__ = {
  protocolVersion: 'sto-sso-auth/v1',
  applicationId: 'resolved-by-code-deploy',
  pageType: 'site',
  runtimeMode: 'published',
  deployEnv: 'daily',
  sso: {
    environment: 'daily',
    systemCode: 'STO_CLAW_APP',
    loginOrigin: 'https://baseinfo-usercenterserviceapi-hq-test.sto.cn',
    apiOrigin: 'https://baseinfo-usercenterapi-hq-test.sto.cn'
  }
};
```

Document the exact daily/stage/online matrix, no-secret rule, and build failure behavior when required fields are missing. Actual code-deploy changes use a separate plan in that repository.

- [ ] **Step 4: Run the complete automated matrix**

```bash
pnpm vitest run \
  tests/unit/sso-auth-local-session.test.ts \
  tests/unit/sso-auth-bootstrap-route.test.ts \
  tests/unit/builtin-app-template-resources.test.ts \
  tests/unit/site-minimal-sso-auth-contract.test.ts \
  tests/unit/app-dev-preview-url.test.ts \
  tests/unit/app-dev-workbench-preview-auth.test.tsx \
  tests/unit/sso-auth-package-security.test.ts
npm --prefix packages/sclaw-plugin-sso-auth test
npm --prefix packages/sclaw-plugin-sso-auth run typecheck
npm --prefix packages/sclaw-plugin-sso-auth run build
node scripts/verify-sso-auth-package.mjs
pnpm typecheck
git diff --check
```

Expected: every command PASS; Runtime is bundled, and no Skill or credential marker appears in the Site output.

- [ ] **Step 5: Manually verify local and published Site**

Local:

1. Start SClaw while logged in.
2. Create a Site app from `site-minimal`.
3. Open embedded preview and confirm URL has no Token or Code.
4. Refresh twice and confirm no SSO redirect.
5. Confirm the application receives a non-empty current user without displaying the Token.

Published simulation:

1. Serve the built Site over HTTPS with published config injected.
2. Start without Cookie and confirm one SSO redirect.
3. Return with a test Code and confirm one exchange.
4. Confirm business Query and Hash remain while Code is removed.
5. Confirm repeated unauthorized responses stop at `SSO_REDIRECT_LOOP`.

- [ ] **Step 6: Commit verification and contracts**

```bash
git add scripts/verify-sso-auth-package.mjs tests/unit/sso-auth-package-security.test.ts docs/contracts/sclaw-sso-auth-runtime-v1.md packages/sclaw-plugin-sso-auth/README.md
git commit -m "test(sso-auth): verify package and security boundaries"
```

---

## Completion Gate

Implementation is complete only when:

- `@sto/sclaw-plugin-sso-auth` produces valid `.`、`./runtime` and `./vite` npm entries.
- No second or synonymous Runtime npm package is introduced.
- Site templates statically import the SSO Auth Runtime.
- Assets templates do not depend on or import the plugin.
- Local Site obtains current SClaw identity through the same-origin endpoint.
- Preview URLs contain no Token or Code.
- Published Site completes SSO callback exchange and URL cleanup.
- Token Cookie is host-only and secure.
- Session Secret never reaches the browser.
- Package tests, root tests, typecheck, template build and security scans all pass.
- No npm package, template, or remote branch is published without explicit user authorization.
