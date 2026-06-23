/**
 * 网点 SK 策略实现（memory-center 代理）
 *
 * Key 确保 / 额度扩容：经 memory-center 代理供应商 openapi 接口。
 * 模型推理域名：客户端本地 SUPPLIER_DOMAINS，不经 memory-center 管理。
 */

import type { StoSkStrategy } from './sto-sk-strategy';
import type { SsoUserInfo } from '../utils/auth-store';
import type { TokenQuotaTierQueryResult } from '../../shared/sto-token-quota-tier';
import type { ExpandQuotaResult } from '../../shared/token-quota-expansion-record';
import { getSsoEnvironment } from '../utils/auth-store';
import { storeApiKey, getApiKey, deleteApiKey } from '../utils/secure-storage';
import { logger } from '../utils/logger';
import {
  applySiteTokenQuotaExpansionViaMemoryCenter,
  ensureSiteKeyViaMemoryCenter,
  StoSiteMemoryApiError,
} from './sto-site-memory-api-service';
import { getCurrentEnvConfig } from '../../shared/env-config';
import crypto from 'crypto';

export class SiteSkStrategy implements StoSkStrategy {
  /** @deprecated 旧版全局 SK 缓存键，仅用于迁移清理 */
  private static readonly LEGACY_SK_CACHE_KEY = 'sto-site-sk';
  private static readonly SK_CACHE_KEY_PREFIX = 'sto-site-sk:';

  /** 网点 SK 解密密钥（按环境区分） */
  private static readonly AES_KEYS: Record<string, string> = {
    prod: '2074c2350686f0e4',
    test: '2074c2350686f0e4',
  };

  /**
   * 模型推理 Gateway baseUrl 域名（客户端本地，不经 memory-center）
   * 与 sto-model-sync 中 ProviderAccount.baseUrl 一致
   */
  private static readonly SUPPLIER_DOMAINS: Record<string, string> = {
    prod: 'https://devops-llmgatewayleague.sto.cn',
    test: 'https://devops-llmgatewayleague-test.sto.cn',
  };

  async getUserSk(user: SsoUserInfo, forceRefresh: boolean): Promise<string | null> {
    logger.info(`[site-sk] getUserSk called, userCode=${user.code}, forceRefresh=${forceRefresh}`);

    if (forceRefresh) {
      await this.clearSkCache(user);
    } else {
      await this.purgeLegacySkCache();
      const cachedSk = await this.getCachedSkForUser(user);
      if (cachedSk) {
        return cachedSk;
      }
    }

    const ensured = await ensureSiteKeyViaMemoryCenter(forceRefresh);
    if (!ensured?.encryptedKey) {
      logger.warn('[site-sk] ensure key via memory-center failed');
      return null;
    }

    const skCacheKey = this.skCacheKey(ensured.tenantCode, user.code);
    await storeApiKey(skCacheKey, ensured.encryptedKey);
    logger.info(
      `[site-sk] encryptedKey stored in cache key=${skCacheKey} (len=${ensured.encryptedKey.length}), created=${ensured.created}`,
    );
    return this.decryptSk(ensured.encryptedKey);
  }

  async getUserSkDetail(
    user: SsoUserInfo,
  ): Promise<{ tokenId: string; spend: number; maxBudget: number } | null> {
    logger.info(`[site-sk] getUserSkDetail called, userCode=${user.code}`);

    const ensured = await ensureSiteKeyViaMemoryCenter(false);
    if (!ensured) {
      logger.warn('[site-sk] Failed to get key detail via memory-center');
      return null;
    }

    return {
      tokenId: ensured.tokenId,
      spend: ensured.spend,
      maxBudget: ensured.maxBudget,
    };
  }

  async getUserModels(user: SsoUserInfo): Promise<string[] | null> {
    logger.info(`[site-sk] getUserModels called, userCode=${user.code}`);

    const ensured = await ensureSiteKeyViaMemoryCenter(false);
    if (!ensured?.models.length) {
      logger.warn('[site-sk] No models from memory-center ensure');
      return null;
    }

    logger.info(`[site-sk] Models found: ${ensured.models.length} items`);
    return ensured.models;
  }

