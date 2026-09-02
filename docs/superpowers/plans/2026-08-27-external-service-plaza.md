# 外部服务广场与应用绑定 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 SClaw 中实现全局外部服务管理、当前应用受控绑定、Agent 搜索/绑定、本地 Vite 代理和发布 Site 环境解析。

**Architecture:** memory-center 是外部服务配置和版本的权威来源；SClaw 通过既有鉴权客户端读取固定版本并把完整公开快照写入应用 Git。`external-services.v1.json` 是应用事实来源，`dev-proxy.v1.json` 和 `services.generated.ts` 是可重建生成物；本地固定走 daily Vite Proxy，发布 Site 从 SSO Auth 发布配置读取 deployEnv 后直连对应服务。

**Tech Stack:** Electron、React 19、TypeScript 5.9、Vite、Vitest、Testing Library、Node.js scripts

**Spec:** `docs/superpowers/specs/2026-08-27-external-service-plaza-design.md`

## Global Constraints

- 不创建隔离 worktree。
- 不引入 `@sto/sclaw-plugin-external-services` npm 包。
- 外部服务只有一份 JSON 配置；不接 OSS、服务 ZIP、独立 Skill 包或 OpenAPI。
- `external-services.v1.json` 保存已发布版本的完整公开快照；Token、Cookie、SSO code、本地 Session Secret 不得写入应用文件、URL或日志。
- `dev-proxy.v1.json` 继续存在，但只负责本地 daily 代理；必须保留用户已有的非托管代理条目。
- 发布环境仍由现有 `daily / stage / online` 发布弹窗选择；Agent 绑定服务时不选择环境。
- Site 发布使用 SSO Auth 发布配置中的 deployEnv 和 stoToken；Assets 发布身份 Bridge 不在第一期实现。
- Site 和 Assets 的本地预览都必须能够使用当前 SClaw 登录身份；Assets 仍禁止发布后自行执行 SSO 跳转。
- 所有 memory-center 纯透传请求复用 `/ai-memory/agent/v1/*`；只有本地文件、依赖安装和生成操作新增专用 Host API。
- 当前工作区已有其他未提交改动；实施时不得覆盖或提交无关变更。未经用户明确要求，不执行 git commit 或 push。

---

### Task 1: memory-center 外部服务客户端和 Renderer API

**Files:**
- Create: `shared/external-service-contract.ts`
- Create: `electron/services/external-service-api-client.ts`
- Create: `src/lib/external-service-api.ts`
- Test: `tests/unit/external-service-api-client.test.ts`
- Test: `tests/unit/external-service-renderer-api.test.ts`

**Interfaces:**
- Produces: `ExternalServiceSummary`、`ExternalServiceVersionConfig`、`ExternalServiceDraftInput`、`ExternalServiceBindingSnapshot`。
- Produces: `ExternalServiceApiClient.page()`、`listVersions()`、`getVersion()`。
- Produces Renderer functions: `pageExternalServices()`、`pageExternalServicesAdmin()`、`getExternalServiceDraft()`、`saveExternalServiceDraft()`、`publishExternalService()`、`setExternalServiceStatus()`。

- [ ] **Step 1: 写 Electron API 客户端失败测试**

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ExternalServiceApiClient } from '../../electron/services/external-service-api-client';

const resolveBaseUrl = vi.fn().mockResolvedValue('https://memory.example.test');
const getAuthHeaders = vi.fn().mockResolvedValue({ stotoken: 'token-1' });
const fetchImpl = vi.fn();

describe('ExternalServiceApiClient', () => {
  beforeEach(() => vi.clearAllMocks());

  it('使用 resolveStoBaseUrl + 鉴权头搜索服务', async () => {
    fetchImpl.mockResolvedValueOnce(new Response(JSON.stringify({
      success: true,
      data: { items: [{ serviceId: 'sto-policy-ontology', latestVersion: '1.0.0' }], total: 1, pageNum: 1, pageSize: 20 },
    }), { status: 200 }));
    const client = new ExternalServiceApiClient({ resolveBaseUrl, getAuthHeaders, fetchImpl });
    const result = await client.page({ keyword: 'ontology' });
    expect(result.items[0]?.serviceId).toBe('sto-policy-ontology');
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://memory.example.test/agent/v1/external-services/page',
      expect.objectContaining({ method: 'POST', headers: expect.objectContaining({ stotoken: 'token-1' }) }),
    );
  });
});
```

- [ ] **Step 2: 运行测试并确认模块不存在**

Run: `pnpm vitest run tests/unit/external-service-api-client.test.ts tests/unit/external-service-renderer-api.test.ts`

Expected: FAIL with module-not-found。

- [ ] **Step 3: 定义共享契约**

```ts
export type ExternalServiceAuthType = 'none' | 'stoToken';
export type ExternalServiceDeployEnv = 'daily' | 'stage' | 'online';

export interface ExternalServiceIntegration {
  npmPackage?: string;
  packageVersion?: string;
  usageGuide?: string;
}

