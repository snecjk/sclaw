/**
 * 非网点 SK 策略实现（memory-center 代理）
 *
 * Key 确保 / 详情 / 模型列表 / 套餐档位 / 额度扩容 UI：经 memory-center 代理供应商 openapi。
 * 模型推理域名：客户端本地 SUPPLIER_DOMAINS，不经 memory-center 管理。
 */

import type { StoSkStrategy } from './sto-sk-strategy';
import type { SsoUserInfo } from '../utils/auth-store';
import type { TokenQuotaTierQueryResult } from '../../shared/sto-token-quota-tier';
import { getStoToken, getSsoEnvironment } from '../utils/auth-store';
import { storeApiKey, getApiKey, deleteApiKey } from '../utils/secure-storage';
import { logger } from '../utils/logger';
import {
  ensureHqKeyViaMemoryCenter,
  fetchHqTokenQuotaTiersViaMemoryCenter,
  StoHqMemoryApiError,
} from './sto-hq-memory-api-service';
import crypto from 'crypto';

export class HqSkStrategy implements StoSkStrategy {
  private static readonly CACHE_KEY = 'sto';

  /** 非网点 SK 解密密钥（按环境区分） */
  private static readonly AES_KEYS: Record<string, string> = {
    prod: '2074c2350686f0e4',
    test: '2074c2350686f0e4',
  };

  /** 模型推理 Gateway baseUrl 域名（客户端本地，不经 memory-center） */
  private static readonly SUPPLIER_DOMAINS: Record<string, string> = {
    prod: 'https://devops-llmgateway.sto.cn',
    test: 'https://devops-llmgateway-test.sto.cn',
  };

  // ─── 公开接口实现 ───

  async getUserSk(user: SsoUserInfo, forceRefresh: boolean): Promise<string | null> {
    logger.info(`[hq-sk] getUserSk called, userCode=${user.code}, forceRefresh=${forceRefresh}`);

    if (!forceRefresh) {
      const cached = await getApiKey(HqSkStrategy.CACHE_KEY);
      if (cached) {
        const sk = await this.decryptCachedSk(cached);
        if (sk) {
          logger.info(`[hq-sk] SK decrypted from cache (len=${sk.length})`);
          return sk;
        }
      }
    }

    const token = await getStoToken();
    if (!token) {
      logger.warn('[hq-sk] No stoToken available');
      return null;
    }

    logger.info('[hq-sk] Fetching SK via memory-center ensure');
    try {
      const ensured = await ensureHqKeyViaMemoryCenter();
      if (!ensured?.encryptedKey) {
        logger.warn('[hq-sk] ensure key via memory-center failed: empty encryptedKey');
        return null;
      }

      await storeApiKey(HqSkStrategy.CACHE_KEY, ensured.encryptedKey);
      logger.info(
        `[hq-sk] encryptedKey stored in cache (len=${ensured.encryptedKey.length}), created=${ensured.created}`,
      );
      return this.decryptSk(ensured.encryptedKey);
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
    const env = await getSsoEnvironment();
    const domain = this.isTestEnvironment(env)
      ? HqSkStrategy.SUPPLIER_DOMAINS.test
      : HqSkStrategy.SUPPLIER_DOMAINS.prod;
    logger.info(`[hq-sk] getSupplierDomain (local inference): env=${env}, domain=${domain}`);
    return domain;
  }

  async getDecryptKey(): Promise<string> {
    const env = await getSsoEnvironment();
    const key = this.isTestEnvironment(env)
      ? HqSkStrategy.AES_KEYS.test
      : HqSkStrategy.AES_KEYS.prod;
    logger.info(`[hq-sk] getDecryptKey: env=${env}, key=${key.substring(0, 4)}...`);
    return key;
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
    await deleteApiKey(HqSkStrategy.CACHE_KEY);
    logger.info(`[hq-sk] Cache cleared for user=${user.code}`);
  }

  // ─── 私有方法 ───

  private async decryptSk(encryptedBase64: string): Promise<string> {
    const key = await this.getDecryptKey();
    const keyBuffer = Buffer.from(key, 'utf-8');
    const decipher = crypto.createDecipheriv('aes-128-ecb', keyBuffer, null);
    let decrypted = decipher.update(encryptedBase64, 'base64', 'utf-8');
    decrypted += decipher.final('utf-8');
    return decrypted;
  }

  /** 读本地缓存：优先按 encryptedKey 解密；兼容旧版明文缓存 */
  private async decryptCachedSk(cached: string): Promise<string | null> {
    try {
      return await this.decryptSk(cached);
    } catch {
      logger.info('[hq-sk] Legacy plaintext SK cache hit, will re-encrypt on next fetch');
      return cached;
    }
  }

  private isTestEnvironment(env?: string | null): boolean {
    const normalized = env?.trim().toLowerCase() || '';
    return ['test', 'pre-release', 'daily', 'daily-external'].some(
      (e) => normalized.includes(e),
    );
  }
}

// ─── 单例 ───

let instance: HqSkStrategy | null = null;

export function getHqSkStrategy(): HqSkStrategy {
  if (!instance) instance = new HqSkStrategy();
  return instance;
}
