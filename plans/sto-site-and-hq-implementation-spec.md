# Sto-Claw 网点与非网点令牌隔离开发需求说明书

> **文档用途**：本文档为 Agent 开发用整合文档，包含完整需求说明、设计方案、接口规范、代码实现指引。
> **目标**：Agent 读完本文档即可进行精准、全面的开发，无需查阅其他设计文档。
> **架构方案**：策略模式（v0.4）
> **日期**：2026-06-18

***

## 第一部分：需求背景

### 1.1 业务现状

StoClaw 是跨平台 Electron 桌面应用（React 19 + Vite + TypeScript），为申通快递员工提供 AI 对话能力。应用登录后，会从申通内部"大模型令牌平台"获取用户专属 API Key（SK），写入 `sto` ProviderAccount，供 Gateway 转发消息时鉴权使用。

当前**所有用户**（总部、省区、网点）走同一套接口：

- 域名：`devops-llmgatewayapi.sto.cn`
- tenantCode：`enterprise-Intelligence`（硬编码）
- 鉴权：`md5(userCode)`
- 接口：3 个（查询 Key / 创建 Key / 额度扩容）

### 1.2 问题

网点用户（独立网点、承包区等）需要使用**完全独立的接口体系**，供应商为网点提供了专门的对接文档，与非网点在以下维度全部不同：

| 维度     | 非网点（现状）                       | 网点（新需求）                             |
| ------ | ----------------------------- | ----------------------------------- |
| 域名     | `devops-llmgatewayapi.sto.cn` | `devops-llmgatewayleague.sto.cn`    |
| 架构     | 扁平单层（用户→令牌）                   | 分层二级（租户→令牌）                         |
| 接口数    | 3 个                           | 8 个                                 |
| 鉴权     | 统一 `md5(userCode)`            | 每个接口 MD5 输入组合不同                     |
| 查询 Key | POST，仅需 `userCode`            | GET，必须 `tokenId + tenantCode`       |
| 创建 Key | 2 个参数                         | 6 个参数（含 quotaAmount）                |
| 响应结构   | `{ code, msg, data: [...] }`  | `{ success, message, data: {...} }` |
| 租户     | 运维预分配，客户端不关心                  | 客户端动态创建（每个网点公司一个租户）                 |

当前代码中虽然有 `isSiteUser()` 分流判断，但网点分支只是"不带 tenantCode"，仍然调非网点域名和接口，**逻辑错误**。

### 1.3 用户区分方式

通过 `isSiteUser(categoryCode)` 函数判断（已实现，定义在 `shared/site-user-utils.ts`）：

- 从 Apollo 配置键 `cli.registry.security.scope.group.site` 加载网点类别类型集合
- 检查用户 `categoryCode` 是否命中该集合
- Apollo 未加载时返回 `false`（走非网点逻辑，安全兜底）

**网点租户编码生成规则**（客户端生成，非接口返回）：

```
tenantCode = "enterprise-" + companyCode
```

***

## 第二部分：总体设计

### 2.1 架构：策略模式

两种场景（网点/非网点）的**对外功能完全对应**，抽取同级策略接口 `StoSkStrategy`，各自实现，入口层零 if/else。

```
入口层 (user-sk-service.ts, sto-model-sync.ts)
    │  调 strategy.xxx(user, ...)
    │  零 if/else
    ▼
StoSkStrategy 接口
    │
    ├── HqSkStrategy (非网点)        ← 从现有代码迁移，逻辑零修改
    │     域名: gatewayapi
    │     鉴权: md5(userCode)
    │     响应: {code,msg,data:[]}
    │
    └── SiteSkStrategy (网点)        ← 全新实现
          域名: gatewayleague
          鉴权: 各接口不同
          响应: {success,message,data:{}}
    │
    ▼
sto ProviderAccount (id='sto', 统一)
渲染端零改动
```

### 2.2 设计原则

1. **一个 ProviderAccount**：网点与非网点共用 `sto` ProviderAccount，隔离在令牌级
2. **API 层完全隔离**：两套 API 体系各自独立模块，不交叉复用底层 fetch 函数
3. **入口层零 if/else**：通过策略委托，入口层只调 `strategy.xxx()`
4. **渲染端零改动**：所有前端 UI 通过 `defaultAccountId='sto'` 自动适配
5. **网点前置租户初始化**：网点用户获取 SK 前必须先完成租户初始化流程

### 2.3 文件结构

```
electron/services/
├── sto-sk-strategy.ts          ← 新增：策略接口 + 工厂函数
├── sto-hq-sk-strategy.ts       ← 新增：非网点策略（从 user-sk-service.ts 迁移）
├── sto-site-sk-strategy.ts     ← 新增：网点策略（全新实现）
├── user-sk-service.ts          ← 改造：简化为策略委托入口
└── providers/
    └── sto-model-sync.ts       ← 改造：doSync 用 strategy.getUserModels()
```

***

## 第三部分：策略接口设计

### 3.1 `sto-sk-strategy.ts`（策略接口 + 工厂）