export interface ExternalServiceVersionConfig {
  schemaVersion: 'external-service/v1';
  serviceId: string;
  version: string;
  name: string;
  description: string;
  owner: string;
  environments: Record<ExternalServiceDeployEnv, string>;
  auth: { type: ExternalServiceAuthType };
  integration?: ExternalServiceIntegration;
}

export interface ExternalServiceBindingSnapshot extends ExternalServiceVersionConfig {
  alias: string;
}

export interface ExternalServicesManifest {
  schemaVersion: 'external-services/v1';
  services: ExternalServiceBindingSnapshot[];
}
```

同文件定义摘要、分页结果和不含 `schemaVersion/serviceId/version` 的草稿输入。

- [ ] **Step 4: 实现 Electron 读取客户端**

复制 `AppTemplateApiClient` 已验证的请求骨架，但错误文案改为“外部服务接口请求失败”。默认依赖必须是：

```ts
async function defaultAuthHeaders(): Promise<Record<string, string>> {
  const token = await getStoToken();
  if (!token) throw new Error('未登录或 stoToken 已过期，请重新登录');
  return buildStoMemoryCenterAuthHeaders(token);
}
```

公开方法：

```ts
page(input): Promise<ExternalServicePageResult>
listVersions(serviceId: string): Promise<ExternalServiceVersionSummary[]>
getVersion(serviceId: string, version: string): Promise<ExternalServiceVersionConfig>
```

超时默认 30 秒，错误保留 memory-center 的 `errCode` 和 `traceId`。

- [ ] **Step 5: 实现 Renderer 管理 API**

所有函数通过现有通用代理调用：

```ts
const PREFIX = '/ai-memory/agent/v1/external-services';

export function saveExternalServiceDraft(serviceId: string, draft: ExternalServiceDraftInput) {
  return hostApiFetch<{ data: ExternalServiceDraft }>(`${PREFIX}/${encodeURIComponent(serviceId)}/draft`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(draft),
  }).then((response) => response.data);
}
```

不要新增 Electron 纯透传路由。`pageExternalServices()` 使用 `POST /page`；`pageExternalServicesAdmin()` 使用 `POST /admin/page`；发布、状态、草稿读取严格匹配 memory-center 契约。

- [ ] **Step 6: 运行客户端测试**

Run: `pnpm vitest run tests/unit/external-service-api-client.test.ts tests/unit/external-service-renderer-api.test.ts`

Expected: PASS。

- [ ] **Step 7: 记录评审检查点**

Suggested commit message（由用户确认后提交）: `feat: add external service api clients`

---

### Task 2: 应用绑定、校验与三文件生成器

**Files:**
- Create: `electron/services/app-external-service-binding.ts`
- Test: `tests/unit/app-external-service-binding.test.ts`

**Interfaces:**
- Consumes: `externalServiceApiClient.getVersion()` and existing `installNpmPackage(appPath, exactPackage)`。
- Produces: `listExternalServiceBindings(appPath)`、`bindExternalService(input)`、`upgradeExternalService(input)`、`removeExternalService(input)`、`validateExternalServiceWorkspace(appPath)`。
- Produces files: `contracts/external-services.v1.json`、managed rows in `contracts/dev-proxy.v1.json`、`src/sclaw/services.generated.ts`。

- [ ] **Step 1: 写绑定成功和安全失败测试**

```ts
const POLICY_VERSION: ExternalServiceVersionConfig = {
  schemaVersion: 'external-service/v1',
  serviceId: 'sto-policy-ontology',
  version: '1.0.0',
  name: '策略本体服务',
  description: '提供策略本体查询能力',
  owner: 'policy-platform',
  environments: {
    daily: 'https://zc-hybrid-test.sto.cn/sto-policy/api',
    stage: 'https://zc-hybrid-stage.sto.cn/sto-policy/api',
    online: 'https://zc-hybrid.sto.cn/sto-policy/api',
  },
  auth: { type: 'stoToken' },
  integration: {
    npmPackage: '@sto/sclaw-plugin-policy-ontology',
    packageVersion: '1.0.0',
    usageGuide: '导入 createOntologyClient。',
  },
};

const EVIL_VERSION: ExternalServiceVersionConfig = {
  ...POLICY_VERSION,
  serviceId: 'evil',
  environments: { ...POLICY_VERSION.environments, online: 'https://evil.example/api' },
};

async function createTempApp(): Promise<string> {
  const appPath = await mkdtemp(join(tmpdir(), 'sclaw-external-service-'));
  await mkdir(join(appPath, 'contracts'), { recursive: true });
  await mkdir(join(appPath, 'src/sclaw'), { recursive: true });
  await writeFile(join(appPath, 'contracts/dev-proxy.v1.json'), '{"version":"v1","proxies":[]}\n');
  return appPath;
}

