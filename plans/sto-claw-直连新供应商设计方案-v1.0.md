# Sto-Claw 直连新模型供应商设计方案 v1.0

## 一、背景与目标

### 1.1 背景

当前 sto-claw 的 **STO AI** 供应商通过 memory-center 后端转发调用大模型，所有用户共享后端统一的 `BAI_LIAN_API_KEY`。现需将调用方式改为**直连新模型供应商**，且每个用户拥有独立的 SK。

### 1.2 核心目标

1. **用户 SK 动态获取**：用户 SSO 登录后，sto-claw 从申通内部接口动态获取个人 SK，作为 STO AI 供应商的默认调用密钥。
2. **不影响默认供应商逻辑**：STO AI 仍然是默认供应商，用户首次登录后默认选中 STO AI。
3. **不影响切换逻辑**：用户切换 OpenAI、Anthropic 等其他供应商的流程完全不变。
4. **请求头兼容**：支持新供应商要求的 `secret: <md5(工号)>` 和 `Authorization: Bearer <sk>` 请求头。
5. **模型列表定制路径**：新供应商的模型列表接口路径非标准 `/v1/models`，需要支持自定义路径。
6. **模型前缀兼容**：新供应商模型名称含前缀（如 `dashscope/kimi-k2.6`），前端模型选择下拉框需正确匹配和展示。
7. **OpenAI 协议兼容**：新供应商的消息发送接口兼容 OpenAI 协议，Gateway 无需协议层改造。
8. **环境区分**：新供应商的生产与测试环境域名不同，需根据当前 SSO 登录环境动态选择对应域名。

---

## 二、总体架构

### 2.1 改造前后对比

```
改造前（经 memory-center 转发）:
┌─────────────┐      stotoken      ┌──────────────────┐     BAI_LIAN_API_KEY     ┌──────────┐
│  sto-claw   │ ────────────────→ │  memory-center   │ ──────────────────────→ │ Dashscope│
│   Gateway   │                   │  /agent/v1/*     │                         │ (百炼)   │
└─────────────┘                   └──────────────────┘                         └──────────┘

改造后（sto-claw 直连新供应商）:
┌─────────────┐      User SK       ┌──────────────────┐
│  sto-claw   │ ────────────────→ │  新供应商 API     │
│   Gateway   │  secret: md5(工号) │  /custom/models   │
└─────────────┘  Authorization     │  /v1/chat/completions (OpenAI 协议)
                 Bearer <SK>       └──────────────────┘
```

### 2.2 核心变化

| 维度 | 改造前 | 改造后 |
|------|--------|--------|
| 调用链路 | Gateway → memory-center → 百炼 | Gateway → 新供应商（直连） |
| API Key | 后端统一 `BAI_LIAN_API_KEY` | 用户个人 SK（动态获取） |
| 认证头 | `Authorization: Bearer <stotoken>` | `Authorization: Bearer <SK>` |
| 自定义头 | 无 | `secret: <md5(工号)>` |
| 模型列表来源 | memory-center 数据库 | 新供应商定制接口 |
| 模型名称 | 无前缀（如 `qwen3.6-plus`） | 有前缀（如 `dashscope/kimi-k2.6`） |
| 环境域名 | memory-center 统一域名 | 生产/测试域名根据 SSO 环境动态切换 |

---

## 三、供应商配置（Registry）

### 3.1 STO Provider 注册表配置

```typescript
// electron/shared/providers/registry.ts
{
  id: 'sto',
  name: 'STO AI',
  icon: '🏢',
  placeholder: 'sto-token...',
  requiresApiKey: false,              // ← 保持 false，用户无需手动配置
  isOAuth: false,
  supportsApiKey: true,
  category: 'compatible',
  supportedAuthModes: ['api_key'],
  defaultAuthMode: 'api_key',
  supportsMultipleAccounts: false,
  providerConfig: {
    baseUrl: 'https://devops-llmgateway.sto.cn',           // ← 新供应商生产地址（默认值）
    api: 'openai-completions',
    apiKeyEnv: 'STO_API_KEY',
    modelListPath: '/custom/v2/model/list',                // ← 模型列表定制路径（可选扩展）
  },
}
```

