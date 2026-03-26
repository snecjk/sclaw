# 添加自定义 AI 提供商 - 流程分析

## 一、UI 入口

主要组件在 `src/components/settings/ProvidersSettings.tsx`（约1662行），点击"添加"按钮后打开 `AddProviderDialog` 对话框。

自定义提供商（type = `'custom'`）需要填写以下字段：

| 字段 | 说明 |
|------|------|
| Display Name | 显示名称 |
| API Key | API 密钥 |
| Base URL | 自定义端点，如 `https://api.example.com/v1` |
| Model ID | 模型标识符 |
| API Protocol | 协议类型：`openai-completions` / `openai-responses` / `anthropic-messages` |
| User-Agent (可选) | 自定义请求头 |

## 二、操作流程（数据流）

```
1. 用户点击 "Add Provider" 按钮
      |
2. handleAdd() 前端校验（密钥、模型ID是否为空）
      |
3. 调用 validateAccountApiKey() 验证密钥是否有效
   -> POST /api/provider-accounts/validate
      |
4. 验证通过后 -> useProviderStore.createAccount(account, apiKey)
   -> hostApiFetch('/api/provider-accounts', POST)
      |
5. 经 IPC 通道 'hostapi:fetch' 转发到主进程
      |
6. 路由处理：electron/api/routes/providers.ts:63
   -> providerService.createAccount(account, apiKey)
      |
7. 持久化存储：
   a) 账户信息 -> electron-store (JSON 文件)
   b) API Key -> 双重存储（见第四节）
      |
8. 同步到 OpenClaw 运行时：
   a) 写入 ~/.openclaw/openclaw.json（提供商配置）
   b) 写入 auth-profiles.json（密钥同步）
   c) 必要时重启 Gateway
      |
9. UI 刷新 -> refreshProviderSnapshot()
   -> 关闭对话框 -> 显示成功提示
```

## 三、详细步骤说明

### 3.1 前端校验（ProvidersSettings.tsx handleAdd）

- 检查是否需要 API Key（`typeInfo?.requiresApiKey`），若需要则检查是否为空
- 检查是否需要 Model ID，若需要则检查是否为空
- 若提供了 API Key，调用 `onValidateKey()` 实际验证密钥有效性

### 3.2 密钥验证

- 前端调用 `validateAccountApiKey()`（stores/providers.ts）
- 发起 `POST /api/provider-accounts/validate` 请求
- 主进程路由处理：`electron/api/routes/providers.ts:189-202`
- 使用 `validateApiKeyWithProvider()` 服务实际向目标提供商发起 API 请求确认密钥有效

### 3.3 创建账户

- 构造 `ProviderAccount` 对象，包含所有配置字段
- 调用 `useProviderStore.createAccount(account, apiKey)`
- 通过 `hostApiFetch('/api/provider-accounts', POST)` 发送请求
- 请求体：`{ account: ProviderAccount, apiKey: string }`

### 3.4 主进程处理

- IPC 通道 `hostapi:fetch` 将请求转发到主进程
- 路由 `electron/api/routes/providers.ts:63-72` 接收请求
- 调用 `providerService.createAccount(body.account, body.apiKey)`

### 3.5 运行时同步

- `syncSavedProviderToRuntime()` 将提供商配置写入 `~/.openclaw/openclaw.json`
- API Key 同步到 `auth-profiles.json`（通过 `electron/utils/openclaw-auth.ts` 的 `saveProviderKeyToOpenClaw()`）
- 必要时以8秒去抖重启 Gateway

## 四、API Key 存储位置

API 密钥采用**双重存储**策略，核心逻辑在 `electron/utils/secure-storage.ts`：

| 存储位置 | 说明 |
|----------|------|
| **OS Keychain（系统钥匙串）** | 主存储，通过 `electron/services/secrets/secret-store.ts` 调用操作系统安全凭据管理（Windows 凭据管理器 / macOS Keychain / Linux Secret Service） |
| **electron-store（JSON 文件）** | 备用存储，作为钥匙串不可用时的 fallback，存储在本地 JSON 配置文件中，字段为 `apiKeys[accountId]` |

### 关键函数

| 函数 | 位置 | 说明 |
|------|------|------|
| `storeApiKey()` | secure-storage.ts:51 | 将密钥同时写入系统钥匙串和 electron-store |
| `getApiKey()` | secure-storage.ts:73 | 优先从钥匙串读取，失败则回退到 electron-store |
| `deleteApiKey()` | secure-storage.ts:96 | 同时从两个位置删除密钥 |
| `maskApiKey()` | provider-service.ts:36 | 脱敏显示：前4位***后4位 |