```typescript
import type { SsoUserInfo } from '../utils/auth-store';
import { isSiteUser } from '../../shared/site-user-utils';

/**
 * STO SK 策略接口
 * 网点与非网点各自实现，入口层通过 resolveStrategy() 选择
 */
export interface StoSkStrategy {
  /** 获取用户 SK（明文，优先读缓存） */
  getUserSk(user: SsoUserInfo, forceRefresh: boolean): Promise<string | null>;

  /** 获取 SK 详情（额度信息，不解密 SK） */
  getUserSkDetail(
    user: SsoUserInfo,
  ): Promise<{ tokenId: string; spend: number; maxBudget: number } | null>;

  /** 获取可见模型列表 */
  getUserModels(user: SsoUserInfo): Promise<string[] | null>;

  /** 扩容额度（amount 语义由实现决定：非网点=目标值，网点=增加值） */
  expandQuota(
    user: SsoUserInfo,
    tokenId: string,
    amount: number,
  ): Promise<{ success: boolean; message?: string }>;

  /** 清理缓存（登出/切换登录时调用） */
  clearCache(user: SsoUserInfo): Promise<void>;
}

/**
 * 策略工厂：根据用户类型返回策略实例
 * Apollo 未加载时返回非网点策略（安全兜底）
 */
export function resolveStrategy(user: SsoUserInfo | null): StoSkStrategy | null {
  if (!user?.categoryCode) return null;
  // 延迟导入避免循环依赖
  const { getHqSkStrategy } = require('./sto-hq-sk-strategy');
  const { getSiteSkStrategy } = require('./sto-site-sk-strategy');
  return isSiteUser(user.categoryCode) ? getSiteSkStrategy() : getHqSkStrategy();
}
```

**设计要点**：

- 所有方法第一个参数是 `SsoUserInfo`，让策略实现不依赖全局状态，易测试
- `expandQuota` 的 `amount` 语义由实现决定——非网点视为"目标值"，网点视为"增加值"
- `clearCache` 接收 `user`——网点需要按 `tenantCode + userCode` 精确清理 tokenId 缓存

***

## 第四部分：非网点策略实现（迁移现有代码）

### 4.1 接口规范（非网点）

#### 4.1.1 域名

| 环境 | 域名                                         |
| -- | ------------------------------------------ |
| 生产 | `https://devops-llmgatewayapi.sto.cn`      |
| 测试 | `https://devops-llmgatewayapi-test.sto.cn` |

#### 4.1.2 接口列表

**查询 Key**

| 项   | 值                                                                                              |
| --- | ---------------------------------------------------------------------------------------------- |
| 路径  | `POST /openapi/key/detail`                                                                     |
| 鉴权  | `secret = md5(userCode)`                                                                       |
| 请求体 | `{ "userCode": "xxx" }`（tenantCode 可选）                                                         |
| 响应  | `{ code: "0", msg, data: [{ tokenId, encryptedKey, models, status, spend, maxBudget, ... }] }` |

**创建 Key**

| 项   | 值                                                                                                |
| --- | ------------------------------------------------------------------------------------------------ |
| 路径  | `POST /openapi/key/create`                                                                       |
| 鉴权  | `secret = md5(userCode)`                                                                         |
| 请求体 | `{ "userCode": "xxx", "tenantCode": "enterprise-Intelligence" }`                                 |
| 响应  | `{ code: "0", msg, data: { tokenId, encryptedKey, models, quotaAmount, ... } }`（注意 data 是对象不是数组） |

**额度扩容**

| 项   | 值                                                   |
| --- | --------------------------------------------------- |
| 路径  | `POST /openapi/key/quota/expansion`                 |
| 鉴权  | `secret = md5(tokenId)`                             |
| 请求体 | `{ "tokenId": "xxx", "quotaAmount": 800 }`（扩容至目标金额） |
| 响应  | `{ code: "0", msg, data: [...] }`                   |

#### 4.1.3 AES 解密

- 算法：AES-128-ECB + Base64
- 密钥：`2074c2350686f0e4`（16 字节）
- 对应 Java 端 `AesEncryptUtil.decrypt`

### 4.2 `sto-hq-sk-strategy.ts` 实现指引

**从现有** **`user-sk-service.ts`** **原封不动迁移以下内容**，包装成 `HqSkStrategy` 类：

```typescript
import type { StoSkStrategy } from './sto-sk-strategy';
import type { SsoUserInfo } from '../utils/auth-store';
import { getStoToken } from '../utils/auth-store';
import { storeApiKey, getApiKey, deleteApiKey } from '../utils/secure-storage';
import { logger } from '../utils/logger';
import crypto from 'crypto';

export class HqSkStrategy implements StoSkStrategy {
  private static readonly CACHE_KEY = 'sto';
  private static readonly DEFAULT_TENANT_CODE = 'enterprise-Intelligence';
  private static readonly AES_KEY = '2074c2350686f0e4';

  private static readonly API_DOMAINS: Record<string, string> = {
    prod: 'https://devops-llmgatewayapi.sto.cn',
    test: 'https://devops-llmgatewayapi-test.sto.cn',
  };

  async getUserSk(user: SsoUserInfo, forceRefresh: boolean): Promise<string | null> {
    if (!forceRefresh) {
      const cached = await getApiKey(HqSkStrategy.CACHE_KEY);
      if (cached) return cached;
    }

    const token = await getStoToken();
    if (!token) return null;

    const tenantCode = HqSkStrategy.DEFAULT_TENANT_CODE;
    let sk = await this.fetchSkFromApi('query', token, user.code, tenantCode);
    if (!sk) {
      sk = await this.fetchSkFromApi('create', token, user.code, tenantCode);
    }
    if (sk) await storeApiKey(HqSkStrategy.CACHE_KEY, sk);
    return sk;
  }

  async getUserSkDetail(user: SsoUserInfo) {
    // 原 getUserSkDetail() 的非网点逻辑
  }

  async getUserModels(user: SsoUserInfo): Promise<string[] | null> {
    const token = await getStoToken();
    if (!token) return null;
    const detail = await this.queryKeyDetail(token, user.code, HqSkStrategy.DEFAULT_TENANT_CODE);
    return detail?.models ?? null;
  }

  async expandQuota(user: SsoUserInfo, tokenId: string, amount: number) {
    // 原 expandUserSkQuota() 逻辑，amount 语义=目标值
  }

  async clearCache(user: SsoUserInfo): Promise<void> {
    await deleteApiKey(HqSkStrategy.CACHE_KEY);
  }

  // ─── 私有方法（从 user-sk-service.ts 原样迁移）───
  // decryptSk()           ← 原样
  // isTestEnvironment()   ← 原样
  // resolveApiDomain()    ← 原样
  // fetchSkFromApi()      ← 原样
  // queryKeyDetail()      ← 从 getUserSkDetail 抽出
}

let instance: HqSkStrategy | null = null;
export function getHqSkStrategy(): HqSkStrategy {
  if (!instance) instance = new HqSkStrategy();
  return instance;
}
```