### 3.2 配置说明

- `requiresApiKey: false`：设置面板中 STO AI 仍然显示"无需配置"，SK 由后台静默获取。
- `baseUrl`：改为新供应商 API 地址（生产默认值，实际运行时由 sto-model-sync 按环境覆盖）。
- `modelListPath`：如需要在 registry 中声明模型列表路径，可在 `ProviderBackendConfig` 类型中扩展该字段。

---

## 四、环境域名配置

sto-claw 已有 SSO 环境区分机制（`SsoEnvironment`：daily-external / production-external / production-internal / pre-release / local），新供应商需按环境配置不同域名。

### 4.1 域名映射表

```typescript
// electron/services/providers/sto-model-sync.ts
const NEW_SUPPLIER_DOMAINS: Record<string, string> = {
  prod: 'https://devops-llmgateway.sto.cn',
  test: 'https://devops-llmgateway-test.sto.cn',
};

// electron/services/user-sk-service.ts
const SK_API_URLS: Record<string, string> = {
  prod: 'https://devops-llmgatewayapi.sto.cn/openapi/key/detail',
  test: 'https://devops-llmgatewayapi-test.sto.cn/openapi/key/detail',
};
```

### 4.2 环境判断逻辑

复用现有的 `getSsoEnvironment()`，统一判断规则：

```typescript
import { getSsoEnvironment } from '../utils/auth-store';

function isTestEnvironment(env?: string | null): boolean {
  const normalized = env?.trim().toLowerCase() || '';
  return ['test', 'pre-release', 'daily', 'daily-external'].some(
    (e) => normalized.includes(e)
  );
}

async function resolveSupplierDomain(): Promise<string> {
  const env = await getSsoEnvironment();
  return isTestEnvironment(env)
    ? NEW_SUPPLIER_DOMAINS.test
    : NEW_SUPPLIER_DOMAINS.prod;
}

async function resolveSkApiUrl(type: 'query' | 'create'): Promise<string> {
  const env = await getSsoEnvironment();
  return isTestEnvironment(env)
    ? SK_API_URLS.test[type]
    : SK_API_URLS.prod[type];
}
```

### 4.3 使用位置

| 使用位置 | 调用方式 |
|---------|---------|
| `user-sk-service.ts` — 查询 SK | `const url = await resolveSkApiUrl('query')` |
| `user-sk-service.ts` — 创建 SK | `const url = await resolveSkApiUrl('create')` |
| `sto-model-sync.ts` — 模型列表接口 | `const domain = await resolveSkApiDomain()` |
| `sto-model-sync.ts` — account baseUrl | `const domain = await resolveSupplierDomain()` |

---

## 五、认证与密钥管理

### 5.1 用户 SK 动态获取服务

新增 `electron/services/user-sk-service.ts`：

