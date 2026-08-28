/**
 * 非网点 SK 策略实现（memory-center 代理）
 *
 * Key 确保 / 详情 / 模型列表 / 套餐档位 / 额度扩容 UI：经 memory-center 代理供应商 openapi。
 * 模型推理域名：优先 Apollo `claw.hq.inference.portal.domain`，登录后拉取；兜底为本地 SUPPLIER_DOMAINS。
 */

import type { StoSkStrategy } from './sto-sk-strategy';
import type { SsoUserInfo } from '../utils/auth-store';
import type { TokenQuotaTierQueryResult } from '../../shared/sto-token-quota-tier';
import { getSsoEnvironment } from '../utils/auth-store';
import { getAiResourceStoToken } from './sto-auth-mode';
import { storeApiKey, getApiKey, deleteApiKey } from '../utils/secure-storage';
import { logger } from '../utils/logger';
import {
  ensureHqKeyViaMemoryCenter,
  fetchHqTokenQuotaTiersViaMemoryCenter,
  StoHqMemoryApiError,
} from './sto-hq-memory-api-service';
import {
  getHqInferenceProductCode,
  hasHqInferenceProductCodeCached,
  loadHqInferencePortalDomain,
  loadHqInferenceProductCode,
  hasHqInferencePortalDomainCached,
  resolveHqInferencePortalDomain,
} from './sto-apollo-config-service';

export class HqSkStrategy implements StoSkStrategy {
  private static readonly CACHE_KEY_PREFIX = 'sto-sk-v2:';
  /** @deprecated pre-session global cache; never read to avoid cross-user reuse. */
  private static readonly LEGACY_GLOBAL_CACHE_KEY = 'sto-sk-v2';
  /** @deprecated 旧版密文缓存键，仅用于迁移清理 */
  private static readonly LEGACY_CACHE_KEY = 'sto';

  // ─── 公开接口实现 ───

  async getUserSk(user: SsoUserInfo, forceRefresh: boolean): Promise<string | null> {
    logger.info(`[hq-sk] getUserSk called, userCode=${user.code}, forceRefresh=${forceRefresh}`);

    if (!forceRefresh) {
      const cached = await getApiKey(this.cacheKey(user));
      if (cached) {
        logger.info(`[hq-sk] SK loaded from cache (len=${cached.length})`);
        return cached;
      }
    }

    const token = await getAiResourceStoToken();
    if (!token) {
      logger.warn('[hq-sk] No AI resource stoToken available');
      return null;
    }

    logger.info('[hq-sk] Fetching SK via memory-center ensure');
    try {
      const ensured = await ensureHqKeyViaMemoryCenter();
      if (!ensured?.apiKey) {
        logger.warn('[hq-sk] ensure key via memory-center failed: empty apiKey');
        return null;
      }

      await storeApiKey(this.cacheKey(user), ensured.apiKey);
      logger.info(
        `[hq-sk] apiKey stored in cache (len=${ensured.apiKey.length}), created=${ensured.created}`,
      );
      return ensured.apiKey;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.warn(`[hq-sk] ensure key via memory-center failed: ${message}`);
      throw err;
    }
  }

  async getUserSkDetail(
    user: SsoUserInfo,
  ): Promise<{ tokenId: string; spend: number; maxBudget: number } | null> {
    logger.info(`[hq-sk] getUserSkDetail called, userCode=${user.code}`);

    try {
      const ensured = await ensureHqKeyViaMemoryCenter();
      if (!ensured) {
        logger.warn('[hq-sk] Failed to get key detail via memory-center');
        return null;
      }

      const result = {
        tokenId: ensured.tokenId,
        spend: ensured.spend,
        maxBudget: ensured.maxBudget,
      };
      logger.info(
        `[hq-sk] Key detail via memory-center: tokenId=${result.tokenId}, spend=${result.spend}, maxBudget=${result.maxBudget}`,
      );
      return result;
    } catch (err) {
      const message = err instanceof StoHqMemoryApiError ? err.message : String(err);
      logger.warn(`[hq-sk] getUserSkDetail via memory-center failed: ${message}`);
      return null;
    }
  }

  async getUserModels(user: SsoUserInfo): Promise<string[] | null> {
    logger.info(`[hq-sk] getUserModels called, userCode=${user.code}`);

    try {
      const ensured = await ensureHqKeyViaMemoryCenter();
      if (!ensured?.models.length) {
        logger.warn('[hq-sk] No models from memory-center ensure');
        return null;
      }

      logger.info(`[hq-sk] Models from memory-center: ${ensured.models.length} items`);
      return ensured.models;
    } catch (err) {
      const message = err instanceof StoHqMemoryApiError ? err.message : String(err);
      logger.warn(`[hq-sk] getUserModels via memory-center failed: ${message}`);
      return null;
    }
  }

  async getSupplierDomain(): Promise<string> {
    if (!hasHqInferencePortalDomainCached()) {
      await loadHqInferencePortalDomain();
    }
    const env = await getSsoEnvironment();
    const domain = resolveHqInferencePortalDomain(env);
    logger.info(
      `[hq-sk] getSupplierDomain: env=${env}, domain=${domain}, apollo=${hasHqInferencePortalDomainCached()}`,
    );
    return domain;
  }

  async formatInferenceApiKey(_user: SsoUserInfo, plainSk: string): Promise<string> {
    if (!hasHqInferenceProductCodeCached()) {
      await loadHqInferenceProductCode();
    }
    const productCode = getHqInferenceProductCode();
    const inferenceKey = `${plainSk}&&${productCode}`;
    logger.info(`[hq-sk] formatInferenceApiKey: productCode=${productCode}`);
    return inferenceKey;
  }

  async getInferenceHeaders(_user: SsoUserInfo): Promise<Record<string, string>> {
    return {};
  }

  async getDecryptKey(): Promise<string> {
    throw new Error('SK decryption is handled by memory-center');
  }

  async queryTokenQuotaTier(
    _user: SsoUserInfo,
    tokenId: string,
  ): Promise<TokenQuotaTierQueryResult | null> {
    logger.info(`[hq-sk] queryTokenQuotaTier called, tokenId=${tokenId}`);

    if (!tokenId) {
      logger.warn('[hq-sk] queryTokenQuotaTier failed: tokenId is empty');
      return null;
    }

    try {
      return await fetchHqTokenQuotaTiersViaMemoryCenter(tokenId);
    } catch (err) {
      logger.warn('[hq-sk] queryTokenQuotaTier via memory-center error:', err);
      return null;
    }
  }

  async clearCache(user: SsoUserInfo): Promise<void> {
    await deleteApiKey(this.cacheKey(user));
    await deleteApiKey(HqSkStrategy.LEGACY_GLOBAL_CACHE_KEY);
    await deleteApiKey(HqSkStrategy.LEGACY_CACHE_KEY);
    logger.info(`[hq-sk] Cache cleared for user=${user.code}`);
  }

  private cacheKey(user: SsoUserInfo): string {
    return `${HqSkStrategy.CACHE_KEY_PREFIX}${user.id || user.code}`;
  }
}

// ─── 单例 ───

let instance: HqSkStrategy | null = null;

export function getHqSkStrategy(): HqSkStrategy {
  if (!instance) instance = new HqSkStrategy();
  return instance;
}