**迁移要点**：

- 所有函数从 `user-sk-service.ts` 原样搬过来，改为类方法
- 常量改为 `private static readonly`
- **一行业务逻辑都不改**
- 新增 `getUserModels()` 方法，从 `fetchRemoteModels()` 逻辑抽出，仅返回 `string[]`

***

## 第五部分：网点策略实现（全新）

### 5.1 接口规范（网点）

#### 5.1.1 域名

| 环境 | 域名                                            |
| -- | --------------------------------------------- |
| 生产 | `https://devops-llmgatewayleague.sto.cn`      |
| 测试 | `https://devops-llmgatewayleague-test.sto.cn` |

#### 5.1.2 接口列表（核心 5 个）

**① 查询租户令牌列表** `/openapi/tenant/keylist`

| 项  | 值                                                                                                                                  |
| -- | ---------------------------------------------------------------------------------------------------------------------------------- |
| 方法 | **GET**                                                                                                                            |
| 路径 | `/openapi/tenant/keylist?tenantCode=xxx`                                                                                           |
| 鉴权 | `secret = md5(tenantCode)`                                                                                                         |
| 响应 | `{ success, message, data: { keyList: [{ tokenId, encryptedKey, models, userCode, userName, status, quotaAmount, quotaUsed }] } }` |

**注意**：响应示例中字段名为 `key`，参数表为 `encryptedKey`，代码需兼容处理 `item.encryptedKey ?? item.key`。

**② 查询租户** `/openapi/tenant/detail`

| 项     | 值                                                                                           |
| ----- | ------------------------------------------------------------------------------------------- |
| 方法    | **GET**                                                                                     |
| 路径    | `/openapi/tenant/detail?tenantCode=xxx`                                                     |
| 鉴权    | `secret = md5(tenantCode)`                                                                  |
| 响应    | `{ success, message, data: { tenantCode, tenantName, adminUserCode, resourceTotal, ... } }` |
| 租户不存在 | `{ success: false, message: "查询租户失败: 租户 xxx 不存在" }`                                         |

**③ 创建租户** `/openapi/tenant/create`

| 项   | 值                                                                                                   |
| --- | --------------------------------------------------------------------------------------------------- |
| 方法  | **POST**                                                                                            |
| 鉴权  | `secret = md5(tenantCode + adminUserCode)`                                                          |
| 请求体 | `{ tenantCode, tenantName, adminUserCode, adminUserName, operatorCode, operatorName, quotaAmount }` |
| 响应  | `{ success, message, data: { tenantCode, ... } }`                                                   |
| 幂等  | "租户编码已存在" 视为成功                                                                                      |

**④ 创建令牌** `/openapi/key/create`

| 项   | 值                                                                                    |
| --- | ------------------------------------------------------------------------------------ |
| 方法  | **POST**                                                                             |
| 鉴权  | `secret = md5(tenantCode + userCode)`                                                |
| 请求体 | `{ tenantCode, quotaAmount, userCode, userName, operatorCode, operatorName }`        |
| 响应  | `{ success, message, data: { tokenId, encryptedKey, models, quotaAmount, status } }` |
| 异常  | "用户已存在令牌" → 回退查 keylist                                                              |

**⑤ 查询令牌详情** `/openapi/key/detail`

| 项  | 值                                                                                                           |
| -- | ----------------------------------------------------------------------------------------------------------- |
| 方法 | **GET**                                                                                                     |
| 路径 | `/openapi/key/detail?tokenId=xxx&tenantCode=xxx`                                                            |
| 鉴权 | `secret = md5(tenantCode + tokenId)`                                                                        |
| 响应 | `{ success, message, data: { tokenId, encryptedKey, models, quotaAmount, quotaUsed, status, tenantCode } }` |

#### 5.1.3 辅助接口（按需）

**令牌扩容** `/openapi/resourcePack/personalBuy`

| 项   | 值                                                                                   |
| --- | ----------------------------------------------------------------------------------- |
| 方法  | POST                                                                                |
| 鉴权  | `secret = md5(tenantCode + tokenId)`                                                |
| 请求体 | `{ tokenId, tenantCode, addQuotaAmount, operatorCode, operatorName }`（**增加值**，非目标值） |

其他辅助接口（租户购买资源包、租户分配令牌额度、查询用量）暂不实现。

#### 5.1.4 AES 解密

- 算法：AES-128-ECB + Base64（与非网点相同）
- 密钥：`2074c2350686f0e4`（✅ 已确认与非网点相同）

### 5.2 网点租户初始化流程