```typescript
/**
 * 用户个人 SK 管理服务
 * 登录后从申通内部接口动态获取，作为 STO AI provider 的调用密钥
 */

import { getStoToken, getSsoEnvironment } from '../utils/auth-store';
import { storeApiKey, getApiKey, deleteApiKey } from '../utils/secure-storage';
import { logger } from '../utils/logger';

const SK_PROVIDER_ID = 'sto';

const SK_API_URLS: Record<string, string> = {
  prod: 'https://devops-llmgatewayapi.sto.cn/openapi/key/detail',
  test: 'https://devops-llmgatewayapi-test.sto.cn/openapi/key/detail',
};

const SK_CREATE_URLS: Record<string, string> = {
  prod: 'https://devops-llmgatewayapi.sto.cn/openapi/key/create',
  test: 'https://devops-llmgatewayapi-test.sto.cn/openapi/key/create',
};

function isTestEnvironment(env?: string | null): boolean {
  const normalized = env?.trim().toLowerCase() || '';
  return ['test', 'pre-release', 'daily', 'daily-external'].some(
    (e) => normalized.includes(e)
  );
}

async function resolveSkApiUrl(type: 'query' | 'create'): Promise<string> {
  const env = await getSsoEnvironment();
  return isTestEnvironment(env)
    ? (type === 'create' ? SK_CREATE_URLS.test : SK_API_URLS.test)
    : (type === 'create' ? SK_CREATE_URLS.prod : SK_API_URLS.prod);
}

interface SkDetailResponse {
  code: string;
  msg: string;
  detailMsg?: string;
  data?: Array<{
    tokenId: string;
    keyAlias: string;
    userCode: string;
    userName: string;
    models: string[];
    status: string;
    encryptedKey: string;
    spend?: number;
    maxBudget?: number;
    expires?: string | null;
    createdAt?: string;
  }>;
  ext?: unknown;
}

async function fetchSkFromApi(
  type: 'query' | 'create',
  token: string,
  userCode: string,
): Promise<string | null> {
  const url = await resolveSkApiUrl(type);

  // 计算 secret: md5(userCode)
  const secretHeader = crypto.createHash('md5').update(userCode).digest('hex');

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        secret: secretHeader,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ userCode }),
    });

    if (!response.ok) {
      logger.warn(`[user-sk] ${type} HTTP failed: ${response.status}`);
      return null;
    }

    const json = await response.json() as SkDetailResponse;

    // 业务码判断
    if (json.code !== '0') {
      if (type === 'query') {
        // 查询时无数据，返回 null（进入创建流程）
        logger.info(`[user-sk] ${type} biz code=${json.code}, msg=${json.msg}`);
        return null;
      }
      logger.warn(`[user-sk] ${type} biz failed: ${json.code} ${json.msg}`);
      return null;
    }

    const sk = json.data?.[0]?.encryptedKey;
    if (!sk) {
      logger.warn(`[user-sk] ${type} response missing encryptedKey`);
      return null;
    }

    return sk;
  } catch (err) {
    logger.warn(`[user-sk] ${type} error:`, err);
    return null;
  }
}

/**
 * 获取用户个人 SK（优先读缓存 → 查询 → 查无则创建）
 */
export async function getUserSk(forceRefresh = false): Promise<string | null> {
  if (!forceRefresh) {
    const cached = await getApiKey(SK_PROVIDER_ID);
    if (cached) return cached;
  }

  const authUser = await getAuthUser();
  const userCode = authUser?.code || authUser?.empCode || '';
  if (!userCode) {
    logger.warn('[user-sk] No userCode available');
    return null;
  }

  const token = await getStoToken();
  if (!token) return null;

  // Step 1: 查询
  let sk = await fetchSkFromApi('query', token, userCode);

  // Step 2: 没有则创建
  if (!sk) {
    logger.info('[user-sk] SK not found, creating...');
    sk = await fetchSkFromApi('create', token, userCode);
    if (sk) {
      logger.info('[user-sk] SK created successfully');
    }
  }

  if (sk) {
    await storeApiKey(SK_PROVIDER_ID, sk);
    logger.info('[user-sk] User SK fetched and stored');
  }

  return sk;
}

/**
 * 登出时清理用户 SK
 */
export async function clearUserSk(): Promise<void> {
  await deleteApiKey(SK_PROVIDER_ID);
  logger.info('[user-sk] User SK cleared');
}
```

### 5.2 登录流程集成

在 `electron/services/auth-setup-orchestrator.ts` 的 `runSetup` 中，插入 SK 获取步骤：

```typescript
async function runSetup(...) {
  // ... 现有代码 ...

  try {
    await syncStoPluginsToOpenClaw();
  } catch (err) { ... }

  // ===== 新增：登录后静默获取用户 SK =====
  try {
    const { getUserSk } = await import('./user-sk-service');
    await getUserSk();
  } catch {
    // 静默失败，sto-model-sync 会处理无 SK 的情况
  }
  // ========================================

  const stoSync = getStoModelSyncService();
  const stoResult = await stoSync.syncModels({ deferGatewayRefresh: true });
  // ... 其余不变
}
```

