/**
 * 网点 SK 策略实现
 * 域名: devops-llmgatewayleague.sto.cn
 * 鉴权: 各接口不同（md5 按接口指定参数）
 * 响应: { success, message, data: {...} }
 *
 * 核心流程：租户初始化 → 令牌创建/查询 → SK 解密
 */

import type { StoSkStrategy } from './sto-sk-strategy';
import type { SsoUserInfo } from '../utils/auth-store';
import { getSsoEnvironment } from '../utils/auth-store';
import { storeApiKey, getApiKey, deleteApiKey } from '../utils/secure-storage';
import { logger } from '../utils/logger';
import crypto from 'crypto';

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

/** keylist 查询结果：区分 ENABLE / 非 ENABLE / 未找到 / 不可用，避免误走创建分支 */
type KeyListLookupResult =
  | { outcome: 'enable'; tokenId: string }
  | { outcome: 'disabled'; tokenId: string; status: string }
  | { outcome: 'not_found' }
  | { outcome: 'unavailable'; message: string };

/** fetchTenantKeyList 底层结果：与「租户尚无令牌」区分网络/业务失败 */
type FetchTenantKeyListResult =
  | { status: 'ok'; keyList: SiteTenantKeyListData['keyList'] }
  | { status: 'unavailable'; message: string };

type EnsureKeyBundleOptions = {
  /** 跳过 tokenId 本地缓存，强制从 keylist / 远程重新解析 */
  skipTokenIdCache?: boolean;
};

type ResolveKeyBundleResult =
  | { outcome: 'success'; bundle: SiteKeyBundle }
  | { outcome: 'stale_token_id_cache' }
  | { outcome: 'failed' };

// ─── 策略实现 ───

export class SiteSkStrategy implements StoSkStrategy {
  private static readonly SK_CACHE_KEY = 'sto-site-sk';
  private static readonly TOKEN_ID_CACHE_PREFIX = 'sto-site-token-id:';
  private static readonly DEFAULT_QUOTA = 0; // 已确认
  private static readonly TIMEOUT_MS = 8000;

  /** 网点 SK 解密密钥（按环境区分） */
  private static readonly AES_KEYS: Record<string, string> = {
    prod: '2074c2350686f0e4',  // 生产环境密钥
    test: '2074c2350686f0e4',  // 测试环境密钥（默认与生产相同，可按需修改）
  };

  private static readonly API_DOMAINS: Record<string, string> = {
    prod: 'https://devops-llmgatewayleague.sto.cn',
    test: 'https://devops-llmgatewayleague-test.sto.cn',
  };

  private static readonly SUPPLIER_DOMAINS: Record<string, string> = {
    prod: 'https://devops-llmgatewayleague.sto.cn',
    test: 'https://devops-llmgatewayleague-test.sto.cn',
  };

  // ─── 公开接口实现 ───

  async getUserSk(user: SsoUserInfo, forceRefresh: boolean): Promise<string | null> {
    logger.info(`[site-sk] getUserSk called, userCode=${user.code}, companyCode=${user.companyCode}, forceRefresh=${forceRefresh}`);

    if (forceRefresh) {
      await this.clearSkAndTokenIdCache(user);
      logger.info('[site-sk] forceRefresh: cleared SK and tokenId cache');
    } else {
      const cached = await getApiKey(SiteSkStrategy.SK_CACHE_KEY);
      if (cached) {
        logger.info(`[site-sk] SK found in cache (len=${cached.length})`);
        return cached;
      }
    }

    const bundle = await this.ensureKeyBundle(user, { skipTokenIdCache: forceRefresh });
    if (!bundle) {
      logger.warn('[site-sk] Failed to get key bundle');
      return null;
    }

    await storeApiKey(SiteSkStrategy.SK_CACHE_KEY, bundle.sk);
    logger.info(`[site-sk] SK stored in cache (len=${bundle.sk.length})`);
    return bundle.sk;
  }

  async getUserSkDetail(
    user: SsoUserInfo,
  ): Promise<{ tokenId: string; spend: number; maxBudget: number } | null> {
    logger.info(`[site-sk] getUserSkDetail called, userCode=${user.code}`);

    const bundle = await this.ensureKeyBundle(user);
    if (!bundle) {
      logger.warn('[site-sk] Failed to get key bundle for detail');
      return null;
    }

    const result = {
      tokenId: bundle.tokenId,
      spend: bundle.quotaUsed,
      maxBudget: bundle.quotaAmount,
    };

    logger.info(`[site-sk] Key detail: tokenId=${result.tokenId}, spend=${result.spend}, maxBudget=${result.maxBudget}`);
    return result;
  }