it('写入固定版本快照并生成 daily 代理和调用入口', async () => {
  const appPath = await createTempApp();
  const service = createBindingService({
    getVersion: vi.fn().mockResolvedValue(POLICY_VERSION),
    installNpmPackage: vi.fn().mockResolvedValue({ packageName: '@sto/sclaw-plugin-policy-ontology@1.0.0', output: '' }),
  });
  const result = await service.bind({ appPath, serviceId: 'sto-policy-ontology', version: '1.0.0', alias: 'policyOntology' });
  const manifest = JSON.parse(await readFile(join(appPath, 'contracts/external-services.v1.json'), 'utf8'));
  const proxy = JSON.parse(await readFile(join(appPath, 'contracts/dev-proxy.v1.json'), 'utf8'));
  expect(manifest.services[0]).toMatchObject({ alias: 'policyOntology', serviceId: 'sto-policy-ontology', version: '1.0.0' });
  expect(proxy.proxies).toContainEqual(expect.objectContaining({ key: 'policyOntology', target: POLICY_VERSION.environments.daily, managedBy: 'external-services' }));
  expect(result.changedFiles).toEqual(expect.arrayContaining(['contracts/external-services.v1.json', 'contracts/dev-proxy.v1.json', 'src/sclaw/services.generated.ts']));
});

it('拒绝把 stoToken 绑定到非 STO 域名', async () => {
  const appPath = await createTempApp();
  const service = createBindingService({ getVersion: vi.fn().mockResolvedValue(EVIL_VERSION) });
  await expect(service.bind({ appPath, serviceId: 'evil', version: '1.0.0', alias: 'evil' }))
    .rejects.toThrow('stoToken');
});
```

- [ ] **Step 2: 运行测试并确认失败**

Run: `pnpm vitest run tests/unit/app-external-service-binding.test.ts`

Expected: FAIL with module-not-found。

- [ ] **Step 3: 实现 Manifest 读取和二次安全校验**

```ts
const ALIAS_RE = /^[A-Za-z_$][A-Za-z0-9_$]*$/;
const EMPTY_MANIFEST: ExternalServicesManifest = {
  schemaVersion: 'external-services/v1',
  services: [],
};

function assertSafeSnapshot(config: ExternalServiceVersionConfig): void {
  if (config.schemaVersion !== 'external-service/v1') throw new Error('外部服务 schemaVersion 不受支持');
  for (const env of ['daily', 'stage', 'online'] as const) {
    const url = new URL(config.environments[env]);
    if (url.protocol !== 'https:' || url.search || url.hash) throw new Error(`${env} 地址必须是 HTTPS baseUrl`);
    if (config.auth.type === 'stoToken' && url.hostname !== 'sto.cn' && !url.hostname.endsWith('.sto.cn')) {
      throw new Error('stoToken 只能发送到 STO 域名');
    }
  }
}
```

读取不存在的 Manifest 返回空结构；存在但 JSON/字段非法必须失败，不能静默覆盖。

- [ ] **Step 4: 实现确定性生成器**

`external-services.v1.json` 按 alias 排序并以两个空格缩进写入。`dev-proxy.v1.json` 保留所有 `managedBy !== 'external-services'` 的原条目，只替换当前绑定生成的条目：

```ts
const managed = manifest.services.map((service) => ({
  key: service.alias,
  target: service.environments.daily,
  changeOrigin: true,
  managedBy: 'external-services',
  serviceId: service.serviceId,
}));
```

如果人工代理已经占用同名 key，绑定失败并提示修改 alias。生成的 TypeScript 内容必须稳定：

```ts
// AUTO-GENERATED by SClaw. Do not edit.
import { createExternalServiceClient } from './external-service-runtime';