### 5.3 登出清理

在 `sto-model-sync.ts` 的 `cleanupOnLogout` 中清理 SK：

```typescript
async cleanupOnLogout(): Promise<void> {
  this.stopPeriodicSync();
  const { clearUserSk } = await import('../user-sk-service');
  await clearUserSk();  // ← 新增
  // ... 现有清理逻辑
}
```

---

## 六、模型列表同步

### 6.1 核心改动：sto-model-sync.ts

#### 6.1.1 环境域名解析

```typescript
import { getSsoEnvironment } from '../utils/auth-store';

// Gateway 消息发送域名（无 api 前缀）
const NEW_SUPPLIER_DOMAINS: Record<string, string> = {
  prod: 'https://devops-llmgateway.sto.cn',
  test: 'https://devops-llmgateway-test.sto.cn',
};

// SK 查询/创建接口域名（带 api 前缀）
const SK_API_DOMAINS: Record<string, string> = {
  prod: 'https://devops-llmgatewayapi.sto.cn',
  test: 'https://devops-llmgatewayapi-test.sto.cn',
};

function isTestEnvironment(env?: string | null): boolean {
  const normalized = env?.trim().toLowerCase() || '';
  return ['test', 'pre-release', 'daily', 'daily-external'].some(
    (e) => normalized.includes(e)
  );
}

async function resolveSupplierDomain(): Promise<string> {
  const env = await getSsoEnvironment();
  return isTestEnvironment(env)
    ? NEW_SUPPLIER_DOMAINS.test
    : NEW_SUPPLIER_DOMAINS.prod;
}

async function resolveSkApiDomain(): Promise<string> {
  const env = await getSsoEnvironment();
  return isTestEnvironment(env)
    ? SK_API_DOMAINS.test
    : SK_API_DOMAINS.prod;
}
```

#### 6.1.2 fetchRemoteModels — 从 SK detail 接口获取模型列表

```typescript
async fetchRemoteModels(sk: string, userCode: string): Promise<StoRemoteModel[]> {
  // 模型列表从 SK 查询接口获取（与 SK 同一接口）
  const domain = await resolveSkApiDomain();  // ← devops-llmgatewayapi-*
  const url = `${domain}/openapi/key/detail`;

  const secretHeader = crypto.createHash('md5').update(userCode).digest('hex');

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 5000);

  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        secret: secretHeader,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ userCode }),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeoutId);
  }

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }

  const json = await response.json() as {
    code: string;
    msg: string;
    data?: Array<{
      models: string[];  // ← 模型列表字段
      encryptedKey: string;
    }>;
  };

  if (json.code !== '0') {
    throw new Error(`Biz error: ${json.code} ${json.msg}`);
  }

  // 从 data[0].models 解析模型列表
  const models = json.data?.[0]?.models ?? [];
  return models.map((id) => ({ id, name: id }));
}
```

#### 6.1.3 doSync — 用 SK 替代 stotoken，注入 secret header