```
网点用户登录 → 需获取 SK
│
├── ① 生成 tenantCode = "enterprise-${companyCode}"
│
├── ② 读 tokenId 缓存
│   ├── 命中 → 跳到 ⑤
│   └── 未命中 → 继续 ③
│
├── ③ 查 keylist 找当前用户的令牌
│   ├── 找到 status='ENABLE' → 缓存 tokenId → 跳到 ⑤
│   ├── 找到但 status≠'ENABLE' → 返回 null（令牌禁用/超额）
│   └── 未找到 → 继续 ④
│
├── ④ 确保租户存在 → 创建令牌
│   ├── 查租户 detail → 不存在则 createTenant
│   ├── createKey 创建令牌
│   ├── createKey 返回"已有令牌" → 回退查 keylist
│   └── 成功 → 缓存 tokenId → 跳到 ⑤
│
├── ⑤ 查令牌详情（key/detail）
│   ├── status='ENABLE' → 解密 encryptedKey → 返回 { sk, tokenId, tenantCode, models, quota }
│   └── status≠'ENABLE' → 返回 null
│
└── 返回 SiteKeyBundle
```

### 5.3 `sto-site-sk-strategy.ts` 完整实现指引

```typescript
import type { StoSkStrategy } from './sto-sk-strategy';
import type { SsoUserInfo } from '../utils/auth-store';
import { getSsoEnvironment } from '../utils/auth-store';
import { storeApiKey, getApiKey, deleteApiKey } from '../utils/secure-storage';
import { logger } from '../utils/logger';
import crypto from 'crypto';

export class SiteSkStrategy implements StoSkStrategy {
  private static readonly SK_CACHE_KEY = 'sto-site-sk';
  private static readonly TOKEN_ID_CACHE_PREFIX = 'sto-site-token-id:';
  private static readonly AES_KEY = '2074c2350686f0e4'; // ✅ 已确认，与非网点相同
  private static readonly DEFAULT_QUOTA = 0; // ✅ 已确认
  private static readonly TIMEOUT_MS = 8000;

  private static readonly API_DOMAINS: Record<string, string> = {
    prod: 'https://devops-llmgatewayleague.sto.cn',
    test: 'https://devops-llmgatewayleague-test.sto.cn',
  };

  // ─── 接口实现 ───

  async getUserSk(user: SsoUserInfo, forceRefresh: boolean): Promise<string | null> {
    if (!forceRefresh) {
      const cached = await getApiKey(SiteSkStrategy.SK_CACHE_KEY);
      if (cached) return cached;
    }
    const bundle = await this.ensureKeyBundle(user);
    if (!bundle) return null;
    await storeApiKey(SiteSkStrategy.SK_CACHE_KEY, bundle.sk);
    return bundle.sk;
  }

  async getUserSkDetail(user: SsoUserInfo) {
    const bundle = await this.ensureKeyBundle(user);
    if (!bundle) return null;
    // 统一返回值：quotaUsed→spend, quotaAmount→maxBudget
    return {
      tokenId: bundle.tokenId,
      spend: bundle.quotaUsed,
      maxBudget: bundle.quotaAmount,
    };
  }

  async getUserModels(user: SsoUserInfo): Promise<string[] | null> {
    // 复用 ensureKeyBundle 缓存，不重复查询
    const bundle = await this.ensureKeyBundle(user);
    return bundle?.models ?? null;
  }

  async expandQuota(user: SsoUserInfo, tokenId: string, amount: number) {
    // 网点语义：amount 是"增加值"
    const tenantCode = this.generateTenantCode(user.companyCode);
    const domain = await this.resolveApiDomain();
    const secret = this.md5(tenantCode + tokenId);
    const url = `${domain}/openapi/resourcePack/personalBuy`;
    const body = {
      tokenId,
      tenantCode,
      addQuotaAmount: amount,
      operatorCode: user.code,
      operatorName: user.userName,
    };
    // ... POST 请求 ...
  }

  async clearCache(user: SsoUserInfo): Promise<void> {
    await deleteApiKey(SiteSkStrategy.SK_CACHE_KEY);
    if (user.companyCode) {
      const tenantCode = this.generateTenantCode(user.companyCode);
      await deleteApiKey(this.tokenIdCacheKey(tenantCode, user.code));
    }
  }

  // ─── 核心：租户初始化 + 一次性获取全量信息 ───

  private async ensureKeyBundle(user: SsoUserInfo): Promise<SiteKeyBundle | null> {
    // 防御性检查
    if (!user.companyCode) {
      logger.warn('[site-sk] companyCode is empty');
      return null;
    }

    const tenantCode = this.generateTenantCode(user.companyCode);

    // Step 1: 读 tokenId 缓存
    let tokenId = await this.getCachedTokenId(tenantCode, user.code);

    // Step 2: 缓存未命中 → 查 keylist
    if (!tokenId) {
      tokenId = await this.findTokenIdFromKeyList(tenantCode, user.code);
      if (tokenId) {
        await this.cacheTokenId(tenantCode, user.code, tokenId);
      }
    }

    // Step 3: 无令牌 → 确保租户 → 创建令牌
    if (!tokenId) {
      tokenId = await this.ensureTenantAndCreateKey(user, tenantCode);
      if (tokenId) {
        await this.cacheTokenId(tenantCode, user.code, tokenId);
      }
    }

    if (!tokenId) return null;

    // Step 4: 查令牌详情
    const detail = await this.fetchKeyDetail(tokenId, tenantCode);
    if (!detail || detail.status !== 'ENABLE') {
      logger.warn(`[site-sk] Key unavailable, status=${detail?.status}`);
      return null;
    }

    // Step 5: 解密 SK
    let sk: string;
    try {
      sk = this.decryptSk(detail.encryptedKey);
    } catch (err) {
      logger.warn('[site-sk] AES decrypt failed:', err);
      return null;
    }

    return {
      sk,
      tokenId: detail.tokenId,
      tenantCode,
      models: detail.models,
      quotaAmount: detail.quotaAmount,
      quotaUsed: detail.quotaUsed,
      status: detail.status,
    };
  }

  // ─── 私有：流程辅助 ───

  /** 从 keylist 中找当前用户的 ENABLE 令牌 */
  private async findTokenIdFromKeyList(
    tenantCode: string,
    userCode: string,
  ): Promise<string | null> {
    const keyList = await this.fetchTenantKeyList(tenantCode);
    if (!keyList?.keyList) return null;
    const myKey = keyList.keyList.find(
      (k) => k.userCode === userCode && k.status === 'ENABLE',
    );
    return myKey?.tokenId ?? null;
  }

  /** 确保租户存在 + 创建令牌，返回 tokenId */
  private async ensureTenantAndCreateKey(
    user: SsoUserInfo,
    tenantCode: string,
  ): Promise<string | null> {
    // 确保租户存在
    let tenantExists = (await this.fetchTenantDetail(tenantCode)) != null;
    if (!tenantExists) {
      tenantExists = await this.createTenant(
        tenantCode,
        user.companyName ?? tenantCode, // 🔴 待确认 tenantName
        user.code,
        user.userName, // 🔴 待确认 userName vs realName
        SiteSkStrategy.DEFAULT_QUOTA,
      );
    }
    if (!tenantExists) return null;

    // 创建令牌
    const keyResult = await this.createKey(
      tenantCode,
      user.code,
      user.userName, // 🔴 待确认
      SiteSkStrategy.DEFAULT_QUOTA,
    );

    if (keyResult) {
      return keyResult.tokenId;
    }

    // 创建失败（可能"已有令牌"）→ 回退查 keylist
    logger.info('[site-sk] Key create failed, retrying keylist');
    return this.findTokenIdFromKeyList(tenantCode, user.code);
  }

  // ─── 私有：底层接口封装 ───

  private async fetchTenantKeyList(
    tenantCode: string,
  ): Promise<SiteTenantKeyListData | null> {
    const domain = await this.resolveApiDomain();
    const url = `${domain}/openapi/tenant/keylist?tenantCode=${encodeURIComponent(tenantCode)}`;
    const secret = this.md5(tenantCode);

    try {
      const response = await this.fetchWithTimeout(url, {
        method: 'GET',
        headers: { secret, 'Content-Type': 'application/json' },
      });
      if (!response.ok) return null;
      const json = (await response.json()) as SiteApiResponse<SiteTenantKeyListData>;
      if (!json.success || !json.data) return null;
      return json.data;
    } catch (err) {
      logger.warn('[site-sk] keylist error:', err);
      return null;
    }
  }

  private async fetchTenantDetail(
    tenantCode: string,
  ): Promise<SiteTenantDetailData | null> {
    const domain = await this.resolveApiDomain();
    const url = `${domain}/openapi/tenant/detail?tenantCode=${encodeURIComponent(tenantCode)}`;
    const secret = this.md5(tenantCode);
    // ... GET 请求，返回 data 或 null（租户不存在）...
  }

  private async createTenant(
    tenantCode: string,
    tenantName: string,
    adminUserCode: string,
    adminUserName: string,
    quotaAmount: number,
  ): Promise<boolean> {
    const domain = await this.resolveApiDomain();
    const url = `${domain}/openapi/tenant/create`;
    const secret = this.md5(tenantCode + adminUserCode);
    const body = {
      tenantCode,
      tenantName,
      adminUserCode,
      adminUserName,
      operatorCode: adminUserCode, // 🔴 待确认是否相同
      operatorName: adminUserName, // 🔴 待确认
      quotaAmount,
    };
    // ... POST 请求 ...
    // 幂等处理：message 包含 "已存在" 视为成功
  }

  private async createKey(
    tenantCode: string,
    userCode: string,
    userName: string,
    quotaAmount: number,
  ): Promise<SiteKeyCreateData | null> {
    const domain = await this.resolveApiDomain();
    const url = `${domain}/openapi/key/create`;
    const secret = this.md5(tenantCode + userCode);
    const body = {
      tenantCode,
      quotaAmount,
      userCode,
      userName,
      operatorCode: userCode, // 🔴 待确认
      operatorName: userName, // 🔴 待确认
    };
    // ... POST 请求 ...
  }

  private async fetchKeyDetail(
    tokenId: string,
    tenantCode: string,
  ): Promise<SiteKeyDetailData | null> {
    const domain = await this.resolveApiDomain();
    const url = `${domain}/openapi/key/detail?tokenId=${encodeURIComponent(tokenId)}&tenantCode=${encodeURIComponent(tenantCode)}`;
    const secret = this.md5(tenantCode + tokenId);
    // ... GET 请求 ...
  }

  // ─── 私有：工具 ───

  private md5(input: string): string {
    return crypto.createHash('md5').update(input).digest('hex');
  }

  private generateTenantCode(companyCode: string): string {
    return `enterprise-${companyCode}`;
  }

  private decryptSk(encrypted: string): string {
    const key = Buffer.from(SiteSkStrategy.AES_KEY, 'utf-8');
    const decipher = crypto.createDecipheriv('aes-128-ecb', key, null);
    return decipher.update(encrypted, 'base64', 'utf-8') + decipher.final('utf-8');
  }

  private async resolveApiDomain(): Promise<string> {
    const env = await getSsoEnvironment();
    return this.isTestEnvironment(env) ? SiteSkStrategy.API_DOMAINS.test : SiteSkStrategy.API_DOMAINS.prod;
  }

  private isTestEnvironment(env?: string | null): boolean {
    const normalized = env?.trim().toLowerCase() || '';
    return ['test', 'pre-release', 'daily', 'daily-external'].some((e) => normalized.includes(e));
  }

  /** 统一 fetch + 超时控制 */
  private async fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), SiteSkStrategy.TIMEOUT_MS);
    try {
      return await fetch(url, { ...init, signal: controller.signal });
    } finally {
      clearTimeout(timeoutId);
    }
  }

  // ─── 私有：tokenId 缓存 ───

  private tokenIdCacheKey(tenantCode: string, userCode: string): string {
    return `${SiteSkStrategy.TOKEN_ID_CACHE_PREFIX}${tenantCode}:${userCode}`;
  }

  private async getCachedTokenId(tenantCode: string, userCode: string): Promise<string | null> {
    return getApiKey(this.tokenIdCacheKey(tenantCode, userCode));
  }

  private async cacheTokenId(tenantCode: string, userCode: string, tokenId: string): Promise<void> {
    await storeApiKey(this.tokenIdCacheKey(tenantCode, userCode), tokenId);
  }

  /** 兼容 keylist 中 encryptedKey / key 字段名 */
  private extractEncryptedKey(item: { encryptedKey?: string; key?: string }): string | undefined {
    return item.encryptedKey ?? item.key;
  }
}

// ─── 类型定义 ───

interface SiteApiResponse<T> {
  success: boolean;
  message: string;
  data?: T;
}

interface SiteTenantKeyListData {
  tenantCode: string;
  keyList: Array<{
    tokenId: string;
    encryptedKey?: string;
    key?: string; // 文档示例用 key，兼容处理
    models: string[];
    userCode: string;
    userName: string;
    status: string;
    quotaAmount: number;
    quotaUsed: number;
  }>;
}

interface SiteTenantDetailData {
  tenantCode: string;
  tenantName: string;
  adminUserCode: string;
  resourceTotal: number;
  remainingAmount: number;
}

interface SiteKeyCreateData {
  tokenId: string;
  encryptedKey: string;
  models: string[];
  userCode: string;
  quotaAmount: number;
  status: string;
}

interface SiteKeyDetailData {
  tokenId: string;
  encryptedKey: string;
  models: string[];
  quotaAmount: number;
  quotaUsed: number;
  status: string;
  tenantCode: string;
}

interface SiteKeyBundle {
  sk: string;
  tokenId: string;
  tenantCode: string;
  models: string[];
  quotaAmount: number;
  quotaUsed: number;
  status: string;
}

// ─── 单例 ───

let instance: SiteSkStrategy | null = null;
export function getSiteSkStrategy(): SiteSkStrategy {
  if (!instance) instance = new SiteSkStrategy();
  return instance;
}
```

