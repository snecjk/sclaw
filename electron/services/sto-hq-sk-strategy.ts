/**
 * 非网点 SK 策略实现
 * 从 user-sk-service.ts 迁移，包装成 HqSkStrategy 类
 * 域名: devops-llmgatewayapi.sto.cn
 * 鉴权: md5(userCode)
 * 响应: { code, msg, data: [...] }
 */

import type { StoSkStrategy } from './sto-sk-strategy';
import type { SsoUserInfo } from '../utils/auth-store';
import type { TokenQuotaTierQueryResult } from '../../shared/sto-token-quota-tier';
import { getStoToken, getSsoEnvironment } from '../utils/auth-store';
import { storeApiKey, getApiKey, deleteApiKey } from '../utils/secure-storage';
import { logger } from '../utils/logger';
import crypto from 'crypto';

export class HqSkStrategy implements StoSkStrategy {
  private static readonly CACHE_KEY = 'sto';
  private static readonly DEFAULT_TENANT_CODE = 'enterprise-Intelligence';
  private static readonly TIMEOUT_MS = 8000;

  /** 非网点 SK 解密密钥（按环境区分） */
  private static readonly AES_KEYS: Record<string, string> = {
    prod: '2074c2350686f0e4',  // 生产环境密钥
    test: '2074c2350686f0e4',  // 测试环境密钥（默认与生产相同，可按需修改）
  };

