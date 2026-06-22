/**
 * 用户个人 SK 管理服务（策略委托入口）
 *
 * 根据用户类型（网点/非网点）委托给对应的策略实现：
 * - HqSkStrategy: 非网点用户
 * - SiteSkStrategy: 网点用户
 */

import { getAuthState, type SsoUserInfo } from '../utils/auth-store';
import { resolveStrategy } from './sto-sk-strategy';
import type { TokenQuotaTierQueryResult } from '../../shared/sto-token-quota-tier';
import { logger } from '../utils/logger';

/**
 * 获取用户个人 SK（优先读缓存 → 查询 → 查无则创建）
 * 根据用户类型自动选择策略
 */
export async function getUserSk(forceRefresh = false): Promise<string | null> {
  logger.info(`[user-sk] getUserSk called, forceRefresh=${forceRefresh}`);

  const { user } = await getAuthState();
  const strategy = await resolveStrategy(user);

  if (!strategy || !user) {
    logger.warn(`[user-sk] No strategy or user: strategy=${!!strategy}, user=${!!user}`);
    return null;
  }

  logger.info(`[user-sk] Delegating to strategy, userCode=${user.code}, categoryCode=${user.categoryCode}`);
  return strategy.getUserSk(user, forceRefresh);
}

/**
 * 获取用户 SK 详情（包含 spend / maxBudget 等元数据，不解密 SK）
 * 根据用户类型自动选择策略
 */
export async function getUserSkDetail(): Promise<{ tokenId: string; spend: number; maxBudget: number } | null> {
  logger.info('[user-sk] getUserSkDetail called');

  const { user } = await getAuthState();
  const strategy = await resolveStrategy(user);

  if (!strategy || !user) {
    logger.warn(`[user-sk] No strategy or user for detail: strategy=${!!strategy}, user=${!!user}`);
    return null;
  }

  logger.info(`[user-sk] Delegating detail to strategy, userCode=${user.code}`);
  return strategy.getUserSkDetail(user);
}

/**
 * 扩容用户 Key 额度
 * 根据用户类型自动选择策略
 */
export async function expandUserSkQuota(
  tokenId: string,
  quotaAmount: number,
): Promise<{ success: boolean; message?: string }> {
  logger.info(`[user-sk] expandUserSkQuota called, tokenId=${tokenId}, quotaAmount=${quotaAmount}`);

  const { user } = await getAuthState();
  const strategy = await resolveStrategy(user);

  if (!strategy || !user) {
    logger.warn(`[user-sk] No strategy or user for expansion: strategy=${!!strategy}, user=${!!user}`);
    return { success: false, message: 'No user or strategy' };
  }

  logger.info(`[user-sk] Delegating expansion to strategy, userCode=${user.code}`);
  return strategy.expandQuota(user, tokenId, quotaAmount);
}

/**
 * 查询 Token 额度档位列表（扩容申请弹框数据）
 */
export async function getUserTokenQuotaTiers(
  tokenId: string,
): Promise<TokenQuotaTierQueryResult | null> {
  logger.info(`[user-sk] getUserTokenQuotaTiers called, tokenId=${tokenId}`);

  const { user } = await getAuthState();
  const strategy = await resolveStrategy(user);

  if (!strategy || !user) {
    logger.warn(`[user-sk] No strategy or user for quota tiers: strategy=${!!strategy}, user=${!!user}`);
    return null;
  }

  if (!tokenId) {
    logger.warn('[user-sk] getUserTokenQuotaTiers failed: tokenId is empty');
    return null;
  }

  return strategy.queryTokenQuotaTier(user, tokenId);
}

/**
 * 登出时清理用户 SK
 * 根据用户类型自动选择策略清理缓存
 */
export async function clearUserSk(userOverride?: SsoUserInfo | null): Promise<void> {
  logger.info('[user-sk] clearUserSk called');

  const user = userOverride ?? (await getAuthState()).user;
  const strategy = await resolveStrategy(user);

  if (strategy && user) {
    logger.info(`[user-sk] Delegating cache clear to strategy, userCode=${user.code}`);
    await strategy.clearCache(user);
  } else {
    logger.info('[user-sk] No strategy or user, skip cache clear');
  }
}
