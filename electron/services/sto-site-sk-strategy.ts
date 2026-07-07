/**
 * 网点 SK 策略实现（memory-center 代理）
 *
 * Key 确保 / 额度扩容：经 memory-center 代理供应商 openapi 接口。
 * 模型推理域名：客户端本地 SUPPLIER_DOMAINS，不经 memory-center 管理。
 */

import type { StoSkStrategy } from './sto-sk-strategy';
import type { SsoUserInfo } from '../utils/auth-store';
import type { TokenQuotaTierQueryResult } from '../../shared/sto-token-quota-tier';
import { getSsoEnvironment } from '../utils/auth-store';
import { storeApiKey, getApiKey, deleteApiKey } from '../utils/secure-storage';
import { logger } from '../utils/logger';
import crypto from 'crypto';
import {
  ensureSiteKeyViaMemoryCenter,
} from './sto-site-memory-api-service';

export class SiteSkStrategy implements StoSkStrategy {
  /** @deprecated 旧版全局 SK 缓存键，仅用于迁移清理 */
  private static readonly LEGACY_SK_CACHE_KEY = 'sto-site-sk';
  /** @deprecated 旧版按用户密文缓存前缀，仅用于迁移清理 */
  private static readonly LEGACY_SK_CACHE_KEY_PREFIX = 'sto-site-sk:';
  private static readonly SK_CACHE_KEY_PREFIX = 'sto-site-sk-v2:';

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
      await this.purgeLegacySkCache(user);
      const cachedSk = await this.getCachedSkForUser(user);
      if (cachedSk) {
        return cachedSk;
      }
    }

    const ensured = await ensureSiteKeyViaMemoryCenter(forceRefresh);
    if (!ensured?.apiKey) {
      logger.warn('[site-sk] ensure key via memory-center failed');
      return null;
    }

    const skCacheKey = this.skCacheKey(ensured.tenantCode, user.code);
    await storeApiKey(skCacheKey, ensured.apiKey);
    logger.info(
      `[site-sk] apiKey stored in cache key=${skCacheKey} (len=${ensured.apiKey.length}), created=${ensured.created}`,
    );
    return ensured.apiKey;
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

  async formatInferenceApiKey(_user: SsoUserInfo, plainSk: string): Promise<string> {
    return plainSk;
  }

  async getInferenceHeaders(user: SsoUserInfo): Promise<Record<string, string>> {
    const userCode = user.code?.trim() ?? '';
    if (!userCode) {
      return {};
    }
    const secret = crypto.createHash('md5').update(userCode).digest('hex');
    return { secret };
  }

  async getDecryptKey(): Promise<string> {
    throw new Error('SK decryption is handled by memory-center');
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

  private legacySkCacheKey(tenantCode: string, userCode: string): string {
    return `${SiteSkStrategy.LEGACY_SK_CACHE_KEY_PREFIX}${tenantCode}:${userCode}`;
  }

  /** 本地缓存 key 命名 hint（与 memory-center tenantCode 规则对齐） */
  private resolveTenantCodeHint(user: SsoUserInfo): string | null {
    const companyCode = user.companyCode?.trim() ?? '';
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
    logger.info(`[site-sk] SK loaded from cache for tenant=${tenantCode} (len=${cached.length})`);
    return cached;
  }

  private async clearSkCache(user: SsoUserInfo): Promise<void> {
    await this.purgeLegacySkCache(user);
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

  private async purgeLegacySkCache(user?: SsoUserInfo): Promise<void> {
    await deleteApiKey(SiteSkStrategy.LEGACY_SK_CACHE_KEY);
    if (!user?.code) return;
    const tenantCode = this.resolveTenantCodeHint(user);
    if (tenantCode) {
      await deleteApiKey(this.legacySkCacheKey(tenantCode, user.code));
    }
    if (user.companyCode?.trim() && user.companyCode.trim() !== tenantCode) {
      await deleteApiKey(this.legacySkCacheKey(user.companyCode.trim(), user.code));
    }
    if (user.code !== tenantCode) {
      await deleteApiKey(this.legacySkCacheKey(user.code, user.code));
    }
  }

  private isTestEnvironment(env?: string | null): boolean {
    const normalized = env?.trim().toLowerCase() || '';
    return ['test', 'pre-release', 'daily', 'daily-external', 'local'].some(
      (e) => normalized.includes(e),
    );
  }
}

let instance: SiteSkStrategy | null = null;

export function getSiteSkStrategy(): SiteSkStrategy {
  if (!instance) instance = new SiteSkStrategy();
  return instance;
}