### 读取优先级

`getApiKey()` 先从系统钥匙串读取，如果失败则回退到 electron-store。

### 安全措施

- 展示时通过 `maskApiKey()` 脱敏显示（前4位***后4位）
- 删除提供商时两个存储位置的密钥同时清除
- 渲染进程永远无法直接访问明文密钥

## 五、ProviderAccount 数据结构

```typescript
interface ProviderAccount {
  id: string;                        // 唯一标识符（如 "custom-uuid"）
  vendorId: ProviderType;            // 供应商类型，自定义为 "custom"
  label: string;                     // 用户设置的显示名称
  authMode: ProviderAuthMode;        // 认证方式，自定义提供商为 "api_key"
  baseUrl?: string;                  // API 端点地址
  apiProtocol?: string;              // 协议类型
  headers?: Record<string, string>;  // 自定义请求头（如 User-Agent）
  model?: string;                    // 模型标识符
  fallbackModels?: string[];         // 备用模型列表
  fallbackAccountIds?: string[];     // 备用提供商账户列表
  enabled: boolean;                  // 是否启用
  isDefault: boolean;                // 是否为默认提供商
  metadata?: {
    region?: string;
    email?: string;
    resourceUrl?: string;
    customModels?: string[];
  };
  createdAt: string;                 // 创建时间（ISO 格式）
  updatedAt: string;                 // 更新时间（ISO 格式）
}
```

## 六、关键文件一览

### 渲染进程（UI）

| 文件 | 说明 |
|------|------|
| `src/components/settings/ProvidersSettings.tsx` | 提供商设置主组件（含 AddProviderDialog） |
| `src/stores/providers.ts` | Zustand 状态管理 |
| `src/lib/providers.ts` | 提供商类型定义与工具函数 |
| `src/lib/provider-accounts.ts` | 账户相关工具函数 |
| `src/lib/host-api.ts` | 前端到主进程的通信层 |
| `src/lib/api-client.ts` | API 客户端传输逻辑 |

### 主进程（Electron）

| 文件 | 说明 |
|------|------|
| `electron/api/routes/providers.ts` | HTTP 路由处理（CRUD 操作） |
| `electron/services/providers/provider-service.ts` | 核心业务逻辑 |
| `electron/services/providers/provider-store.ts` | 提供商持久化 |
| `electron/services/providers/provider-validation.ts` | API Key 验证 |
| `electron/services/providers/provider-runtime-sync.ts` | 同步到 OpenClaw Gateway |
| `electron/utils/secure-storage.ts` | API Key 安全存储 |
| `electron/services/secrets/secret-store.ts` | 系统钥匙串封装 |
| `electron/utils/openclaw-auth.ts` | OpenClaw 认证配置同步 |

### 类型定义

| 文件 | 说明 |
|------|------|
| `electron/shared/providers/types.ts` | Provider 类型定义 |
| `electron/shared/providers/registry.ts` | Provider 注册表 |

## 七、API 端点

### 账户管理（当前使用）

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/provider-accounts` | 获取所有账户列表 |
| POST | `/api/provider-accounts` | 创建新账户 |
| PUT | `/api/provider-accounts/{accountId}` | 更新账户 |
| DELETE | `/api/provider-accounts/{accountId}` | 删除账户 |
| GET | `/api/provider-accounts/default` | 获取默认账户 |
| PUT | `/api/provider-accounts/default` | 设置默认账户 |
| POST | `/api/provider-accounts/validate` | 验证 API Key |

### OAuth 流程

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/providers/oauth/start` | 启动 OAuth 认证 |
| POST | `/api/providers/oauth/cancel` | 取消 OAuth 流程 |
| POST | `/api/providers/oauth/submit` | 提交手动授权码 |

## 八、设计要点总结

1. **前端不直接访问 Gateway**：所有请求通过 IPC 代理到主进程，避免 CORS 和环境漂移问题
2. **API Key 双重持久化**：优先使用 OS 钥匙串（安全），electron-store JSON 文件作为 fallback
3. **添加后自动同步**：写入 `openclaw.json` 和 `auth-profiles.json`，必要时重启 Gateway
4. **添加前验证密钥**：实际向目标提供商发起请求确认密钥有效
5. **脱敏展示**：API Key 在 UI 中始终以掩码形式显示