```typescript
private async doSync(options?: StoSyncOptions): Promise<StoSyncResult> {
  const runtimeGateway = options?.deferGatewayRefresh
    ? undefined
    : (this.gatewayManager ?? undefined);
  const result: StoSyncResult = { created: [], deleted: [], updated: [], defaultSet: null };

  // Step 1 — 获取用户个人 SK（不再用 stotoken）
  const { getUserSk } = await import('../user-sk-service');
  const sk = await getUserSk();
  if (!sk) {
    result.error = 'no-sk';
    return result;
  }

  // Step 2 — 获取用户工号并计算 secret header
  const authUser = await getAuthUser();  // 从 auth-store 获取登录用户信息
  const userCode = authUser?.code || authUser?.empCode || '';
  const secretHeader = crypto.createHash('md5').update(userCode).digest('hex');

  // Step 3 — 从 SK detail 接口获取模型列表
  let remoteModels: StoRemoteModel[];
  try {
    remoteModels = await this.fetchRemoteModels(sk, userCode);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.warn(`[sto-sync] Failed to fetch remote models: ${message}`);
    result.error = `fetch-failed: ${message}`;
    return result;
  }

  const remoteModelIds = remoteModels.map((m) => m.id);
  if (remoteModelIds.length === 0) {
    result.error = 'empty-model-list';
    return result;
  }

  // Step 4~6 — 创建/更新 STO account（与现有逻辑基本一致）
  const domain = await resolveSupplierDomain();  // ← 按环境选择域名
  const expectedBaseUrl = `${domain}/v1`;
  // ...

  if (!existingAccount) {
    const account: ProviderAccount = {
      id: STO_ACCOUNT_ID,
      vendorId: 'sto',
      label: 'STO AI',
      authMode: 'api_key',
      baseUrl: expectedBaseUrl,
      apiProtocol: 'openai-completions',
      headers: {  // ← 新增：注入 secret header
        secret: secretHeader,
      },
      enabled: true,
      isDefault: false,
      metadata: {
        customModels: remoteModelIds,
        managedBy: 'sto-sync',
      },
      createdAt: now,
      updatedAt: now,
    };

    await providerService.createAccount(account, sk);

    const config = providerAccountToConfig(account);
    await syncSavedProviderToRuntime(config, sk, runtimeGateway);
    result.created.push(STO_ACCOUNT_ID);
  } else {
    // 更新 account 时也带上 headers.secret
    const patch: Partial<ProviderAccount> = {
      baseUrl: expectedBaseUrl,
      enabled: true,
      headers: { secret: secretHeader },  // ← 更新时也要刷新
      metadata: {
        ...existingAccount.metadata,
        customModels: remoteModelIds,
      },
    };
    // ...
  }

  // Step 7 — 设置默认模型（保持 STO AI 为默认供应商）
  const defaultProviderId = await providerService.getDefaultProvider();
  const needsNewDefault = !defaultProviderId || !enabledProviderIds.has(defaultProviderId);
  if (needsNewDefault) {
    await providerService.setDefaultAccount(STO_ACCOUNT_ID);
    await syncDefaultProviderToRuntime(STO_ACCOUNT_ID, this.gatewayManager);
    result.defaultSet = STO_ACCOUNT_ID;
  }

  return result;
}
```

---

## 七、消息发送链路

### 7.1 Gateway 配置同步

`provider-runtime-sync.ts` 中，sto 类型的同步需要同时走两条路径：

1. **`syncProviderConfigToOpenClaw`**：写入 `openclaw.json`，包含 `headers.secret`
2. **`updateAgentModelProvider`**：写入 `models.json`，包含 `apiKey + authHeader`

```typescript
async function syncCustomProviderAgentModel(
  config: ProviderConfig,
  runtimeProviderKey: string,
  apiKey: string | undefined,
): Promise<void> {
  if (config.type !== 'custom' && config.type !== 'sto') return;

  const resolvedKey = apiKey !== undefined ? (apiKey.trim() || null) : await getApiKey(config.id);
  if (!resolvedKey || !config.baseUrl) return;

  const DEFAULT_MODEL_INPUT: string[] = ['text', 'image'];

  if (config.type === 'sto') {
    const account = await getProviderAccount(config.id);
    const customModels = account?.metadata?.customModels ?? [];
    const models = customModels.length > 0
      ? customModels.map((id) => ({ id, name: id, input: DEFAULT_MODEL_INPUT }))
      : config.model ? [{ id: config.model, name: config.model, input: DEFAULT_MODEL_INPUT }] : [];

    // 路径 A：写入 openclaw.json（含 headers.secret）
    await syncProviderConfigToOpenClaw(runtimeProviderKey, config.model, {
      baseUrl: normalizeProviderBaseUrl(config, config.baseUrl, config.apiProtocol || 'openai-completions'),
      api: config.apiProtocol || 'openai-completions',
      apiKeyEnv: 'STO_API_KEY',
      headers: config.headers,  // ← secret: md5(工号)
    });

    // 路径 B：写入 models.json（含 apiKey + authHeader）
    await updateAgentModelProvider(runtimeProviderKey, {
      baseUrl: normalizeProviderBaseUrl(config, config.baseUrl, config.apiProtocol || 'openai-completions'),
      api: config.apiProtocol || 'openai-completions',
      models,
      apiKey: resolvedKey,   // ← SK
      authHeader: true,      // ← 生成 Authorization: Bearer <sk>
    });
    return;
  }

  // custom provider 保持原有逻辑
  // ...
}
```