***

## 第六部分：入口层改造

### 6.1 `user-sk-service.ts`（简化为策略委托）

```typescript
import { getAuthState } from '../utils/auth-store';
import { resolveStrategy } from './sto-sk-strategy';

export async function getUserSk(forceRefresh = false): Promise<string | null> {
  const { user } = await getAuthState();
  const strategy = resolveStrategy(user);
  if (!strategy || !user) return null;
  return strategy.getUserSk(user, forceRefresh);
}

export async function getUserSkDetail() {
  const { user } = await getAuthState();
  const strategy = resolveStrategy(user);
  if (!strategy || !user) return null;
  return strategy.getUserSkDetail(user);
}

export async function expandUserSkQuota(tokenId: string, quotaAmount: number) {
  const { user } = await getAuthState();
  const strategy = resolveStrategy(user);
  if (!strategy || !user) return { success: false, message: 'No user' };
  return strategy.expandQuota(user, tokenId, quotaAmount);
}

export async function clearUserSk(): Promise<void> {
  const { user } = await getAuthState();
  const strategy = resolveStrategy(user);
  if (strategy && user) {
    await strategy.clearCache(user);
  }
}
```

**注意**：原 `user-sk-service.ts` 中的所有实现代码（`fetchSkFromApi`、`decryptSk`、`resolveSkApiDomain` 等）全部迁移到 `sto-hq-sk-strategy.ts`。`user-sk-service.ts` 只保留上述 4 个委托函数。