  async getSupplierDomain(): Promise<string> {
    const env = await getSsoEnvironment();
    const domain = this.isTestEnvironment(env)
      ? SiteSkStrategy.SUPPLIER_DOMAINS.test
      : SiteSkStrategy.SUPPLIER_DOMAINS.prod;
    logger.info(`[site-sk] getSupplierDomain (local inference): env=${env}, domain=${domain}`);
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
    logger.info(`[site-sk] expandQuota via memory-center, tokenId=${tokenId}, amount=${amount} (增量)`);

    if (!user.code) {
      return { success: false, message: 'userCode is empty' };
    }
    if (!tokenId?.trim() || amount <= 0) {
      return { success: false, message: 'tokenId and positive amount are required' };
    }

    try {
      await applySiteTokenQuotaExpansionViaMemoryCenter({
        tokenId: tokenId.trim(),
        quotaAmount: amount,
      });
      return { success: true, gatewayStatus: 'true' };
    } catch (err) {
      const message = err instanceof StoSiteMemoryApiError ? err.message : String(err);
      logger.warn('[site-sk] expandQuota via memory-center failed:', err);
      return {
        success: false,
        message,
        gatewayStatus: err instanceof StoSiteMemoryApiError ? String(err.statusCode) : undefined,
      };
    }
  }

  async clearCache(user: SsoUserInfo): Promise<void> {
    await this.clearSkCache(user);
    logger.info(`[site-sk] SK cache cleared for user=${user.code}`);
  }

  async queryTokenQuotaTier(
    _user: SsoUserInfo,
    _tokenId: string,
  ): Promise<TokenQuotaTierQueryResult | null> {
    logger.info('[site-sk] queryTokenQuotaTier: site users not supported yet');
    return null;
  }

  private skCacheKey(tenantCode: string, userCode: string): string {
    return `${SiteSkStrategy.SK_CACHE_KEY_PREFIX}${tenantCode}:${userCode}`;
  }

  /** 本地缓存 key 命名 hint（与 memory-center tenantCode 规则对齐） */
  private resolveTenantCodeHint(user: SsoUserInfo): string | null {
    const userCode = user.code?.trim() ?? '';
    const companyCode = user.companyCode?.trim() ?? '';
    if (getCurrentEnvConfig().isDevelopment) {
      return userCode || null;
    }
    return companyCode || null;
  }

  private async getCachedSkForUser(user: SsoUserInfo): Promise<string | null> {
    const tenantCode = this.resolveTenantCodeHint(user);
    if (!tenantCode || !user.code) {
      return null;
    }
    const cached = await getApiKey(this.skCacheKey(tenantCode, user.code));
    if (!cached) {
      return null;
    }
    try {
      const sk = await this.decryptSk(cached);
      logger.info(`[site-sk] SK decrypted from cache for tenant=${tenantCode} (len=${sk.length})`);
      return sk;
    } catch {
      logger.info('[site-sk] Legacy plaintext SK cache hit, will re-encrypt on next fetch');
      return cached;
    }
  }

  private async clearSkCache(user: SsoUserInfo): Promise<void> {
    await this.purgeLegacySkCache();
    if (!user.code) return;
    const tenantCode = this.resolveTenantCodeHint(user);
    if (tenantCode) {
      await deleteApiKey(this.skCacheKey(tenantCode, user.code));
    }
    if (user.companyCode?.trim() && user.companyCode.trim() !== tenantCode) {
      await deleteApiKey(this.skCacheKey(user.companyCode.trim(), user.code));
    }
    if (user.code !== tenantCode) {
      await deleteApiKey(this.skCacheKey(user.code, user.code));
    }
  }

  private async purgeLegacySkCache(): Promise<void> {
    await deleteApiKey(SiteSkStrategy.LEGACY_SK_CACHE_KEY);
  }

  private async decryptSk(encrypted: string): Promise<string> {
    const key = await this.getDecryptKey();
    const keyBuffer = Buffer.from(key, 'utf-8');
    const decipher = crypto.createDecipheriv('aes-128-ecb', keyBuffer, null);
    return decipher.update(encrypted, 'base64', 'utf-8') + decipher.final('utf-8');
  }

  private isTestEnvironment(env?: string | null): boolean {
    const normalized = env?.trim().toLowerCase() || '';
    return ['test', 'pre-release', 'daily', 'daily-external'].some(
      (e) => normalized.includes(e),
    );
  }
}

let instance: SiteSkStrategy | null = null;

export function getSiteSkStrategy(): SiteSkStrategy {
  if (!instance) instance = new SiteSkStrategy();
  return instance;
}