### 6.2 Gateway 最终发出的请求

配置合并后，Gateway 发送消息时的 HTTP 请求：

```http
POST /v1/chat/completions HTTP/1.1
Host: devops-llmgateway.sto.cn
Authorization: Bearer sk-xxxxxxxxxxxxxxxx        ← 来自 models.json (apiKey + authHeader)
secret: e99a18c428cb38d5f260853678922e03        ← 来自 openclaw.json (headers.secret)
Content-Type: application/json

{
  "model": "dashscope/kimi-k2.6",
  "messages": [...]
}
```

---

## 八、前端模型选择适配

### 8.1 问题

新供应商模型名称含前缀（如 `dashscope/kimi-k2.6`），而 `normalizeModelIdForChat` 会截断前缀为 `kimi-k2.6`，导致：
- 下拉列表中的 `modelId`（原始值）与 `selectedModelId`（截断值）不匹配
- 当前选中模型无法正确高亮

### 7.2 修复方案

修改 `src/lib/chat-model-options.ts`，增加 `normalizedId` 字段：

```typescript
export interface ChatModelOption {
  key: string;
  modelId: string;        // ← 原始值（含前缀），用于发给 Gateway / backend
  normalizedId: string;   // ← 截断后的值，用于匹配 selectedModelId
  accountId: string;
  displayName: string;    // ← 截断后的值，UI 展示更干净
  subLabel: string;
  isBuiltin: boolean;
}

export function buildChatModelOptions(providerItems: ProviderListItem[]): ChatModelOption[] {
  const options: ChatModelOption[] = [];
  for (const { account, vendor } of providerItems) {
    if (HIDDEN_PROVIDER_IDS.has(account.id) || HIDDEN_PROVIDER_IDS.has(account.vendorId)) continue;
    const subLabel = account.label || vendor?.name || account.vendorId;
    const isBuiltin = account.vendorId === 'sto';
    const customModels = account.metadata?.customModels as string[] | undefined;
    if (customModels && customModels.length > 0) {
      for (const rawModelId of customModels) {
        if (HIDDEN_PROVIDER_IDS.has(rawModelId)) continue;
        const normalizedId = normalizeModelIdForChat(rawModelId);
        options.push({
          key: `${account.id}::${rawModelId}`,
          modelId: rawModelId,           // 原始值
          normalizedId,                  // 截断值，用于匹配
          accountId: account.id,
          displayName: normalizedId,     // 截断值，UI 展示
          subLabel,
          isBuiltin,
        });
      }
    } else if (account.model) {
      if (!HIDDEN_PROVIDER_IDS.has(account.model)) {
        const normalizedId = normalizeModelIdForChat(account.model);
        options.push({
          key: `${account.id}::${account.model}`,
          modelId: account.model,
          normalizedId,
          accountId: account.id,
          displayName: account.label || normalizedId,
          subLabel: account.model,
          isBuiltin,
        });
      }
    }
  }
  return options;
}
```

修改 `src/pages/Chat/ChatToolbar.tsx`：