export const services = {
  policyOntology: createExternalServiceClient('policyOntology'),
} as const;
```

- [ ] **Step 5: 实现绑定、升级和移除事务**

绑定顺序固定为：远端取版本 → 二次校验 → 检查重复 → 安装精确 SDK → 计算三个新文件 → 写临时文件 → rename 覆盖目标。SDK 精确字符串：

```ts
const exactPackage = `${integration.npmPackage}@${integration.packageVersion}`;
await installNpmPackage(appPath, exactPackage);
```

升级只替换同 alias 的快照；移除只删除绑定和 managed 代理，第一期不自动卸载 npm 依赖。任何生成失败都不得覆盖三个旧文件。

- [ ] **Step 6: 实现发布前一致性校验**

`validateExternalServiceWorkspace()` 重新生成期望字符串但不落盘，并逐一比较磁盘内容；返回：

```ts
type ExternalServiceWorkspaceValidation = {
  valid: boolean;
  errors: string[];
  serviceCount: number;
};
```

覆盖非法 schema、重复 alias/serviceId、非 STO Token 域名、生成物漂移。

- [ ] **Step 7: 运行绑定测试**

Run: `pnpm vitest run tests/unit/app-external-service-binding.test.ts`

Expected: PASS。

- [ ] **Step 8: 记录评审检查点**

Suggested commit message（由用户确认后提交）: `feat: generate app external service bindings`

---

### Task 3: SClaw Host API 与 Agent 受控命令

**Files:**
- Create: `electron/api/routes/app-external-services.ts`
- Modify: `electron/api/server.ts`
- Modify: `electron/services/app-dev-service.ts`
- Modify: `resources/app-templates/site-minimal/package.json`
- Modify: `resources/app-templates/assets-minimal/package.json`
- Create: `resources/app-templates/site-minimal/scripts/external-services.mjs`
- Create: `resources/app-templates/assets-minimal/scripts/external-services.mjs`
- Create: `resources/app-templates/site-minimal/openspec/skills/external-services/SKILL.md`
- Create: `resources/app-templates/assets-minimal/openspec/skills/external-services/SKILL.md`
- Test: `tests/unit/app-dev-external-service-route.test.ts`
- Test: `tests/unit/external-service-agent-command-contract.test.ts`

**Interfaces:**
- Produces Host API: `GET search`、`GET bindings`、`POST bind`、`POST upgrade`、`POST remove` under `/api/app-external-services`。
- Produces Agent command: `pnpm sclaw:services -- search|list|bind|upgrade|remove`。

- [ ] **Step 1: 写 Host API 路由测试**

```ts
it('bind 路由只接受可解析 workspaceId 并调用受控绑定服务', async () => {
  const handled = await handleAppExternalServiceRoutes(
    jsonRequest('POST', '/api/app-external-services/bind', {
      workspaceId: 'ws-1', serviceId: 'sto-policy-ontology', version: '1.0.0', alias: 'policyOntology',
    }),
    response,
    new URL('http://127.0.0.1/api/app-external-services/bind'),
    context,
  );
  expect(handled).toBe(true);
  expect(bindMock).toHaveBeenCalledWith(expect.objectContaining({ appPath: '/apps/demo', serviceId: 'sto-policy-ontology' }));
});
```

- [ ] **Step 2: 运行路由和命令契约测试并确认失败**

Run: `pnpm vitest run tests/unit/app-dev-external-service-route.test.ts tests/unit/external-service-agent-command-contract.test.ts`

Expected: FAIL。

- [ ] **Step 3: 把 workspaceId 写入本地 marker**

扩展 `AppDevMarker` 并在 `writeAppDevContext()` 中写入：

```ts
const marker = {
  workspaceId: workspace.id,
  name: vars.name,
  // existing fields unchanged
};
```

`.sclaw/app-dev.json` 是本地运行元数据，不进入 Git；保留已有 marker 字段和创建时间。

- [ ] **Step 4: 实现本地业务路由**

路由先用 `resolveAppPath(workspaceId)` 锁定应用目录：

```text
GET  /api/app-external-services/search?workspaceId=...&keyword=...
GET  /api/app-external-services/bindings?workspaceId=...
POST /api/app-external-services/bind
POST /api/app-external-services/upgrade
POST /api/app-external-services/remove
```

`search` 调用 `externalServiceApiClient.page()`，只返回摘要；绑定/升级/移除调用 Task 2 服务并返回 `changedFiles/installedPackage/usageGuide/binding`。在 `electron/api/server.ts` 注册该 handler；它包含本地文件逻辑，因此不属于禁止新增的纯透传路由。

- [ ] **Step 5: 实现跨平台 Node 命令**

脚本读取 `.sclaw/app-dev.json` 的 workspaceId，默认请求 `http://127.0.0.1:3210`，允许测试通过 `SCLAW_HOST_API_URL` 覆盖。命令解析：

```js
const [action, ...args] = process.argv.slice(2);
const marker = JSON.parse(await readFile(new URL('../.sclaw/app-dev.json', import.meta.url), 'utf8'));
if (!marker.workspaceId) throw new Error('当前应用缺少 workspaceId，请在 SClaw 中重新打开应用');
```

每个命令只调用受控 Host API，不直接写 JSON：

```text
search <keyword>
list
bind <serviceId> [version] [alias]
upgrade <alias> <version>
remove <alias>
```

无 version 的 bind 由 Host API 使用搜索结果的 latestVersion。所有输出为格式化 JSON，非 2xx 退出码为 1。

- [ ] **Step 6: 添加模板内置 Skill 和 package script**

两个 minimal 模板的 `package.json` 增加：

```json
"sclaw:services": "node scripts/external-services.mjs"
```

`SKILL.md` 必须明确：先 search，再 bind；禁止手工添加域名、版本或 Token；绑定后读取 `contracts/external-services.v1.json` 中当前服务的 `usageGuide`；无指南时向用户索取 method/path/params/response；业务代码只使用 `src/sclaw/services.generated.ts`。

- [ ] **Step 7: 运行路由、命令和模板契约测试**

Run: `pnpm vitest run tests/unit/app-dev-external-service-route.test.ts tests/unit/external-service-agent-command-contract.test.ts tests/unit/builtin-app-template-resources.test.ts`

Expected: PASS。

- [ ] **Step 8: 记录评审检查点**

Suggested commit message（由用户确认后提交）: `feat: add controlled external service commands`

---

### Task 4: 全局外部服务管理页面

**Files:**
- Create: `src/components/more-apps/ExternalServiceManagerDialog.tsx`
- Modify: `src/components/more-apps/MoreAppsPage.tsx`
- Test: `tests/unit/external-service-manager-dialog.test.tsx`
- Modify: `tests/unit/more-apps-page.test.tsx`

**Interfaces:**
- Consumes: Task 1 Renderer API。
- Produces: “创建应用”菜单下的“管理外部服务”入口和单配置表单。

- [ ] **Step 1: 写管理入口和表单测试**

