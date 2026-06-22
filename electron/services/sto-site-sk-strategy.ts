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
import type { TokenQuotaTierQueryResult } from '../../shared/sto-token-quota-tier';
import type { ExpandQuotaResult } from '../../shared/token-quota-expansion-record';
import { getSsoEnvironment } from '../utils/auth-store';
import { storeApiKey, getApiKey, deleteApiKey } from '../utils/secure-storage';
import { logger } from '../utils/logger';
import { getCurrentEnvConfig } from '../../shared/env-config';
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
  /** @deprecated 旧版全局 SK 缓存键，仅用于迁移清理 */
  private static readonly LEGACY_SK_CACHE_KEY = 'sto-site-sk';
  private static readonly SK_CACHE_KEY_PREFIX = 'sto-site-sk:';
  private static readonly TOKEN_ID_CACHE_PREFIX = 'sto-site-token-id:';
  /** 开发环境 tenantCode 白名单：命中时使用 user.code 作为 tenantCode */
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

    const tenantCode = this.resolveTenantCode(user);
    if (!tenantCode) {
      logger.warn('[site-sk] getUserSk failed: could not resolve tenantCode');
      return null;
    }

    if (forceRefresh) {
      await this.clearSkAndTokenIdCache(user);
      logger.info('[site-sk] forceRefresh: cleared SK and tokenId cache');
    } else {
      await this.purgeLegacySkCache();
      const cachedSk = await this.getCachedSkForUser(user);
      if (cachedSk) {
        return cachedSk;
      }
    }

    const bundle = await this.ensureKeyBundle(user, { skipTokenIdCache: forceRefresh });
    if (!bundle) {
      logger.warn('[site-sk] Failed to get key bundle');
      return null;
    }

    const primaryTenantCode = tenantCode;
    if (bundle.tenantCode !== primaryTenantCode) {
      logger.warn(
        `[site-sk] Unexpected tenant mismatch: bundle=${bundle.tenantCode}, primary=${primaryTenantCode}`,
      );
    }

    const skCacheKey = this.skCacheKey(primaryTenantCode, user.code);
    await storeApiKey(skCacheKey, bundle.sk);
    logger.info(`[site-sk] SK stored in cache key=${skCacheKey} (len=${bundle.sk.length})`);
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
    if (!bundle) {
      logger.warn('[site-sk] No models found');
      return null;
    }
    if (bundle.models.length === 0) {
      logger.warn('[site-sk] Model list is empty');
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
  ): Promise<ExpandQuotaResult> {
    logger.info(`[site-sk] expandQuota called, tokenId=${tokenId}, amount=${amount} (增加量)`);

    if (!user.code) {
      logger.warn('[site-sk] expandQuota failed: userCode is empty');
      return { success: false, message: 'userCode is empty' };
    }

    const tenantCode = this.resolveTenantCode(user);
    if (!tenantCode) {
      return { success: false, message: 'tenantCode unavailable' };
    }
    const domain = await this.resolveApiDomain();
    const url = `${domain}/openapi/resourcePack/personalBuy`;
    const secret = this.md5(tenantCode + tokenId);

    const displayName = this.resolveOperatorDisplayName(user);
    const body = {
      tokenId,
      tenantCode,
      addQuotaAmount: amount,
      operatorCode: user.code,
      operatorName: displayName,
    };

    logger.info(`[site-sk] expandQuota request: url=${url}`);
    logger.info(`[site-sk] expandQuota headers: secret=${secret}`);
    logger.info(`[site-sk] expandQuota body: ${JSON.stringify(body)}`);

    const startedAt = Date.now();
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
      const duration_ms = Date.now() - startedAt;
      logger.info(`[site-sk] expandQuota response: success=${json.success}, message=${json.message}`);

      const gatewayPayload = {
        request: { path: '/openapi/resourcePack/personalBuy', body },
        response: json,
        duration_ms,
      };

      if (!json.success) {
        logger.warn(`[site-sk] expandQuota biz failed: ${json.message}`);
        return {
          success: false,
          message: json.message,
          gatewayStatus: String(json.success),
          gatewayPayload,
        };
      }

      logger.info(`[site-sk] expandQuota success, added ${amount}`);
      return {
        success: true,
        gatewayStatus: 'true',
        gatewayPayload,
      };
    } catch (err) {
      logger.warn('[site-sk] expandQuota error:', err);
      return {
        success: false,
        message: String(err),
        gatewayPayload: {
          request: { path: '/openapi/resourcePack/personalBuy', body },
          response: { error: String(err) },
          duration_ms: Date.now() - startedAt,
        },
      };
    }
  }

  async clearCache(user: SsoUserInfo): Promise<void> {
    await this.clearSkAndTokenIdCache(user);
    logger.info(`[site-sk] SK and tokenId cache cleared for user=${user.code}`);
  }

  async queryTokenQuotaTier(
    _user: SsoUserInfo,
    _tokenId: string,
  ): Promise<TokenQuotaTierQueryResult | null> {
    logger.info('[site-sk] queryTokenQuotaTier: site users not supported yet');
    return null;
  }

  // ─── 核心：租户初始化 + 一次性获取全量信息 ───

  private async ensureKeyBundle(
    user: SsoUserInfo,
    options?: EnsureKeyBundleOptions,
  ): Promise<SiteKeyBundle | null> {
    const tenantCode = this.resolveTenantCode(user);
    if (!tenantCode) {
      logger.warn('[site-sk] ensureKeyBundle failed: could not resolve primary tenantCode');
      return null;
    }

    return this.tryResolveKeyBundleForTenant(user, options, tenantCode);
  }

  private async tryResolveKeyBundleForTenant(
    user: SsoUserInfo,
    options: EnsureKeyBundleOptions | undefined,
    tenantCode: string,
  ): Promise<SiteKeyBundle | null> {
    const first = await this.resolveKeyBundleOnce(user, options, tenantCode);
    if (first.outcome === 'success') {
      return first.bundle;
    }

    // 任意失败均允许一次 skipTokenIdCache 重试（keylist → 创建 全链路）
    if (user.code && !options?.skipTokenIdCache) {
      logger.info(`[site-sk] Primary resolve failed for tenant=${tenantCode}, retrying with fresh keylist/create...`);
      await this.invalidateTokenIdCache(tenantCode, user.code);
      const retry = await this.resolveKeyBundleOnce(
        user,
        { ...options, skipTokenIdCache: true },
        tenantCode,
      );
      if (retry.outcome === 'success') {
        return retry.bundle;
      }
    }

    return null;
  }

  private async resolveKeyBundleOnce(
    user: SsoUserInfo,
    options: EnsureKeyBundleOptions | undefined,
    tenantCode: string,
  ): Promise<ResolveKeyBundleResult> {
    logger.info(
      `[site-sk] resolveKeyBundleOnce: userCode=${user.code}, companyCode=${user.companyCode}, tenantCode=${tenantCode}`,
    );

    if (!user.code) {
      logger.warn('[site-sk] resolveKeyBundleOnce failed: userCode is empty');
      return { outcome: 'failed' };
    }

    // Step 1: 读 tokenId 缓存（仅作 hint，Step 2 keylist 为权威来源）
    let cachedTokenId: string | null = null;
    let usedCachedTokenId = false;
    if (!options?.skipTokenIdCache) {
      cachedTokenId = await this.getCachedTokenId(tenantCode, user.code);
      if (cachedTokenId) {
        usedCachedTokenId = true;
        logger.info(`[site-sk] TokenId found in cache (hint): ${cachedTokenId}`);
      }
    } else {
      logger.info('[site-sk] Skipping tokenId cache lookup');
    }

    let tokenId: string | null = null;
    let effectiveTenantCode = tenantCode;

    // Step 2: 始终查 keylist（权威）；缓存不可跳过创建路径
    logger.info('[site-sk] Querying keylist (authoritative)...');
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
      effectiveTenantCode = tenantCode;
      logger.info(`[site-sk] TokenId found in keylist: ${tokenId}`);
      await this.cacheTokenId(tenantCode, user.code, tokenId);
    } else {
      // not_found：keylist 为空或无该用户令牌 → 清 stale 缓存，进入创建
      if (cachedTokenId) {
        logger.info(
          `[site-sk] Cached tokenId=${cachedTokenId} not in keylist, invalidating cache before create`,
        );
      }
      await this.invalidateTokenIdCache(tenantCode, user.code);
      usedCachedTokenId = false;
    }

    // Step 3: 无令牌 → 确保租户 → 创建令牌（仅主租户，不跨 tenant 恢复旧令牌）
    if (!tokenId) {
      logger.info('[site-sk] No tokenId found, ensuring tenant and creating key...');
      tokenId = await this.ensureTenantAndCreateKey(user, tenantCode);
      if (tokenId) {
        logger.info(`[site-sk] TokenId created: ${tokenId}`);
        effectiveTenantCode = tenantCode;
        await this.cacheTokenId(tenantCode, user.code, tokenId);
      }
    }

    if (!tokenId) {
      logger.warn(
        `[site-sk] Failed to get tokenId on primary tenant=${tenantCode} `
        + '(keylist empty and create failed; global duplicate token may exist on another tenant — contact backend to migrate/delete)',
      );
      return { outcome: 'failed' };
    }

    // Step 4: 查令牌详情（使用令牌实际所属 tenantCode）
    logger.info(`[site-sk] Fetching key detail for tokenId=${tokenId}, tenantCode=${effectiveTenantCode}`);
    const detail = await this.fetchKeyDetail(tokenId, effectiveTenantCode);
    if (!detail || detail.status !== 'ENABLE') {
      logger.warn(`[site-sk] Key unavailable, status=${detail?.status}`);
      await this.invalidateTokenIdCache(effectiveTenantCode, user.code);
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
      await this.invalidateTokenIdCache(effectiveTenantCode, user.code);
      if (usedCachedTokenId && !options?.skipTokenIdCache) {
        return { outcome: 'stale_token_id_cache' };
      }
      return { outcome: 'failed' };
    }

    const bundle: SiteKeyBundle = {
      sk,
      tokenId: detail.tokenId,
      tenantCode: effectiveTenantCode,
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

  private isCreateKeyDuplicateTokenMessage(message: string | undefined): boolean {
    if (!message) return false;
    const normalized = message.trim();
    return normalized.includes('已存在令牌') || normalized.includes('不允许重复创建');
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
        this.resolveOperatorDisplayName(user),
        SiteSkStrategy.DEFAULT_QUOTA,
      );
    }

    if (!tenantExists) {
      logger.warn('[site-sk] Failed to ensure tenant exists');
      return null;
    }

    // 创建令牌
    logger.info('[site-sk] Creating key...');
    const displayName = this.resolveOperatorDisplayName(user);
    const createResult = await this.createKey(
      tenantCode,
      user.code,
      displayName,
      SiteSkStrategy.DEFAULT_QUOTA,
    );

    if (createResult.data) {
      logger.info(`[site-sk] Key created: tokenId=${createResult.data.tokenId}`);
      return createResult.data.tokenId;
    }

    // 创建失败 → 回退查当前租户 keylist
    logger.info(
      `[site-sk] Key create failed (message=${createResult.message ?? 'unknown'}), retrying keylist...`,
    );
    if (this.isCreateKeyDuplicateTokenMessage(createResult.message)) {
      logger.warn(
        `[site-sk] Backend reports duplicate token for user=${user.code} on tenant=${tenantCode}; `
        + 'keylist may be empty if token is bound to another tenant',
      );
      await this.logDuplicateTokenDiagnostic(user, tenantCode);
    }

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
  ): Promise<{ data: SiteKeyCreateData | null; message?: string }> {
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
        return { data: null, message: json.message };
      }

      logger.info(`[site-sk] createKey success: tokenId=${json.data.tokenId}, status=${json.data.status}`);
      return { data: json.data, message: json.message };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.warn('[site-sk] createKey error:', err);
      return { data: null, message };
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

  /**
   * 接口 body 中的 userName / operatorName：优先真实姓名（realName），
   * SSO 的 userName 字段常为登录名/工号，与网关文档示例不一致。
   */
  private resolveOperatorDisplayName(user: SsoUserInfo): string {
    const realName = user.realName?.trim();
    if (realName) return realName;
    const userName = user.userName?.trim();
    if (userName) return userName;
    return user.code?.trim() ?? '';
  }

  private md5(input: string): string {
    return crypto.createHash('md5').update(input).digest('hex');
  }

  /**
   * 清理同一用户可能残留的历史 tenant 缓存（主租户 + 工号/公司编码租户）
   */
  private relatedTenantCodesForUser(user: SsoUserInfo): string[] {
    const seen = new Set<string>();
    const codes: string[] = [];
    const add = (code: string | null | undefined) => {
      const normalized = code?.trim();
      if (normalized && !seen.has(normalized)) {
        seen.add(normalized);
        codes.push(normalized);
      }
    };
    add(this.resolveTenantCode(user));
    add(user.code);
    add(user.companyCode);
    return codes;
  }

  /**
   * createKey 报「工号已有令牌」时，探测其他 tenant 的 keylist（仅诊断日志，不用于取 SK）
   */
  private async logDuplicateTokenDiagnostic(
    user: SsoUserInfo,
    primaryTenantCode: string,
  ): Promise<void> {
    const alternates = this.relatedTenantCodesForUser(user).filter(
      (code) => code !== primaryTenantCode,
    );
    if (alternates.length === 0) {
      logger.warn('[site-sk] duplicate-token diagnostic: no alternate tenants to probe');
      return;
    }

    for (const alternateTenant of alternates) {
      const lookup = await this.lookupTokenInKeyList(alternateTenant, user.code ?? '');
      if (lookup.outcome === 'enable') {
        logger.warn(
          `[site-sk] duplicate-token diagnostic: user=${user.code} has ENABLE token on tenant=${alternateTenant}, `
          + `tokenId=${lookup.tokenId} (not on primary=${primaryTenantCode}) — backend must delete/migrate`,
        );
        return;
      }
      if (lookup.outcome === 'disabled') {
        logger.warn(
          `[site-sk] duplicate-token diagnostic: user=${user.code} has non-ENABLE token on tenant=${alternateTenant}, `
          + `tokenId=${lookup.tokenId}, status=${lookup.status}`,
        );
        return;
      }
      logger.info(
        `[site-sk] duplicate-token diagnostic: tenant=${alternateTenant} keylist has no token for user=${user.code}`,
      );
    }

    logger.warn(
      `[site-sk] duplicate-token diagnostic: duplicate error but token not found in probed tenants [${alternates.join(', ')}]; `
      + 'likely backend global userCode constraint without tenant-scoped keylist visibility',
    );
  }

  /** 仅读主租户 SK 缓存（不回落到 user.code / 历史 tenant） */
  private async getCachedSkForUser(user: SsoUserInfo): Promise<string | null> {
    const tenantCode = this.resolveTenantCode(user);
    if (!tenantCode || !user.code) {
      return null;
    }
    const cached = await getApiKey(this.skCacheKey(tenantCode, user.code));
    if (cached) {
      logger.info(`[site-sk] SK found in cache for primary tenant=${tenantCode} (len=${cached.length})`);
      return cached;
    }
    return null;
  }

  private skCacheKey(tenantCode: string, userCode: string): string {
    return `${SiteSkStrategy.SK_CACHE_KEY_PREFIX}${tenantCode}:${userCode}`;
  }

  private async purgeLegacySkCache(): Promise<void> {
    await deleteApiKey(SiteSkStrategy.LEGACY_SK_CACHE_KEY);
  }

  /**
   * 解析网点 tenantCode（主路径）：
   * - 开发环境 + 白名单工号 → user.code
   * - 其余（其他工号 / 非开发环境）→ companyCode
   */
  private resolveTenantCode(user: SsoUserInfo): string | null {
    const userCode = user.code?.trim() ?? '';
    const companyCode = user.companyCode?.trim() ?? '';
    const isDevWhitelistUser =
      getCurrentEnvConfig().isDevelopment;

    if (isDevWhitelistUser) {
      logger.info(`[site-sk] resolveTenantCode: dev whitelist hit, tenantCode=userCode=${userCode}`);
      return '3220000731';
    }

    if (!companyCode) {
      logger.warn(
        `[site-sk] resolveTenantCode: companyCode is empty for userCode=${userCode} (non-whitelist path)`,
      );
      return null;
    }

    logger.info(
      `[site-sk] resolveTenantCode: tenantCode=companyCode=${companyCode}, userCode=${userCode}`,
    );
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
    await this.purgeLegacySkCache();
    if (!user.code) return;
    for (const tenantCode of this.relatedTenantCodesForUser(user)) {
      await deleteApiKey(this.skCacheKey(tenantCode, user.code));
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