```typescript
// 查找当前选中项：用 normalizedId 匹配
const selectedModel = useMemo(
  () => modelOptions.find((o) => o.normalizedId === selectedModelId),
  [modelOptions, selectedModelId],
);

// 切换模型时：传给 backend 的是原始 modelId
const handleModelSwitch = async (normalizedId: string) => {
  if (!currentSessionKey || normalizedId === selectedModelId) return;

  const opt = modelOptions.find((o) => o.normalizedId === normalizedId);
  const rawModelId = opt?.modelId ?? normalizedId;  // ← 原始值（含前缀）

  setSelectedModelId(normalizedId);
  setModelSaving(true);
  try {
    await hostApiFetch('/api/sessions/model', {
      method: 'POST',
      body: JSON.stringify({
        sessionKey: currentSessionKey,
        model: rawModelId,        // ← 原始值发给 Gateway
        accountId: opt?.accountId,
        agentId: currentAgentId || undefined,
      }),
    });
    void loadSessions();
  } catch (err) { ... }
};
```

---

## 九、文件改动清单

| # | 文件路径 | 操作 | 改动说明 |
|---|---------|------|---------|
| 1 | `electron/services/user-sk-service.ts` | **新增** | 用户 SK 动态获取、缓存、清理服务；**按 SSO 环境选择 SK 接口域名**；**支持"查无则创"（查询无 SK 时自动调用创建接口）**；**请求头 `secret: md5(userCode)` + 请求体 `{ userCode }`**；**响应解析 `data[0].encryptedKey`** |
| 2 | `electron/shared/providers/registry.ts` | 修改 | STO provider `baseUrl` 改为新供应商生产地址（默认值） |
| 3 | `electron/services/providers/sto-model-sync.ts` | 修改 | ① **按 SSO 环境解析新供应商域名**；② 模型列表 URL 改为新供应商定制路径；③ `doSync` 用 SK 替代 stotoken；④ 计算并注入 `secret: md5(工号)` header |
| 4 | `electron/services/providers/provider-runtime-sync.ts` | 修改 | sto 类型同步时，增加 `syncProviderConfigToOpenClaw` 路径注入 `headers.secret` |
| 5 | `electron/services/auth-setup-orchestrator.ts` | 修改 | 登录 setup 流程中插入 `getUserSk()` |
| 6 | `src/lib/chat-model-options.ts` | 修改 | `ChatModelOption` 增加 `normalizedId` 字段，`buildChatModelOptions` 分离 `modelId` 和 `normalizedId` |
| 7 | `src/pages/Chat/ChatToolbar.tsx` | 修改 | ① 匹配用 `normalizedId`；② 切换时传原始 `modelId` |

---

## 十、登录流程时序图

```
用户 SSO 登录成功
    │
    ▼
setAuthUser(user) ──→ 存储 stotoken + userCode
    │
    ▼
runAuthenticatedSetup({ source: 'login' })
    │
    ├── syncSsoAuthToOpenClaw(user)
    ├── syncStoPluginsToOpenClaw()
    │
    ├── 【新增】getUserSk()
    │       ├── getAuthUser() ──→ 获取 userCode
    │       ├── getStoToken()
    │       ├── fetch(SK_API_URL, { secret: md5(userCode), body: { userCode } })
    │       ├── 返回 { code: "0", data: [{ encryptedKey }] }
    │       └── storeApiKey('sto', encryptedKey) ──→ 系统安全存储
    │
    ├── stoModelSync.syncModels({ deferGatewayRefresh: true })
    │       ├── getSsoEnvironment() ──→ 判断生产/测试环境
    │       ├── resolveSupplierDomain() ──→ 选择对应域名
    │       ├── getUserSk() ──→ 从安全存储读取 SK
    │       ├── getAuthUser() ──→ 获取 userCode
    │       ├── md5(userCode) ──→ secretHeader
    │       ├── fetch(新供应商 /custom/v2/model/list)
    │       ├── 创建/更新 ProviderAccount（含 headers: { secret }）
    │       ├── providerService.createAccount(account, sk)
    │       └── syncSavedProviderToRuntime(config, sk)
    │
    ├── syncCustomProviderAgentModel()
    │       ├── syncProviderConfigToOpenClaw(headers: { secret }) ──→ openclaw.json
    │       └── updateAgentModelProvider(apiKey: sk, authHeader: true) ──→ models.json
    │
    ├── bizAgentSync.syncAgents()
    └── Gateway reload
```