```tsx
const POLICY_DAILY_URL = 'https://zc-hybrid-test.sto.cn/sto-policy/api';

it('列出服务并允许编辑单份配置草稿', async () => {
  render(<ExternalServiceManagerDialog open onClose={vi.fn()} />);
  expect(await screen.findByText('策略本体服务')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '编辑' }));
  expect(screen.getByLabelText('Daily 地址')).toHaveValue(POLICY_DAILY_URL);
});

it('发布前必须二次确认', async () => {
  render(<ExternalServiceManagerDialog open onClose={vi.fn()} />);
  fireEvent.click(await screen.findByRole('button', { name: '发布新版本' }));
  expect(screen.getByText('确认发布外部服务')).toBeInTheDocument();
  expect(publishMock).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: 运行 UI 测试并确认失败**

Run: `pnpm vitest run tests/unit/external-service-manager-dialog.test.tsx tests/unit/more-apps-page.test.tsx`

Expected: FAIL。

- [ ] **Step 3: 实现轻量列表和配置表单**

页面通过 `pageExternalServicesAdmin()` 列出全部服务，包括未发布草稿和已停用服务。表单只维护设计确认的字段：serviceId、名称、描述、维护团队、三个环境地址、认证方式、可选 npmPackage/packageVersion/usageGuide。`serviceId` 创建后禁用编辑；三个地址、名称和 owner 必填。`auth.type` 下拉只显示 `none`、`stoToken`。

保存调用 `saveExternalServiceDraft()`；发布按钮先保存当前表单，再打开确认弹窗，确认后调用 `publishExternalService()` 并刷新版本。错误直接展示 memory-center 返回的 errMessage/traceId，不改写为“未知错误”。

- [ ] **Step 4: 在 MoreApps 增加入口**

与模板管理同级：

```tsx
<DropdownMenuItem onSelect={() => setExternalServiceManagerOpen(true)}>
  <PlugZap className="mr-2 h-3.5 w-3.5" aria-hidden="true" />
  管理外部服务
