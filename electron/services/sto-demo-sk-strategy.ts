/**
 * 总部演示切网点 — AI 资源委托 HqSkStrategy，user 取自 impersonationOrigin。
 */

import type { StoSkStrategy } from './sto-sk-strategy';
import type { SsoUserInfo } from '../utils/auth-store';
import type { TokenQuotaTierQueryResult } from '../../shared/sto-token-quota-tier';
import { getImpersonationOrigin } from '../utils/auth-store';
import { getHqSkStrategy } from './sto-hq-sk-strategy';
import { logger } from '../utils/logger';

export class DemoSkStrategy implements StoSkStrategy {
  private async requireOriginUser(): Promise<SsoUserInfo | null> {
    const origin = await getImpersonationOrigin();
    if (!origin?.stoToken) {
      logger.warn('[demo-sk] impersonationOrigin missing or has no stoToken');
      return null;
    }
    return origin;
  }

  async getUserSk(_user: SsoUserInfo, forceRefresh: boolean): Promise<string | null> {
    const origin = await this.requireOriginUser();
    if (!origin) return null;
    logger.info(`[demo-sk] getUserSk delegating to HQ, originCode=${origin.code}`);
    return getHqSkStrategy().getUserSk(origin, forceRefresh);
  }

  async getUserSkDetail(
    _user: SsoUserInfo,
  ): Promise<{ tokenId: string; spend: number; maxBudget: number } | null> {
    const origin = await this.requireOriginUser();
    if (!origin) return null;
    logger.info(`[demo-sk] getUserSkDetail delegating to HQ, originCode=${origin.code}`);
    return getHqSkStrategy().getUserSkDetail(origin);
  }

  async getUserModels(_user: SsoUserInfo): Promise<string[] | null> {
    const origin = await this.requireOriginUser();
    if (!origin) return null;
    logger.info(`[demo-sk] getUserModels delegating to HQ, originCode=${origin.code}`);
    return getHqSkStrategy().getUserModels(origin);
  }

  async getSupplierDomain(): Promise<string> {
    logger.info('[demo-sk] getSupplierDomain delegating to HQ');
    return getHqSkStrategy().getSupplierDomain();
  }

  async formatInferenceApiKey(user: SsoUserInfo, plainSk: string): Promise<string> {
    const origin = await this.requireOriginUser();
    if (!origin) return plainSk;
    logger.info('[demo-sk] formatInferenceApiKey delegating to HQ');
    return getHqSkStrategy().formatInferenceApiKey(origin, plainSk);
  }

  async getInferenceHeaders(user: SsoUserInfo): Promise<Record<string, string>> {
    const origin = await this.requireOriginUser();
    if (!origin) return {};
    logger.info('[demo-sk] getInferenceHeaders delegating to HQ');
    return getHqSkStrategy().getInferenceHeaders(origin);
  }

  async getDecryptKey(): Promise<string> {
    return getHqSkStrategy().getDecryptKey();
  }

  async queryTokenQuotaTier(
    _user: SsoUserInfo,
    tokenId: string,
  ): Promise<TokenQuotaTierQueryResult | null> {
    const origin = await this.requireOriginUser();
    if (!origin) return null;
    logger.info(`[demo-sk] queryTokenQuotaTier delegating to HQ, tokenId=${tokenId}`);
    return getHqSkStrategy().queryTokenQuotaTier(origin, tokenId);
  }

  async clearCache(_user: SsoUserInfo): Promise<void> {
    const origin = await this.requireOriginUser();
    if (!origin) return;
    logger.info(`[demo-sk] clearCache delegating to HQ, originCode=${origin.code}`);
    await getHqSkStrategy().clearCache(origin);
  }
}

let instance: DemoSkStrategy | null = null;

export function getDemoSkStrategy(): DemoSkStrategy {
  if (!instance) instance = new DemoSkStrategy();
  return instance;
}