### 6.2 `sto-model-sync.ts` doSync 改造

**改动位置**：`doSync()` 方法的 Step 2（获取模型列表）

```typescript
private async doSync(options?: StoSyncOptions): Promise<StoSyncResult> {
  // ... Step 1: getUserSk() 不变（内部已通过策略委托）...

  const authState = await getAuthState();
  const user = authState.user;
  if (!user?.code) {
    result.error = 'no-user-code';
    return result;
  }

  // Step 2 — 获取模型列表（策略委托，零 if/else）
  const { resolveStrategy } = await import('../sto-sk-strategy');
  const strategy = resolveStrategy(user);
  let remoteModels: StoRemoteModel[];
  try {
    const models = await strategy?.getUserModels(user);
    remoteModels = (models ?? []).map((id) => ({ id, name: id }));
  } catch (err) {
    result.error = `fetch-failed: ${err}`;
    return result;
  }

  // Step 3+ — 创建/更新 ProviderAccount(id='sto') ← 统一，不区分场景
  const secretHeader = crypto.createHash('md5').update(user.code).digest('hex');
  // ... 原 Step 3-5 逻辑不变 ...
}
```

**改动要点**：

- 删除原 `fetchRemoteModels()` 方法（已由策略接管）
- 删除原 `isSiteUser()` 分流逻辑
- `doSync()` 不再关心用户类型，统一调 `strategy.getUserModels()`

### 6.3 不需要改动的模块