</DropdownMenuItem>
```

入口沿用 `canUseAppDev` 可见性，memory-center 的 `SuperAdminOnly` 仍是发布权限最终边界。

- [ ] **Step 5: 运行管理 UI 测试**

Run: `pnpm vitest run tests/unit/external-service-manager-dialog.test.tsx tests/unit/more-apps-page.test.tsx`

Expected: PASS。

- [ ] **Step 6: 记录评审检查点**

Suggested commit message（由用户确认后提交）: `feat: add external service management ui`

---

### Task 5: 当前应用外部服务广场

**Files:**
- Create: `src/components/app-dev/AppExternalServicesPanel.tsx`
- Modify: `src/components/app-dev/AppDevWorkbenchStage.tsx`
- Modify: `src/lib/app-dev-api.ts`
- Test: `tests/unit/app-external-services-panel.test.tsx`
- Modify: `tests/unit/app-dev-workbench-page-type.test.tsx`

**Interfaces:**
- Consumes Host API from Task 3。
- Produces: `searchAppExternalServices()`、`listAppExternalServiceBindings()`、`bindAppExternalService()`、`upgradeAppExternalService()`、`removeAppExternalService()`。
- Produces workbench mode: `'external-services'`。

- [ ] **Step 1: 写搜索、绑定和移除交互测试**

```tsx
it('只把用户选择的服务绑定到当前工作区', async () => {
  render(<AppExternalServicesPanel workspaceId="ws-1" />);
  fireEvent.change(screen.getByPlaceholderText('搜索外部服务'), { target: { value: 'ontology' } });
  fireEvent.click(screen.getByRole('button', { name: '搜索' }));
  expect(await screen.findByText('策略本体服务')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '添加到应用' }));
  await waitFor(() => expect(bindMock).toHaveBeenCalledWith(expect.objectContaining({
    workspaceId: 'ws-1', serviceId: 'sto-policy-ontology', version: '1.0.0',
  })));
});
```

- [ ] **Step 2: 运行测试并确认失败**

Run: `pnpm vitest run tests/unit/app-external-services-panel.test.tsx tests/unit/app-dev-workbench-page-type.test.tsx`

Expected: FAIL。

- [ ] **Step 3: 增加 Renderer 本地绑定 API**

在 `src/lib/app-dev-api.ts` 中添加精确路径包装。绑定输入允许 alias；UI 默认用 `serviceId` 转 camelCase：

```ts
export function bindAppExternalService(input: {
  workspaceId: string;
  serviceId: string;
  version: string;
  alias: string;
}) {
  return hostApiFetch('/api/app-external-services/bind', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
}
```

- [ ] **Step 4: 实现简单广场和当前绑定列表**

同一面板分为“已绑定”和“服务广场”两区：

- 已绑定显示 alias、名称、固定版本、认证、SDK；提供升级和移除。
- 广场默认加载 ACTIVE 服务摘要，支持关键词；已经绑定的 serviceId 显示“已添加”。
- 添加成功展示 changedFiles、installedPackage 和 usageGuide 摘要，并刷新绑定。
- 升级必须显式选择版本；不能默认自动跟随 latestVersion。

- [ ] **Step 5: 增加工作台页签**

扩展：

```ts
export type AppDevStageMode = 'preview' | 'code' | 'git' | 'external-services' | 'cloud' | 'community';
```

在 Git 与云服务之间增加 `{ id: 'external-services', label: '外部服务', icon: PlugZap }`，Site 和 Assets 都显示同一页签。

- [ ] **Step 6: 运行面板测试**

Run: `pnpm vitest run tests/unit/app-external-services-panel.test.tsx tests/unit/app-dev-workbench-page-type.test.tsx`

Expected: PASS。

- [ ] **Step 7: 记录评审检查点**

Suggested commit message（由用户确认后提交）: `feat: add app external service plaza`

---

### Task 6: 模板 HTTP Runtime、本地代理和 Site 发布环境

**Files:**
- Create: `resources/app-templates/site-minimal/contracts/external-services.v1.json`
- Create: `resources/app-templates/assets-minimal/contracts/external-services.v1.json`
- Create: `resources/app-templates/site-minimal/src/sclaw/external-service-runtime.ts`
- Create: `resources/app-templates/assets-minimal/src/sclaw/external-service-runtime.ts`
- Create: `resources/app-templates/site-minimal/src/sclaw/services.generated.ts`
- Create: `resources/app-templates/assets-minimal/src/sclaw/services.generated.ts`
- Modify: `packages/sclaw-plugin-sso-auth/src/types.ts`
- Modify: `packages/sclaw-plugin-sso-auth/src/config.ts`
- Modify: `packages/sclaw-plugin-sso-auth/src/runtime.ts`
- Modify: `packages/sclaw-plugin-sso-auth/src/vite/plugin.ts`
- Modify: `resources/app-templates/assets-minimal/package.json`
- Modify: `resources/app-templates/assets-minimal/vite.config.ts`
- Modify: `resources/app-templates/assets-minimal/src/main.tsx`
- Modify: `resources/app-templates/assets-minimal/src/lib/request.ts`
- Test: `tests/unit/external-service-template-runtime.test.ts`
- Test: `packages/sclaw-plugin-sso-auth/tests/config.test.ts`
- Test: `packages/sclaw-plugin-sso-auth/tests/vite-plugin.test.ts`
- Modify: `tests/unit/builtin-app-template-resources.test.ts`

**Interfaces:**
- Produces: `createExternalServiceClient(alias, testDependencies?)` and initial empty `services` map；生产调用省略第二参数，测试可注入 manifest、`isDev` 和 request。
- Extends SSO Auth only for `runtimeMode: 'local' + pageType: 'assets'`; published Assets remains rejected and never redirects to SSO。

- [ ] **Step 1: 写 Runtime URL 和认证测试**

```ts
const POLICY_STAGE_URL = 'https://zc-hybrid-stage.sto.cn/sto-policy/api';
const requestMock = vi.fn();
const manifest: ExternalServicesManifest = {
  schemaVersion: 'external-services/v1',
  services: [
    {
      alias: 'policyOntology',
      schemaVersion: 'external-service/v1',
      serviceId: 'sto-policy-ontology',
      version: '1.0.0',
      name: '策略本体服务',
      description: '',
      owner: 'policy-platform',
      environments: {
        daily: 'https://zc-hybrid-test.sto.cn/sto-policy/api',
        stage: POLICY_STAGE_URL,
        online: 'https://zc-hybrid.sto.cn/sto-policy/api',
      },
      auth: { type: 'stoToken' },
    },
    {
      alias: 'publicStatus',
      schemaVersion: 'external-service/v1',
      serviceId: 'public-status',
      version: '1.0.0',
      name: '公开状态服务',
      description: '',
      owner: 'platform',
      environments: {
        daily: 'https://status-test.sto.cn/api',
        stage: 'https://status-stage.sto.cn/api',
        online: 'https://status.sto.cn/api',
      },
      auth: { type: 'none' },
    },
  ],
};

it('本地始终使用 alias 代理路径', async () => {
  const client = createExternalServiceClient('policyOntology', { manifest, isDev: true, request: requestMock });
  await client.request({ method: 'GET', path: '/v1/search' });
  expect(requestMock).toHaveBeenCalledWith('/proxy/policyOntology/v1/search', expect.anything());
});

it('发布 Site 按注入 deployEnv 选择 stage 地址', async () => {
  window.__STO_SSO_AUTH_CONFIG__ = { deployEnv: 'stage' } as never;
  const client = createExternalServiceClient('policyOntology', { manifest, isDev: false, request: requestMock });
  await client.request({ method: 'GET', path: '/v1/search' });
  expect(requestMock).toHaveBeenCalledWith(`${POLICY_STAGE_URL}/v1/search`, expect.anything());
});

it('none 认证明确禁用 stoToken', async () => {
  const noneClient = createExternalServiceClient('publicStatus', { manifest, isDev: true, request: requestMock });
  await noneClient.request({ method: 'GET', path: '/health' });
  expect(requestMock).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ stoToken: null }));
});
```

- [ ] **Step 2: 运行 Runtime 和 SSO 测试并确认失败**

Run: `pnpm vitest run tests/unit/external-service-template-runtime.test.ts packages/sclaw-plugin-sso-auth/tests/config.test.ts packages/sclaw-plugin-sso-auth/tests/vite-plugin.test.ts`

Expected: FAIL。

- [ ] **Step 3: 实现稳定 External Service Runtime**

Runtime 导入 `contracts/external-services.v1.json` 和现有 `request()`，按 alias 找快照。path 必须以 `/` 开头且不能是绝对 URL：

```ts
function resolveDeployEnv(isDev: boolean): 'daily' | 'stage' | 'online' {
  if (isDev) return 'daily';
  const env = window.__SCLAW_APP_CONFIG__?.deployEnv
    ?? window.__STO_SSO_AUTH_CONFIG__?.deployEnv;
  if (env !== 'daily' && env !== 'stage' && env !== 'online') {
    throw new Error('发布环境配置缺失');
  }
  return env;
}
```

`createExternalServiceClient(alias, testDependencies?)` 返回 `request<T>({ method, path, params, data, headers })`。生产调用省略第二参数；测试参数只允许覆盖 manifest、`isDev` 和 request 实现。DEV URL 是 `/proxy/${alias}${path}`；PROD URL 是 `${snapshot.environments[env]}${path}`。`auth.type === 'none'` 传 `stoToken: null`，`stoToken` 不显式传值，让现有 request Runtime 读取当前身份。

- [ ] **Step 4: 允许 Assets 仅在本地使用当前 SClaw 身份**

调整 SSO Auth 配置联合类型：

```ts
type StoSsoAuthConfig =
  | { pageType: 'site'; runtimeMode: 'local' | 'published'; /* existing fields */ }
  | { pageType: 'assets'; runtimeMode: 'local'; deployEnv: 'daily'; /* no sso block */ };
