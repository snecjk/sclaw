/**
 * STO SK 策略接口 + 工厂函数
 *
 * 网点与非网点各自实现该接口，入口层通过 resolveStrategy() 选择策略
 */

import type { SsoUserInfo } from '../utils/auth-store';
import type { TokenQuotaTierQueryResult } from '../../shared/sto-token-quota-tier';
import { isSiteUser, getSiteDepartmentTypes, setSiteDepartmentTypes } from '../../shared/site-user-utils';
import { resolveAuthMode } from './sto-auth-mode';
import { getHqSkStrategy } from './sto-hq-sk-strategy';
import { getSiteSkStrategy } from './sto-site-sk-strategy';
import { getDemoSkStrategy } from './sto-demo-sk-strategy';
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

  /** 查询额度档位列表（非网点实现；网点暂未对接） */
  queryTokenQuotaTier(
    user: SsoUserInfo,
    tokenId: string,
  ): Promise<TokenQuotaTierQueryResult | null>;

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

async function resolveNativeStrategy(user: SsoUserInfo): Promise<StoSkStrategy | null> {
  await ensureSiteDepartmentTypesLoaded();

  const siteTypes = getSiteDepartmentTypes();
  const isSiteFromConfig = isSiteUser(user.categoryCode);

  let isSite = isSiteFromConfig;
  if (!isSite && (!siteTypes || siteTypes.size === 0)) {
    const categoryLower = user.categoryCode.trim();
    isSite = SITE_KEYWORDS.some(keyword => categoryLower.includes(keyword));
    if (isSite) {
      logger.info(`[strategy] Apollo config empty, fallback: categoryCode="${user.categoryCode}" contains site keyword`);
    }
  }

  logger.info(`[strategy] resolveNativeStrategy: userCode=${user.code}, categoryCode="${user.categoryCode}", isSite=${isSite}`);

  if (isSite) {
    logger.info('[strategy] resolveNativeStrategy: Using SiteSkStrategy');
    return getSiteSkStrategy();
  }
  logger.info('[strategy] resolveNativeStrategy: Using HqSkStrategy');
  return getHqSkStrategy();
}

/**
 * 策略工厂：演示态优先，否则按 categoryCode 选 HQ/Site
 */
export async function resolveStrategy(user: SsoUserInfo | null): Promise<StoSkStrategy | null> {
  const mode = await resolveAuthMode();
  if (mode === 'hq-demo-as-site') {
    logger.info('[strategy] resolveStrategy: Using DemoSkStrategy (hq-demo-as-site)');
    return getDemoSkStrategy();
  }

  if (!user?.categoryCode) {
    logger.info('[strategy] resolveStrategy: user or categoryCode is null');
    return null;
  }

  return resolveNativeStrategy(user);
}

/** 解析用户类型（网点 / 非网点）— AI 资源视角，Demo 映射为 hq */
export async function resolveUserType(user: SsoUserInfo | null): Promise<'hq' | 'site' | null> {
  const strategy = await resolveStrategy(user);
  if (!strategy) return null;
  if (strategy === getSiteSkStrategy()) return 'site';
  return 'hq';
}

export { getDemoSkStrategy };