| 模块                                          | 原因                                 |
| ------------------------------------------- | ---------------------------------- |
| 渲染端全部                                       | `defaultAccountId` 始终 `'sto'`，自动适配 |
| `sto-placeholder-utils.ts`                  | 只识别 `sto`，无需改动                     |
| `auth-setup-orchestrator.ts`                | 编排层不变，内部 `syncModels()` 自动分流       |
| `sto-biz-agent-sync.ts`                     | 与令牌隔离方案独立                          |
| `provider-service.ts` / `provider-store.ts` | 存储层不关心 account 内容                  |
| `shared/site-user-utils.ts`                 | `isSiteUser()` 已实现，无需改动            |

***

## 第七部分：ProviderAccount 统一配置

无论网点还是非网点，最终写入的 ProviderAccount 都是同一个：

| 属性                    | 值                             | 说明                 |
| --------------------- | ----------------------------- | ------------------ |
| id                    | `'sto'`                       | ✅ 统一               |
| vendorId              | `'sto'`                       | ✅ 统一               |
| label                 | `'STO AI'`                    | ✅ 统一               |
| baseUrl               | `devops-llmgateway.sto.cn/v1` | ✅ 网点与非网点相同         |
| authMode              | `'api_key'`                   | ✅ 统一               |
| apiProtocol           | `'openai-completions'`        | ✅ 统一               |
| headers.secret        | `md5(userCode)`               | ✅ 已确认，网点鉴权变化比非网点更多 |
| metadata.managedBy    | `'sto-auto-sync'`             | ✅ 统一               |
| metadata.customModels | 各自的模型列表                       | 核心差异点              |
| defaultAccountId      | `'sto'`                       | ✅ 始终 sto           |

**缓存隔离**：

| 缓存项        | 非网点           | 网点                                                  |
| ---------- | ------------- | --------------------------------------------------- |
| SK 缓存      | key = `'sto'` | key = `'sto-site-sk'`                               |
| tokenId 缓存 | 无             | key = `'sto-site-token-id:{tenantCode}:{userCode}'` |

切换登录时 `clearUserSk()` 调用 `strategy.clearCache(user)`，各自清理。

***

## 第八部分：边界场景处理

| 场景                             | 处理策略                                                                     |
| ------------------------------ | ------------------------------------------------------------------------ |
| **网点→非网点切换登录**                 | `clearUserSk()` 清理网点缓存 → `getUserSk()` 走非网点策略 → 更新 `sto` 的 customModels  |
| **非网点→网点切换登录**                 | `clearUserSk()` 清理非网点缓存 → `getUserSk()` 走网点策略 → 租户初始化 → 更新 customModels  |
| **Apollo 网点类别未加载**             | `isSiteUser()` 返回 false → 走非网点逻辑（安全兜底）                                   |
| **网点 SK 获取失败**                 | `getUserSk()` 返回 null → `doSync()` 报 `no-sk`                             |
| **网点模型列表为空**                   | `doSync()` 报 `empty-model-list`                                          |
| **租户创建失败（用户非网点人员）**            | `createTenant()` 返回 false → `ensureKeyBundle()` 返回 null                  |
| **令牌创建失败（已有令牌）**               | 回退查 keylist 获取 tokenId                                                   |
| **令牌状态 DISABLED**              | `findTokenIdFromKeyList()` 跳过非 ENABLE 令牌 → 返回 null                       |
| **令牌状态 AUTO\_DISABLED\_QUOTA** | 同上，返回 null（后续可加 toast 提示）                                                |
| **租户初始化幂等**                    | createTenant "已存在" 视为成功；createKey "已有令牌" 回退查 keylist                     |
| **冷启动（已登录网点用户）**               | `runAuthenticatedSetup({source:'startup'})` → `getUserSk()` 走网点策略 → 自动适配 |
| **周期性同步**                      | `syncModels()` 每 20 分钟 → `strategy.getUserModels()` 复用缓存                 |
| **companyCode 为空**             | `ensureKeyBundle()` 入口校验，返回 null                                         |
| **接口超时**                       | 所有网点 API 统一 8 秒超时（`SITE_DEFAULT_TIMEOUT_MS`）                             |

***

## 第九部分：确认清单

### ✅ 阻塞性问题（6 项，已全部确认）

| # | 问题 | 确认结果 | 状态 |
|---|------|----------|------|
| 1 | **网点 Gateway 消息发送域名** | 与非网点相同（`devops-llmgateway.sto.cn`） | ✅ 已确认 |
| 2 | **网点 Gateway 消息发送鉴权方式** | 仍用 `md5(userCode)`，但网点鉴权变化比非网点更多，与文档一致 | ✅ 已确认 |
| 3 | **网点 AES 解密 SECRET_KEY** | 与非网点相同（`2074c2350686f0e4`） | ✅ 已确认 |
| 4 | **keylist 返回字段名** | 返回加密的 key，已做兼容 `??` 处理 | ✅ 已确认 |
| 5 | **secret 计算规则** | 按每个接口指定的参数计算 | ✅ 已确认 |
| 6 | **初始额度 quotaAmount** | 使用 0 | ✅ 已确认 |

### 🟡 重要问题（5 项，可用默认值先实现，后续微调）

| #  | 问题                                            | 当前默认值                 |
| -- | --------------------------------------------- | --------------------- |
| 7  | userName 用 `user.userName` 还是 `user.realName` | 先用 `user.userName`    |
| 8  | adminUserCode 与 operatorCode 关系               | 先用相同值                 |
| 9  | tenantName 来源                                 | 先用 `user.companyName` |
| 10 | keylist 租户不存在时响应                              | 兼容处理 null             |
| 11 | 令牌非 ENABLE 状态提示策略                             | 先返回 null，后续加 toast    |