  private static readonly API_DOMAINS: Record<string, string> = {
    prod: 'https://devops-llmgatewayapi.sto.cn',
    test: 'https://devops-llmgatewayapi-test.sto.cn',
  };

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
        logger.info(`[hq-sk] SK found in cache (len=${cached.length})`);
        return cached;
      }
    }

    const token = await getStoToken();
    if (!token) {
      logger.warn('[hq-sk] No stoToken available');
      return null;
    }

    const tenantCode = HqSkStrategy.DEFAULT_TENANT_CODE;
    logger.info(`[hq-sk] Fetching SK, tenantCode=${tenantCode}`);

    let sk = await this.fetchSkFromApi('query', token, user.code, tenantCode);
    if (!sk) {
      logger.info('[hq-sk] SK not found, creating...');
      sk = await this.fetchSkFromApi('create', token, user.code, tenantCode);
    }

    if (sk) {
      await storeApiKey(HqSkStrategy.CACHE_KEY, sk);
      logger.info(`[hq-sk] SK stored in cache (len=${sk.length})`);
    }

    return sk;
  }

  async getUserSkDetail(
    user: SsoUserInfo,
  ): Promise<{ tokenId: string; spend: number; maxBudget: number } | null> {
    logger.info(`[hq-sk] getUserSkDetail called, userCode=${user.code}`);

    const token = await getStoToken();
    if (!token) {
      logger.warn('[hq-sk] No stoToken for detail');
      return null;
    }

    const tenantCode = HqSkStrategy.DEFAULT_TENANT_CODE;
    const detail = await this.queryKeyDetail(token, user.code, tenantCode);

    if (!detail) {
      logger.warn('[hq-sk] Key detail not found');
      return null;
    }

    const result = {
      tokenId: detail.tokenId,
      spend: detail.spend ?? 0,
      maxBudget: detail.maxBudget ?? 0,
    };

    logger.info(`[hq-sk] Key detail: tokenId=${result.tokenId}, spend=${result.spend}, maxBudget=${result.maxBudget}`);
    return result;
  }

  async getUserModels(user: SsoUserInfo): Promise<string[] | null> {
    logger.info(`[hq-sk] getUserModels called, userCode=${user.code}`);

    const token = await getStoToken();
    if (!token) {
      logger.warn('[hq-sk] No stoToken for models');
      return null;
    }

    const tenantCode = HqSkStrategy.DEFAULT_TENANT_CODE;
    const detail = await this.queryKeyDetail(token, user.code, tenantCode);

    if (!detail?.models) {
      logger.warn('[hq-sk] No models found');
      return null;
    }

    logger.info(`[hq-sk] Models found: ${detail.models.length} items, ids=${JSON.stringify(detail.models)}`);
    return detail.models;
  }

  async getSupplierDomain(): Promise<string> {
    const env = await getSsoEnvironment();
    const domain = this.isTestEnvironment(env)
      ? HqSkStrategy.SUPPLIER_DOMAINS.test
      : HqSkStrategy.SUPPLIER_DOMAINS.prod;
    logger.info(`[hq-sk] getSupplierDomain: env=${env}, domain=${domain}`);
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

  async expandQuota(
    user: SsoUserInfo,
    tokenId: string,
    amount: number,
  ): Promise<{ success: boolean; message?: string }> {
    logger.info(`[hq-sk] expandQuota called, tokenId=${tokenId}, amount=${amount}`);

    if (!user.code) {
      logger.warn('[hq-sk] expandQuota failed: userCode is empty');
      return { success: false, message: 'userCode is empty' };
    }

    const domain = await this.resolveApiDomain();
    const url = `${domain}/openapi/key/quota/applyExpansion`;
    const secret = this.md5(tokenId);
    const operatorName = this.resolveOperatorDisplayName(user);
    const body = {
      tokenId,
      quotaAmount: amount,
      operatorCode: user.code,
      operatorName,
    };

    logger.info(`[hq-sk] expandQuota request: url=${url}`);
    logger.info(`[hq-sk] expandQuota headers: secret=${secret}`);
    logger.info(`[hq-sk] expandQuota body: ${JSON.stringify(body)}`);

    try {
      const response = await this.fetchWithTimeout(url, {
        method: 'POST',
        headers: {
          secret,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });

      const json = (await response.json()) as {
        code: string;
        msg: string;
        detailMsg?: string | null;
      };
      logger.info(
        `[hq-sk] expandQuota response: code=${json.code}, msg=${json.msg}, detailMsg=${json.detailMsg ?? ''}`,
      );

      if (json.code !== '0') {
        const message = json.detailMsg || json.msg || `Code ${json.code}`;
        logger.warn(`[hq-sk] expandQuota biz failed: ${json.code} ${message}`);
        return { success: false, message };
      }

      logger.info(`[hq-sk] expandQuota success, quotaAmount=${amount}`);
      return { success: true };
    } catch (err) {
      logger.warn('[hq-sk] expandQuota error:', err);
      return { success: false, message: String(err) };
    }
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

    const domain = await this.resolveApiDomain();
    const url = `${domain}/openapi/key/queryTokenQuotaTier?tokenId=${encodeURIComponent(tokenId)}`;
    const secret = this.md5(tokenId);

    logger.info(`[hq-sk] queryTokenQuotaTier request: url=${url}`);
    logger.info(`[hq-sk] queryTokenQuotaTier headers: secret=${secret}`);

    try {
      const response = await this.fetchWithTimeout(url, {
        method: 'GET',
        headers: { secret, 'Content-Type': 'application/json' },
      });

      const json = (await response.json()) as {
        code: string;
        msg: string;
        detailMsg?: string | null;
        data?: TokenQuotaTierQueryResult;
      };

      logger.info(`[hq-sk] queryTokenQuotaTier response: code=${json.code}, msg=${json.msg}`);

      if (json.code !== '0' || !json.data) {
        logger.warn(`[hq-sk] queryTokenQuotaTier failed: ${json.msg || json.detailMsg || json.code}`);
        return null;
      }

      return json.data;
    } catch (err) {
      logger.warn('[hq-sk] queryTokenQuotaTier error:', err);
      return null;
    }
  }

  async clearCache(user: SsoUserInfo): Promise<void> {
    await deleteApiKey(HqSkStrategy.CACHE_KEY);
    logger.info(`[hq-sk] Cache cleared for user=${user.code}`);
  }

  // ─── 私有方法 ───

  private async queryKeyDetail(
    token: string,
    userCode: string,
    tenantCode: string,
  ): Promise<{
    tokenId: string;
    encryptedKey: string;
    models: string[];
    status: string;
    spend?: number;
    maxBudget?: number;
  } | null> {
    const domain = await this.resolveApiDomain();
    const url = `${domain}/openapi/key/detail`;
    const secret = this.md5(userCode);
    const body = { userCode, tenantCode };

    logger.info(`[hq-sk] queryKeyDetail request: url=${url}`);
    logger.info(`[hq-sk] queryKeyDetail headers: secret=${secret}`);
    logger.info(`[hq-sk] queryKeyDetail body: ${JSON.stringify(body)}`);

    try {
      const response = await this.fetchWithTimeout(url, {
        method: 'POST',
        headers: {
          secret,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });

      const json = (await response.json()) as {
        code: string;
        msg: string;
        data?: Array<{
          tokenId: string;
          encryptedKey: string;
          models: string[];
          status: string;
          spend?: number;
          maxBudget?: number;
        }>;
      };

      logger.info(`[hq-sk] queryKeyDetail response: code=${json.code}, msg=${json.msg}, dataCount=${json.data?.length ?? 0}`);

      if (json.code !== '0' || !json.data?.[0]) {
        logger.warn(`[hq-sk] queryKeyDetail failed or no data: code=${json.code}`);
        return null;
      }

      const item = json.data[0];
      logger.info(`[hq-sk] queryKeyDetail item: tokenId=${item.tokenId}, status=${item.status}, models=${item.models?.length ?? 0}`);
      return item;
    } catch (err) {
      logger.warn('[hq-sk] queryKeyDetail error:', err);
      return null;
    }
  }

  private async fetchSkFromApi(
    type: 'query' | 'create',
    token: string,
    userCode: string,
    tenantCode: string,
  ): Promise<string | null> {
    const domain = await this.resolveApiDomain();
    const path = type === 'create' ? '/openapi/key/create' : '/openapi/key/detail';
    const url = `${domain}${path}`;
    const secret = this.md5(userCode);
    const body = { userCode, tenantCode };

    logger.info(`[hq-sk] fetchSkFromApi(${type}) request: url=${url}`);
    logger.info(`[hq-sk] fetchSkFromApi(${type}) headers: secret=${secret}`);
    logger.info(`[hq-sk] fetchSkFromApi(${type}) body: ${JSON.stringify(body)}`);

    try {
      const response = await this.fetchWithTimeout(url, {
        method: 'POST',
        headers: {
          secret,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });

      const json = (await response.json()) as {
        code: string;
        msg: string;
        detailMsg?: string;
        data?: Array<{ encryptedKey: string }>;
      };

      logger.info(`[hq-sk] fetchSkFromApi(${type}) response: code=${json.code}, msg=${json.msg}`);

      if (json.code !== '0') {
        logger.warn(`[hq-sk] fetchSkFromApi(${type}) biz failed: ${json.code} ${json.msg}`);
        return null;
      }

      const encryptedKey = json.data?.[0]?.encryptedKey;
      if (!encryptedKey) {
        logger.warn(`[hq-sk] fetchSkFromApi(${type}) missing encryptedKey`);
        return null;
      }

      logger.info(`[hq-sk] fetchSkFromApi(${type}) encryptedKey found, decrypting...`);

      try {
        const sk = await this.decryptSk(encryptedKey);
        logger.info(`[hq-sk] fetchSkFromApi(${type}) SK decrypted successfully (len=${sk.length})`);
        return sk;
      } catch (err) {
        logger.warn(`[hq-sk] fetchSkFromApi(${type}) AES decrypt failed:`, err);
        return null;
      }
    } catch (err) {
      logger.warn(`[hq-sk] fetchSkFromApi(${type}) error:`, err);
      return null;
    }
  }

  private async decryptSk(encryptedBase64: string): Promise<string> {
    const key = await this.getDecryptKey();
    const keyBuffer = Buffer.from(key, 'utf-8');
    const decipher = crypto.createDecipheriv('aes-128-ecb', keyBuffer, null);
    let decrypted = decipher.update(encryptedBase64, 'base64', 'utf-8');
    decrypted += decipher.final('utf-8');
    return decrypted;
  }

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

  private isTestEnvironment(env?: string | null): boolean {
    const normalized = env?.trim().toLowerCase() || '';
    return ['test', 'pre-release', 'daily', 'daily-external'].some(
      (e) => normalized.includes(e),
    );
  }

  private async resolveApiDomain(): Promise<string> {
    const env = await getSsoEnvironment();
    const domain = this.isTestEnvironment(env)
      ? HqSkStrategy.API_DOMAINS.test
      : HqSkStrategy.API_DOMAINS.prod;
    logger.info(`[hq-sk] resolveApiDomain: env=${env}, domain=${domain}`);
    return domain;
  }

  private async fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), HqSkStrategy.TIMEOUT_MS);
    try {
      return await fetch(url, { ...init, signal: controller.signal });
    } finally {
      clearTimeout(timeoutId);
    }
  }
}

// ─── 单例 ───

let instance: HqSkStrategy | null = null;

export function getHqSkStrategy(): HqSkStrategy {
  if (!instance) instance = new HqSkStrategy();
  return instance;
}