---

## 十一、注意事项与降级策略

### 11.1 关键注意点

| 注意点 | 说明 |
|--------|------|
| SK 查询接口 | `POST /openapi/key/detail`，域名 `devops-llmgatewayapi-*`，请求头 `secret: md5(userCode)`，请求体 `{ userCode }` |
| SK 创建接口 | `POST /openapi/key/create`，域名 `devops-llmgatewayapi-*` |
| SK 响应格式 | `{ code, msg, data: [{ encryptedKey, models, ... }] }`，成功判断 `code === "0"` |
| 模型列表来源 | 从 SK detail 接口响应 `data[0].models` 字段解析，无需额外接口 |
| SK 有效期 | 如 SK 有过期时间，需在 `getUserSk()` 中增加刷新逻辑（检查 `data[0].expires`） |
| 工号来源 | `userCode` 从 `AuthUser.code` 或 `AuthUser.empCode` 获取（梧桐工号/轩辕工号） |
| 网络连通性 | 确认 sto-claw 客户端能直接访问新供应商 API 地址（生产/测试域名均需连通） |
| **环境域名映射** | **SK 接口：`devops-llmgatewayapi-*`；Gateway 调用：`devops-llmgateway-*`** |
| **环境判断规则** | **如 SSO 环境标识有变化，需同步更新 `isTestEnvironment()` 的判断条件** |
| **SK 创建接口幂等性** | **需确认供应商 `create` 接口是否幂等（同一用户多次创建返回同一个 SK），避免重复生成不同 SK** |
| **SK 创建并发安全** | **极端情况下多窗口同时登录可能同时触发创建，建议供应商侧做好幂等控制** |

### 11.2 降级策略

如用户 SK 获取失败，可保留原有 memory-center 转发作为 fallback：

```typescript
// user-sk-service.ts
export async function getUserSk(): Promise<string | null> {
  // 1. 先查缓存
  const cached = await getApiKey(SK_PROVIDER_ID);
  if (cached) return cached;

  // 2. 调接口获取 SK
  const sk = await fetchUserSkFromApi();
  if (sk) {
    await storeApiKey(SK_PROVIDER_ID, sk);
    return sk;
  }

  // 3. Fallback：返回 null，sto-model-sync 可选择：
  //    - 跳过本次 sync（STO AI 不可用）
  //    - 或回退到旧逻辑（用 stotoken + memory-center）
  return null;
}
```

### 11.3 用户无感知保障

| 用户可见行为 | 保障措施 |
|-------------|---------|
| 默认供应商 | `setDefaultAccount('sto')` 逻辑不变 |
| 设置面板 | STO AI 仍显示"无需配置"，`requiresApiKey: false` |
| 模型列表 | 下拉框显示截断后的模型名（如 `kimi-k2.6`） |
| 切换供应商 | OpenAI/Anthropic 等切换逻辑完全独立，不受影响 |
| 发消息 | 请求头和模型名对用户完全透明 |

---

## 十二、风险评估

| 风险点 | 等级 | 缓解措施 |
|--------|------|---------|
| 新供应商 API 不稳定 | 中 | 保留 memory-center 转发作为 fallback |
| SK 接口调用失败 | 低 | 缓存机制 + 静默失败不阻塞登录 |
| 模型前缀导致前端匹配问题 | 低 | `normalizedId` 方案已覆盖 |
| 工号为空导致 secret 计算错误 | 低 | 增加空值校验和兜底处理 |

---

*文档版本：v1.0*  
*适用范围：sto-claw 直连新模型供应商改造*  
*核心原则：用户无感知、默认供应商不变、切换逻辑不受影响*