***

## 第十部分：开发顺序

| 顺序 | 步骤                           | 说明                                  |
| -- | ---------------------------- | ----------------------------------- |
| 1  | 新建 `sto-sk-strategy.ts`      | 策略接口 + 工厂函数（\~40 行）                 |
| 2  | 新建 `sto-hq-sk-strategy.ts`   | 从 `user-sk-service.ts` 迁移非网点逻辑，包装成类 |
| 3  | 改造 `user-sk-service.ts`      | 简化为策略委托入口（\~30 行）                   |
| 4  | 新建 `sto-site-sk-strategy.ts` | 网点策略完整实现（含租户初始化）                    |
| 5  | 改造 `sto-model-sync.ts`       | doSync 用 `strategy.getUserModels()` |
| 6  | 测试                           | 网点/非网点登录、切换登录、周期同步                  |
| 7  | 确认阻塞性问题后微调                   | 根据实际确认结果调整默认值                       |

***

## 第十一部分：验证清单

开发完成后，需验证以下场景：

- [ ] 非网点用户登录 → 获取 SK → 模型列表写入 `sto` → 对话正常
- [ ] 网点用户登录 → 租户初始化 → 获取 SK → 模型列表写入 `sto` → 对话正常
- [ ] 网点→非网点切换登录 → 缓存清理 → 重新获取 SK → 模型列表更新
- [ ] 非网点→网点切换登录 → 缓存清理 → 租户初始化 → 获取 SK → 模型列表更新
- [ ] 网点用户冷启动 → 读缓存 → 正常进入
- [ ] 周期性同步（20 分钟）→ 网点用户 → 复用缓存不重复查询
- [ ] 网点令牌状态 DISABLED → 返回 null → 不崩溃
- [ ] 网点 companyCode 为空 → 返回 null → 不崩溃
- [ ] 渲染端 UI 无改动 → `defaultAccountId='sto'` 自动适配

***

## 附录 A：SsoUserInfo 接口

```typescript
// 定义在 electron/utils/auth-store.ts
export interface SsoUserInfo {
  id: string;
  userName: string;        // 用户名
  realName: string;        // 真实姓名
  code: string;            // 梧桐工号（老系统工号）
  empCode: string;         // 工号（轩辕系统，新系统）
  companyId: string;
  companyCode: string;     // ← 网点租户编码用
  companyName: string;     // ← 网点 tenantName 候选
  departmentId: string;
  departmentCode: string;
  departmentName: string;
  categoryCode: string;    // ← isSiteUser() 判断用
  isAdministrator: boolean;
  loginMode: string;
  openId: string;
  signature: string;
  authenticatedAt: string;
  stoToken?: string;       // SSO token，用于接口鉴权
  stoTokenExpiresAt?: string;
}
```

## 附录 B：现有代码位置参考

| 现有代码                            | 位置                           | 迁移目标                               |
| ------------------------------- | ---------------------------- | ---------------------------------- |
| `getUserSk()` 非网点逻辑             | `user-sk-service.ts:142-182` | `HqSkStrategy.getUserSk()`         |
| `getUserSkDetail()`             | `user-sk-service.ts:187-249` | `HqSkStrategy.getUserSkDetail()`   |
| `expandUserSkQuota()`           | `user-sk-service.ts:254-290` | `HqSkStrategy.expandQuota()`       |
| `clearUserSk()`                 | `user-sk-service.ts:295-298` | `HqSkStrategy.clearCache()`        |
| `fetchSkFromApi()`              | `user-sk-service.ts:73-137`  | `HqSkStrategy.fetchSkFromApi()`    |
| `decryptSk()`                   | `user-sk-service.ts:33-39`   | `HqSkStrategy.decryptSk()`         |
| `resolveSkApiDomain()`          | `user-sk-service.ts:48-51`   | `HqSkStrategy.resolveApiDomain()`  |
| `SkDetailResponse`              | `user-sk-service.ts:53-71`   | `HqSkStrategy` 私有类型                |
| `SK_API_DOMAINS`                | `user-sk-service.ts:24-27`   | `HqSkStrategy.API_DOMAINS`         |
| `DEFAULT_TENANT_CODE`           | `user-sk-service.ts:18`      | `HqSkStrategy.DEFAULT_TENANT_CODE` |
| `AES_DECRYPT_KEY`               | `user-sk-service.ts:21`      | `HqSkStrategy.AES_KEY`             |
| `fetchRemoteModels()`           | `sto-model-sync.ts:152-207`  | 删除（由策略接管）                          |
| `doSync()` Step 2 tenantCode 分流 | `sto-model-sync.ts:256-258`  | 改为 `strategy.getUserModels()`      |

## 附录 C：网点接口 secret 计算速查

| 接口                                  | secret 公式                         |
| ----------------------------------- | --------------------------------- |
| 查询租户令牌列表 `tenant/keylist`           | `md5(tenantCode)`                 |
| 查询租户 `tenant/detail`                | `md5(tenantCode)`                 |
| 创建租户 `tenant/create`                | `md5(tenantCode + adminUserCode)` |
| 创建令牌 `key/create`                   | `md5(tenantCode + userCode)`      |
| 查询令牌 `key/detail`                   | `md5(tenantCode + tokenId)`       |
| 令牌扩容 `resourcePack/personalBuy`     | `md5(tenantCode + tokenId)`       |
| 租户购买资源包 `resourcePack/tenantBuy`    | `md5(tenantCode)`                 |
| 租户分配令牌额度 `resourcePack/tenantAlloc` | `md5(tenantCode + tokenId)`       |
| 查询用量 `key/usagelist`                | `md5(tenantCode)`                 |