```

Vite 插件允许 `STO_SSO_AUTH_PAGE_TYPE=assets`，本地配置注入对应 pageType。Runtime plugin 接受 Assets local 并创建 `createLocalSsoAuth()`；Assets published 配置继续抛 `SSO_AUTH_PAGE_TYPE_UNSUPPORTED`，不得调用 `buildSsoLoginUrl` 或执行重定向。

- [ ] **Step 5: 把 Assets minimal 接入本地身份桥**

Assets 模板安装固定 `@sto/sclaw-plugin-sso-auth`，Vite 增加 `ssoAuthVite()`。`main.tsx` 仅在本地配置下先 `bootstrapSsoAuth()` 再渲染；发布 Assets 不启动 SSO 插件。`request.ts` 移除 URL/Cookie Token 捕获，改为安全读取已启动的本地 auth；如果发布 Assets 请求 `stoToken` 服务但宿主 Bridge 尚未提供身份，抛出明确 `AUTH_RUNTIME_UNAVAILABLE`。

- [ ] **Step 6: 初始化两个模板的空配置和生成入口**

两个模板新增：

```json
{
  "schemaVersion": "external-services/v1",
  "services": []
}
```

初始 `services.generated.ts` 为：

```ts
// AUTO-GENERATED by SClaw. Do not edit.
export const services = {} as const;
```

- [ ] **Step 7: 运行模板、SSO package 和构建测试**

Run: `pnpm vitest run tests/unit/external-service-template-runtime.test.ts tests/unit/builtin-app-template-resources.test.ts packages/sclaw-plugin-sso-auth/tests/config.test.ts packages/sclaw-plugin-sso-auth/tests/vite-plugin.test.ts`

Expected: PASS。

Run: `npm run build --prefix packages/sclaw-plugin-sso-auth`

Expected: PASS。

Run: `npm run typecheck --prefix resources/app-templates/site-minimal`

Expected: PASS。

Run: `npm run typecheck --prefix resources/app-templates/assets-minimal`

Expected: PASS。

- [ ] **Step 8: 记录评审检查点**

Suggested commit message（由用户确认后提交）: `feat: add external service runtime to app templates`

---

### Task 7: 发布前校验和环境联动

**Files:**
- Modify: `electron/api/routes/app-dev.ts`
- Modify: `src/components/app-dev/StoAppDeployDialog.tsx`
- Test: `tests/unit/app-dev-external-service-deploy-validation.test.ts`
- Modify: `docs/contracts/sclaw-sso-auth-runtime-v1.md`
- Create: `docs/contracts/sclaw-external-services-runtime-v1.md`

**Interfaces:**
- Consumes: Task 2 `validateExternalServiceWorkspace(appPath)`。
- Produces: deploy preflight before `pushStoApp()` and `saiCodeDeployCreate()`。

- [ ] **Step 1: 写发布前阻断测试**

```ts
it('生成物漂移时不 push 也不触发 code-deploy', async () => {
  validationMock.mockResolvedValue({ valid: false, errors: ['services.generated.ts 与配置不一致'], serviceCount: 1 });
  await handleDeploy(requestFor({ workspaceId: 'ws-1', env: 'stage' }));
  expect(pushStoAppMock).not.toHaveBeenCalled();
  expect(saiCodeDeployCreateMock).not.toHaveBeenCalled();
  expect(response.statusCode).toBe(400);
});
```

- [ ] **Step 2: 运行测试并确认当前发布未校验**

Run: `pnpm vitest run tests/unit/app-dev-external-service-deploy-validation.test.ts`

Expected: FAIL。

- [ ] **Step 3: 在 push 之前执行校验**

在 `/api/app-dev/sto-app/deploy` 已完成 env 校验、尚未 `pushStoApp()` 的位置调用：

```ts
const externalServices = await validateExternalServiceWorkspace(appPath);
if (!externalServices.valid) {
  throw Object.assign(
    new Error(`外部服务配置校验失败：${externalServices.errors.join('；')}`),
    { statusCode: 400 },
  );
}
```

成功后仍使用现有：

```ts
await pushStoApp(appPath, pushMessage);
await saiCodeDeployCreate({ env, applicationId, requestId, deploymentVersion });
```

不要让 Agent 或绑定配置覆盖 env。

- [ ] **Step 4: 为 Assets 发布缺口给出明确提示**

当 pageType 是 Assets、存在 `auth.type === 'stoToken'` 的绑定时，第一期发布确认页面显示非阻断提示：“托管应用发布后由 iframe 宿主提供身份；请确认宿主已接入 Token Bridge。”Site 不显示该提示。

- [ ] **Step 5: 固化运行时契约**

新文档明确：

- 本地固定 daily；
- Site 发布读取 `window.__STO_SSO_AUTH_CONFIG__.deployEnv`；
- `external-services.v1.json` 包含三个公开环境地址但不含凭证；
- Assets 未来通过 `window.__SCLAW_APP_CONFIG__.deployEnv` 和宿主身份 Bridge 接入；
- 发布站点域名必须在外部服务 CORS 白名单中。

现有 SSO 契约补一句 deployEnv 同时是 Site 外部服务环境解析的权威来源。

- [ ] **Step 6: 运行发布测试**

Run: `pnpm vitest run tests/unit/app-dev-external-service-deploy-validation.test.ts tests/unit/use-sto-app-deploy.test.tsx tests/unit/sto-app-deploy-flow.test.ts`

Expected: PASS。

- [ ] **Step 7: 记录评审检查点**

Suggested commit message（由用户确认后提交）: `feat: validate external services before deploy`

---

### Task 8: 跨模块回归与最终交付

**Files:**
- Modify: `docs/superpowers/specs/2026-08-27-external-service-plaza-design.md` only if implementation reveals an exact contract correction

**Interfaces:**
- Verifies the memory-center contract, binding generator, Agent command, UI, templates and deploy preflight as one flow。

- [ ] **Step 1: 运行本功能全部单元测试**

Run:

```bash
pnpm vitest run \
  tests/unit/external-service-api-client.test.ts \
  tests/unit/external-service-renderer-api.test.ts \
  tests/unit/app-external-service-binding.test.ts \
  tests/unit/app-dev-external-service-route.test.ts \
  tests/unit/external-service-agent-command-contract.test.ts \
  tests/unit/external-service-manager-dialog.test.tsx \
  tests/unit/app-external-services-panel.test.tsx \
  tests/unit/external-service-template-runtime.test.ts \
  tests/unit/app-dev-external-service-deploy-validation.test.ts \
  tests/unit/builtin-app-template-resources.test.ts
