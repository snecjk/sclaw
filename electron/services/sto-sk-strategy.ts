/**
 * STO SK 策略接口 + 工厂函数
 *
 * 网点与非网点各自实现该接口，入口层通过 resolveStrategy() 选择策略
 */

import type { SsoUserInfo } from '../utils/auth-store';
import { isSiteUser, getSiteDepartmentTypes, setSiteDepartmentTypes } from '../../shared/site-user-utils';
import { getHqSkStrategy } from './sto-hq-sk-strategy';
import { getSiteSkStrategy } from './sto-site-sk-strategy';
import { logger } from '../utils/logger';

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

  /** 获取消息发送域名（用于 Gateway 发送消息） */
  getSupplierDomain(): Promise<string>;

  /** 获取 SK 解密密钥（根据当前环境返回对应密钥） */
  getDecryptKey(): Promise<string>;

  /** 扩容额度（amount 语义由实现决定：非网点=目标值，网点=增加值） */
  expandQuota(
    user: SsoUserInfo,
    tokenId: string,
    amount: number,
  ): Promise<{ success: boolean; message?: string }>;

  /** 清理缓存（登出/切换登录时调用） */
  clearCache(user: SsoUserInfo): Promise<void>;
}

/** 加载完成的 Promise，用于等待 */
let siteTypesLoadPromise: Promise<void> | null = null;

/**
 * 硬编码的网点关键字列表（兜底方案）
 * 当 Apollo 配置加载失败时，检查 categoryCode 是否包含这些关键字
 */
const SITE_KEYWORDS = ['承包区', '独立网点', '网点部门', '丹鸟加盟站点'];

/**
 * 确保 siteDepartmentTypes 已加载
 * 如果未加载，主动调用 Apollo 配置接口加载
 */
async function ensureSiteDepartmentTypesLoaded(): Promise<void> {
  const siteTypes = getSiteDepartmentTypes();
  if (siteTypes && siteTypes.size > 0) {
    logger.info(`[strategy] siteDepartmentTypes already loaded: [${Array.from(siteTypes).join(', ')}]`);
    return;
  }

  // 如果正在加载，等待加载完成
  if (siteTypesLoadPromise) {
    logger.info('[strategy] siteDepartmentTypes is loading, waiting...');
    await siteTypesLoadPromise;
    return;
  }

  // 开始加载
  siteTypesLoadPromise = (async () => {
    try {
      logger.info('[strategy] Loading siteDepartmentTypes from Apollo config...');
      const { loadSiteDepartmentTypes } = await import('./sto-apollo-config-service');
      const types = await loadSiteDepartmentTypes();
      setSiteDepartmentTypes(Array.from(types));
      logger.info(`[strategy] siteDepartmentTypes loaded: [${Array.from(types).join(', ')}]`);
    } catch (err) {
      logger.warn('[strategy] Failed to load siteDepartmentTypes:', err);
    } finally {
      siteTypesLoadPromise = null;
    }
  })();

  await siteTypesLoadPromise;
}

/**
 * 策略工厂：根据用户类型返回策略实例
 * Apollo 未加载时主动加载配置，确保正确判断用户类型
 */
export async function resolveStrategy(user: SsoUserInfo | null): Promise<StoSkStrategy | null> {
  if (!user?.categoryCode) {
    logger.info('[strategy] resolveStrategy: user or categoryCode is null');
    return null;
  }

  // 确保 siteDepartmentTypes 已加载
  await ensureSiteDepartmentTypesLoaded();

  const siteTypes = getSiteDepartmentTypes();
  const isSiteFromConfig = isSiteUser(user.categoryCode);

  // 兜底逻辑：Apollo 配置为空时，检查 categoryCode 是否包含网点关键字
  let isSite = isSiteFromConfig;
  if (!isSite && (!siteTypes || siteTypes.size === 0)) {
    const categoryLower = user.categoryCode.trim();
    isSite = SITE_KEYWORDS.some(keyword => categoryLower.includes(keyword));
    if (isSite) {
      logger.info(`[strategy] Apollo config empty, fallback: categoryCode="${user.categoryCode}" contains site keyword`);
    }
  }

  logger.info(`[strategy] resolveStrategy: userCode=${user.code}, categoryCode="${user.categoryCode}", siteTypes=${siteTypes ? `[${Array.from(siteTypes).join(', ')}]` : 'null (empty)'}, isSiteFromConfig=${isSiteFromConfig}, isSite=${isSite}`);

  if (isSite) {
    logger.info('[strategy] resolveStrategy: Using SiteSkStrategy');
    return getSiteSkStrategy();
  } else {
    logger.info('[strategy] resolveStrategy: Using HqSkStrategy');
    return getHqSkStrategy();
  }
}