  async getUserModels(user: SsoUserInfo): Promise<string[] | null> {
    logger.info(`[site-sk] getUserModels called, userCode=${user.code}`);

    const bundle = await this.ensureKeyBundle(user);
    if (!bundle?.models) {
      logger.warn('[site-sk] No models found');
      return null;
    }

    logger.info(`[site-sk] Models found: ${bundle.models.length} items, ids=${JSON.stringify(bundle.models)}`);
    return bundle.models;
  }

  async getSupplierDomain(): Promise<string> {
    const env = await getSsoEnvironment();
    const domain = this.isTestEnvironment(env)
      ? SiteSkStrategy.SUPPLIER_DOMAINS.test
      : SiteSkStrategy.SUPPLIER_DOMAINS.prod;
    logger.info(`[site-sk] getSupplierDomain: env=${env}, domain=${domain}`);
    return domain;
  }

  async getDecryptKey(): Promise<string> {
    const env = await getSsoEnvironment();
    const key = this.isTestEnvironment(env)
      ? SiteSkStrategy.AES_KEYS.test
      : SiteSkStrategy.AES_KEYS.prod;
    logger.info(`[site-sk] getDecryptKey: env=${env}, key=${key.substring(0, 4)}...`);
    return key;
  }

  async expandQuota(
    user: SsoUserInfo,
    tokenId: string,
    amount: number,
  ): Promise<{ success: boolean; message?: string }> {
    logger.info(`[site-sk] expandQuota called, tokenId=${tokenId}, amount=${amount} (增加量)`);

    if (!user.code) {
      logger.warn('[site-sk] expandQuota failed: userCode is empty');
      return { success: false, message: 'userCode is empty' };
    }

    const tenantCode = this.generateTenantCode(user.code);
    const domain = await this.resolveApiDomain();
    const url = `${domain}/openapi/resourcePack/personalBuy`;
    const secret = this.md5(tenantCode + tokenId);

    const body = {
      tokenId,
      tenantCode,
      addQuotaAmount: amount,
      operatorCode: user.code,
      operatorName: user.userName,
    };

    logger.info(`[site-sk] expandQuota request: url=${url}`);
    logger.info(`[site-sk] expandQuota headers: secret=${secret}`);
    logger.info(`[site-sk] expandQuota body: ${JSON.stringify(body)}`);

    try {
      const response = await this.fetchWithTimeout(url, {
        method: 'POST',
        headers: {
          secret,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });

      const json = (await response.json()) as SiteApiResponse<unknown>;
      logger.info(`[site-sk] expandQuota response: success=${json.success}, message=${json.message}`);

      if (!json.success) {
        logger.warn(`[site-sk] expandQuota biz failed: ${json.message}`);
        return { success: false, message: json.message };
      }

      logger.info(`[site-sk] expandQuota success, added ${amount}`);
      return { success: true };
    } catch (err) {
      logger.warn('[site-sk] expandQuota error:', err);
      return { success: false, message: String(err) };
    }
  }

  async clearCache(user: SsoUserInfo): Promise<void> {
    await this.clearSkAndTokenIdCache(user);
    logger.info(`[site-sk] SK and tokenId cache cleared for user=${user.code}`);
  }

  // ─── 核心：租户初始化 + 一次性获取全量信息 ───

  private async ensureKeyBundle(
    user: SsoUserInfo,
    options?: EnsureKeyBundleOptions,
  ): Promise<SiteKeyBundle | null> {
    const first = await this.resolveKeyBundleOnce(user, options);
    if (first.outcome === 'success') {
      return first.bundle;
    }

    if (first.outcome === 'stale_token_id_cache' && user.code) {
      const tenantCode = this.generateTenantCode(user.code);
      logger.info('[site-sk] Stale tokenId cache detected, retrying from keylist...');
      await this.invalidateTokenIdCache(tenantCode, user.code);
      const retry = await this.resolveKeyBundleOnce(user, { skipTokenIdCache: true });
      if (retry.outcome === 'success') {
        return retry.bundle;
      }
    }

    return null;
  }

  private async resolveKeyBundleOnce(
    user: SsoUserInfo,
    options?: EnsureKeyBundleOptions,
  ): Promise<ResolveKeyBundleResult> {
    logger.info(`[site-sk] ensureKeyBundle called, userCode=${user.code}, companyCode=${user.companyCode}`);

    // 防御性检查
    if (!user.code) {
      logger.warn('[site-sk] ensureKeyBundle failed: userCode is empty');
      return { outcome: 'failed' };
    }

    const tenantCode = this.generateTenantCode(user.code);
    logger.info(`[site-sk] Generated tenantCode=${tenantCode}`);

    // Step 1: 读 tokenId 缓存（forceRefresh / 自愈重试时跳过）
    let tokenId: string | null = null;
    let usedCachedTokenId = false;
    if (!options?.skipTokenIdCache) {
      tokenId = await this.getCachedTokenId(tenantCode, user.code);
      if (tokenId) {
        usedCachedTokenId = true;
        logger.info(`[site-sk] TokenId found in cache: ${tokenId}`);
      }
    } else {
      logger.info('[site-sk] Skipping tokenId cache lookup');
    }

    // Step 2: 缓存未命中 → 查 keylist
    if (!tokenId) {
      logger.info('[site-sk] TokenId not in cache, querying keylist...');
      const lookup = await this.lookupTokenInKeyList(tenantCode, user.code);
      if (lookup.outcome === 'disabled') {
        logger.warn(
          `[site-sk] User has non-ENABLE token (tokenId=${lookup.tokenId}, status=${lookup.status}), skip create`,
        );
        return { outcome: 'failed' };
      }
      if (lookup.outcome === 'unavailable') {
        logger.warn(`[site-sk] keylist unavailable, skip create: ${lookup.message}`);
        return { outcome: 'failed' };
      }
      if (lookup.outcome === 'enable') {
        tokenId = lookup.tokenId;
        logger.info(`[site-sk] TokenId found in keylist: ${tokenId}`);
        await this.cacheTokenId(tenantCode, user.code, tokenId);
      }
    }

    // Step 3: 无令牌 → 确保租户 → 创建令牌
    if (!tokenId) {
      logger.info('[site-sk] No tokenId found, ensuring tenant and creating key...');
      tokenId = await this.ensureTenantAndCreateKey(user, tenantCode);
      if (tokenId) {
        logger.info(`[site-sk] TokenId created: ${tokenId}`);
        await this.cacheTokenId(tenantCode, user.code, tokenId);
      }
    }

    if (!tokenId) {
      logger.warn('[site-sk] Failed to get tokenId after all attempts');
      return { outcome: 'failed' };
    }

    // Step 4: 查令牌详情
    logger.info(`[site-sk] Fetching key detail for tokenId=${tokenId}`);
    const detail = await this.fetchKeyDetail(tokenId, tenantCode);
    if (!detail || detail.status !== 'ENABLE') {
      logger.warn(`[site-sk] Key unavailable, status=${detail?.status}`);
      await this.invalidateTokenIdCache(tenantCode, user.code);
      if (usedCachedTokenId && !options?.skipTokenIdCache) {
        return { outcome: 'stale_token_id_cache' };
      }
      return { outcome: 'failed' };
    }

    // Step 5: 解密 SK
    let sk: string;
    try {
      sk = await this.decryptSk(detail.encryptedKey);
      logger.info(`[site-sk] SK decrypted successfully (len=${sk.length})`);
    } catch (err) {
      logger.warn('[site-sk] AES decrypt failed:', err);
      await this.invalidateTokenIdCache(tenantCode, user.code);
      if (usedCachedTokenId && !options?.skipTokenIdCache) {
        return { outcome: 'stale_token_id_cache' };
      }
      return { outcome: 'failed' };
    }

    const bundle: SiteKeyBundle = {
      sk,
      tokenId: detail.tokenId,
      tenantCode,
      models: detail.models,
      quotaAmount: detail.quotaAmount,
      quotaUsed: detail.quotaUsed,
      status: detail.status,
    };

    logger.info(`[site-sk] Key bundle ready: tokenId=${bundle.tokenId}, status=${bundle.status}, models=${bundle.models.length}`);
    return { outcome: 'success', bundle };
  }

  // ─── 私有：流程辅助 ───

  /**
   * 从 keylist 解析当前用户令牌：
   * - ENABLE → 可用
   * - 存在但非 ENABLE → disabled（不再尝试创建）
   * - 不存在 → not_found（可继续建租户/建令牌）
   * - 请求失败 → unavailable（不尝试创建）
   */
  private async lookupTokenInKeyList(
    tenantCode: string,
    userCode: string,
  ): Promise<KeyListLookupResult> {
    logger.info(`[site-sk] lookupTokenInKeyList: tenantCode=${tenantCode}, userCode=${userCode}`);

    const fetched = await this.fetchTenantKeyList(tenantCode);
    if (fetched.status === 'unavailable') {
      logger.warn(`[site-sk] keylist fetch unavailable: ${fetched.message}`);
      return { outcome: 'unavailable', message: fetched.message };
    }

    const { keyList } = fetched;
    if (keyList.length === 0) {
      logger.info('[site-sk] keylist is empty');
      return { outcome: 'not_found' };
    }

    logger.info(`[site-sk] keylist has ${keyList.length} items`);

    const myKey = keyList.find((k) => k.userCode === userCode);
    if (!myKey) {
      logger.info(`[site-sk] No key found for userCode=${userCode}`);
      return { outcome: 'not_found' };
    }

    if (myKey.status === 'ENABLE') {
      logger.info(`[site-sk] Found ENABLE key: tokenId=${myKey.tokenId}, status=${myKey.status}`);
      return { outcome: 'enable', tokenId: myKey.tokenId };
    }

    logger.warn(
      `[site-sk] Found non-ENABLE key: tokenId=${myKey.tokenId}, status=${myKey.status}`,
    );
    return { outcome: 'disabled', tokenId: myKey.tokenId, status: myKey.status };
  }

  /** 确保租户存在 + 创建令牌，返回 tokenId */
  private async ensureTenantAndCreateKey(
    user: SsoUserInfo,
    tenantCode: string,
  ): Promise<string | null> {
    logger.info(`[site-sk] ensureTenantAndCreateKey: tenantCode=${tenantCode}, userCode=${user.code}`);

    // 确保租户存在
    let tenantExists = (await this.fetchTenantDetail(tenantCode)) != null;
    logger.info(`[site-sk] Tenant exists: ${tenantExists}`);

    if (!tenantExists) {
      logger.info('[site-sk] Creating tenant...');
      tenantExists = await this.createTenant(
        tenantCode,
        user.companyName ?? tenantCode,
        user.code,
        user.userName,
        SiteSkStrategy.DEFAULT_QUOTA,
      );
    }

    if (!tenantExists) {
      logger.warn('[site-sk] Failed to ensure tenant exists');
      return null;
    }

    // 创建令牌
    logger.info('[site-sk] Creating key...');
    const keyResult = await this.createKey(
      tenantCode,
      user.code,
      user.userName,
      SiteSkStrategy.DEFAULT_QUOTA,
    );

    if (keyResult) {
      logger.info(`[site-sk] Key created: tokenId=${keyResult.tokenId}`);
      return keyResult.tokenId;
    }

    // 创建失败（可能"已有令牌"）→ 回退查 keylist；非 ENABLE 则终止，不再重试创建
    logger.info('[site-sk] Key create failed (可能已有令牌), retrying keylist...');
    const lookup = await this.lookupTokenInKeyList(tenantCode, user.code);
    if (lookup.outcome === 'enable') {
      return lookup.tokenId;
    }
    if (lookup.outcome === 'unavailable') {
      logger.warn(
        `[site-sk] keylist retry unavailable after create failed: ${lookup.message}`,
      );
      return null;
    }
    if (lookup.outcome === 'disabled') {
      logger.warn(
        `[site-sk] Key create failed and keylist shows non-ENABLE token (status=${lookup.status}), abort`,
      );
    }
    return null;
  }

  // ─── 私有：底层接口封装 ───

  private isKeyListTenantMissingMessage(message: string | undefined): boolean {
    if (!message) return false;
    const normalized = message.trim();
    return (
      normalized.includes('租户不存在')
      || (normalized.includes('租户') && normalized.includes('不存在'))
    );
  }

  private async fetchTenantKeyList(
    tenantCode: string,
  ): Promise<FetchTenantKeyListResult> {
    const domain = await this.resolveApiDomain();
    const url = `${domain}/openapi/tenant/keylist?tenantCode=${encodeURIComponent(tenantCode)}`;
    const secret = this.md5(tenantCode);

    logger.info(`[site-sk] fetchTenantKeyList request: url=${url}`);
    logger.info(`[site-sk] fetchTenantKeyList headers: secret=${secret}`);

    try {
      const response = await this.fetchWithTimeout(url, {
        method: 'GET',
        headers: { secret, 'Content-Type': 'application/json' },
      });

      if (!response.ok) {
        const message = `HTTP ${response.status}`;
        logger.warn(`[site-sk] fetchTenantKeyList HTTP error: ${message}`);
        return { status: 'unavailable', message };
      }

      const json = (await response.json()) as SiteApiResponse<SiteTenantKeyListData>;
      logger.info(`[site-sk] fetchTenantKeyList response: success=${json.success}, message=${json.message}, keyCount=${json.data?.keyList?.length ?? 0}`);

      if (!json.success) {
        if (this.isKeyListTenantMissingMessage(json.message)) {
          logger.info(`[site-sk] fetchTenantKeyList tenant missing, treat as empty keylist: ${json.message}`);
          return { status: 'ok', keyList: [] };
        }
        const message = json.message || 'keylist business error';
        logger.warn(`[site-sk] fetchTenantKeyList biz failed: ${message}`);
        return { status: 'unavailable', message };
      }

      if (!json.data) {
        const message = json.message || 'keylist response missing data';
        logger.warn(`[site-sk] fetchTenantKeyList missing data: ${message}`);
        return { status: 'unavailable', message };
      }

      return { status: 'ok', keyList: json.data.keyList ?? [] };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.warn('[site-sk] fetchTenantKeyList error:', err);
      return { status: 'unavailable', message };
    }
  }

  private async fetchTenantDetail(
    tenantCode: string,
  ): Promise<SiteTenantDetailData | null> {
    const domain = await this.resolveApiDomain();
    const url = `${domain}/openapi/tenant/detail?tenantCode=${encodeURIComponent(tenantCode)}`;
    const secret = this.md5(tenantCode);

    logger.info(`[site-sk] fetchTenantDetail request: url=${url}`);
    logger.info(`[site-sk] fetchTenantDetail headers: secret=${secret}`);

    try {
      const response = await this.fetchWithTimeout(url, {
        method: 'GET',
        headers: { secret, 'Content-Type': 'application/json' },
      });

      const json = (await response.json()) as SiteApiResponse<SiteTenantDetailData>;
      logger.info(`[site-sk] fetchTenantDetail response: success=${json.success}, message=${json.message}`);

      if (!json.success || !json.data) {
        logger.info(`[site-sk] Tenant not found or error: ${json.message}`);
        return null;
      }

      logger.info(`[site-sk] Tenant found: tenantCode=${json.data.tenantCode}, tenantName=${json.data.tenantName}`);
      return json.data;
    } catch (err) {
      logger.warn('[site-sk] fetchTenantDetail error:', err);
      return null;
    }
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
      operatorCode: adminUserCode,
      operatorName: adminUserName,
      quotaAmount,
    };

    logger.info(`[site-sk] createTenant request: url=${url}`);
    logger.info(`[site-sk] createTenant headers: secret=${secret}`);
    logger.info(`[site-sk] createTenant body: ${JSON.stringify(body)}`);

    try {
      const response = await this.fetchWithTimeout(url, {
        method: 'POST',
        headers: {
          secret,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });

      const json = (await response.json()) as SiteApiResponse<unknown>;
      logger.info(`[site-sk] createTenant response: success=${json.success}, message=${json.message}`);

      // 幂等处理：message 包含 "已存在" 视为成功
      if (!json.success && !json.message?.includes('已存在')) {
        logger.warn(`[site-sk] createTenant failed: ${json.message}`);
        return false;
      }

      logger.info('[site-sk] createTenant success (or already exists)');
      return true;
    } catch (err) {
      logger.warn('[site-sk] createTenant error:', err);
      return false;
    }
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
      operatorCode: userCode,
      operatorName: userName,
    };

    logger.info(`[site-sk] createKey request: url=${url}`);
    logger.info(`[site-sk] createKey headers: secret=${secret}`);
    logger.info(`[site-sk] createKey body: ${JSON.stringify(body)}`);

    try {
      const response = await this.fetchWithTimeout(url, {
        method: 'POST',
        headers: {
          secret,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });

      const json = (await response.json()) as SiteApiResponse<SiteKeyCreateData>;
      logger.info(`[site-sk] createKey response: success=${json.success}, message=${json.message}`);

      if (!json.success || !json.data) {
        logger.warn(`[site-sk] createKey failed: ${json.message}`);
        return null;
      }

      logger.info(`[site-sk] createKey success: tokenId=${json.data.tokenId}, status=${json.data.status}`);
      return json.data;
    } catch (err) {
      logger.warn('[site-sk] createKey error:', err);
      return null;
    }
  }

  private async fetchKeyDetail(
    tokenId: string,
    tenantCode: string,
  ): Promise<SiteKeyDetailData | null> {
    const domain = await this.resolveApiDomain();
    const url = `${domain}/openapi/key/detail?tokenId=${encodeURIComponent(tokenId)}&tenantCode=${encodeURIComponent(tenantCode)}`;
    const secret = this.md5(tenantCode + tokenId);

    logger.info(`[site-sk] fetchKeyDetail request: url=${url}`);
    logger.info(`[site-sk] fetchKeyDetail headers: secret=${secret}`);

    try {
      const response = await this.fetchWithTimeout(url, {
        method: 'GET',
        headers: { secret, 'Content-Type': 'application/json' },
      });

      const json = (await response.json()) as SiteApiResponse<SiteKeyDetailData>;
      logger.info(`[site-sk] fetchKeyDetail response: success=${json.success}, message=${json.message}`);

      if (!json.success || !json.data) {
        logger.warn(`[site-sk] fetchKeyDetail failed: ${json.message}`);
        return null;
      }

      // 兼容 encryptedKey / key 字段名
      if (json.data && !json.data.encryptedKey && (json.data as unknown as { key?: string }).key) {
        (json.data as unknown as { encryptedKey: string }).encryptedKey = (json.data as unknown as { key: string }).key;
      }

      logger.info(`[site-sk] fetchKeyDetail success: tokenId=${json.data.tokenId}, status=${json.data.status}, quotaAmount=${json.data.quotaAmount}, quotaUsed=${json.data.quotaUsed}`);
      return json.data;
    } catch (err) {
      logger.warn('[site-sk] fetchKeyDetail error:', err);
      return null;
    }
  }

  // ─── 私有：工具 ───

  private md5(input: string): string {
    return crypto.createHash('md5').update(input).digest('hex');
  }

  private generateTenantCode(companyCode: string): string {
    return companyCode;
  }

  private async decryptSk(encrypted: string): Promise<string> {
    const key = await this.getDecryptKey();
    const keyBuffer = Buffer.from(key, 'utf-8');
    const decipher = crypto.createDecipheriv('aes-128-ecb', keyBuffer, null);
    return decipher.update(encrypted, 'base64', 'utf-8') + decipher.final('utf-8');
  }

  private async resolveApiDomain(): Promise<string> {
    const env = await getSsoEnvironment();
    const domain = this.isTestEnvironment(env)
      ? SiteSkStrategy.API_DOMAINS.test
      : SiteSkStrategy.API_DOMAINS.prod;
    logger.info(`[site-sk] resolveApiDomain: env=${env}, domain=${domain}`);
    return domain;
  }

  private isTestEnvironment(env?: string | null): boolean {
    const normalized = env?.trim().toLowerCase() || '';
    return ['test', 'pre-release', 'daily', 'daily-external'].some(
      (e) => normalized.includes(e),
    );
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

  private async clearSkAndTokenIdCache(user: SsoUserInfo): Promise<void> {
    await deleteApiKey(SiteSkStrategy.SK_CACHE_KEY);
    if (user.code) {
      const tenantCode = this.generateTenantCode(user.code);
      await this.invalidateTokenIdCache(tenantCode, user.code);
    }
  }

  private async invalidateTokenIdCache(tenantCode: string, userCode: string): Promise<void> {
    const key = this.tokenIdCacheKey(tenantCode, userCode);
    await deleteApiKey(key);
    logger.info(`[site-sk] TokenId cache invalidated: key=${key}`);
  }

  private tokenIdCacheKey(tenantCode: string, userCode: string): string {
    return `${SiteSkStrategy.TOKEN_ID_CACHE_PREFIX}${tenantCode}:${userCode}`;
  }

  private async getCachedTokenId(tenantCode: string, userCode: string): Promise<string | null> {
    const key = this.tokenIdCacheKey(tenantCode, userCode);
    const cached = await getApiKey(key);
    logger.info(`[site-sk] getCachedTokenId: key=${key}, found=${!!cached}`);
    return cached;
  }

  private async cacheTokenId(tenantCode: string, userCode: string, tokenId: string): Promise<void> {
    const key = this.tokenIdCacheKey(tenantCode, userCode);
    await storeApiKey(key, tokenId);
    logger.info(`[site-sk] cacheTokenId: key=${key}, tokenId=${tokenId}`);
  }
}

// ─── 单例 ───

let instance: SiteSkStrategy | null = null;

export function getSiteSkStrategy(): SiteSkStrategy {
  if (!instance) instance = new SiteSkStrategy();
  return instance;
}