```

Expected: PASS。

- [ ] **Step 2: 运行相关既有回归**

Run:

```bash
pnpm vitest run \
  tests/unit/dev-proxy.test.ts \
  tests/unit/app-template-api-client.test.ts \
  tests/unit/app-template-manager-dialog.test.tsx \
  tests/unit/more-apps-page.test.tsx \
  tests/unit/app-dev-workbench-page-type.test.tsx \
  tests/unit/site-minimal-sso-auth-contract.test.ts \
  packages/sclaw-plugin-sso-auth/tests
```

Expected: PASS。

- [ ] **Step 3: 运行类型检查**

Run: `pnpm typecheck`

Expected: 新增或修改文件不得产生新的 TypeScript 错误。若仓库仍有已知基线错误，记录完整文件和错误信息，并使用定向 TypeScript/Vitest 结果证明本功能通过；不得宣称根 typecheck 全绿。

- [ ] **Step 4: 手工联调开发链路**

在 Site 和 Assets 各创建一个临时测试应用，执行：

```text
pnpm sclaw:services -- search ontology
pnpm sclaw:services -- bind sto-policy-ontology 1.0.0 policyOntology
pnpm dev
```

浏览器 Network 必须显示请求发送到 `http://127.0.0.1:<vite-port>/proxy/policyOntology/...`，Vite 转发到 daily 地址；请求 Header 包含当前 SClaw 用户 stoToken，URL 和应用文件中不出现 Token。

- [ ] **Step 5: 手工联调发布前链路**

分别选择 daily、stage、online 打开发布确认，确认 Agent/配置没有修改发布环境；Site Runtime 分别解析三个对应地址。Assets 带 `stoToken` 服务时显示宿主 Bridge 提示。

- [ ] **Step 6: 输出最终交付清单**

列出：修改文件、测试证据、memory-center API 前置版本、CORS 前置条件、Site SSO deployEnv 注入前置条件、Assets 宿主 Bridge 非目标，以及建议 commit messages。未经用户明确要求，不执行 commit 或 push。
