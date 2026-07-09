/**
 * STO Apollo Config Service
 * Reads dynamic configuration from the STO backend Apollo config endpoint.
 */

import { getStoToken, getSsoEnvironment } from '../utils/auth-store';
import { buildStoMemoryCenterAuthHeaders } from '../utils/sto-memory-api-auth';
import { resolveStoBaseUrl } from '../utils/sto-domain';
import { logger } from '../utils/logger';
import { setSiteDepartmentTypes } from '../../shared/site-user-utils';

export interface ApolloConfigResponse {
  success: boolean;
  errCode: string;
  errMessage: string;
  data: {
    key: string;
    value: string;
  } | null;
  extend: unknown;
  total: unknown;
}

const DEFAULT_HQ_INFERENCE_PRODUCT_CODE = 'enterprise-Intelligence';

/** 非网点推理 portal 域名兜底（Apollo 未配置时按 SSO 环境选择） */
export const DEFAULT_HQ_INFERENCE_PORTAL_DOMAINS = {
  prod: 'https://devops-llmgatewayportal.sto.cn',
  test: 'https://devops-llmgatewayportal-test.sto.cn',
} as const;

/** 网点推理 portal 域名兜底 */
export const DEFAULT_SITE_INFERENCE_PORTAL_DOMAINS = {
  prod: 'https://devops-llmgatewayleague.sto.cn',
  test: 'https://devops-llmgatewayleague-test.sto.cn',
} as const;

const TEST_SSO_ENV_KEYWORDS = ['test', 'pre-release', 'daily', 'daily-external', 'local'] as const;

/**
 * Fetch Apollo config value by key from the STO backend.
 * Returns the raw value string or null on failure.
 */
export async function fetchApolloConfigValue(key: string): Promise<string | null> {
  try {
    const token = await getStoToken();
    if (!token) {
      logger.warn(`[ApolloConfig] skip fetch "${key}": no stoToken`);
      return null;
    }

    const baseUrl = await resolveStoBaseUrl();
    const url = `${baseUrl}/agent/v1/apollo-config?key=${encodeURIComponent(key)}`;
    logger.info(`[ApolloConfig] fetch: ${url}`);

    const response = await fetch(url, {
      method: 'GET',
      headers: buildStoMemoryCenterAuthHeaders(token),
    });

    if (!response.ok) {
      logger.warn(`[ApolloConfig] fetch "${key}" failed: HTTP ${response.status}`);
      return null;
    }

    const payload = (await response.json()) as ApolloConfigResponse;
    if (!payload.success || !payload.data) {
      logger.warn(`[ApolloConfig] fetch "${key}" failed: ${payload.errMessage || 'unknown'}`);
      return null;
    }

    return payload.data.value;
  } catch (err) {
    logger.warn(`[ApolloConfig] fetch "${key}" error:`, err);
    return null;
  }
}

export function isTestSsoEnvironment(env?: string | null): boolean {
  const normalized = env?.trim().toLowerCase() || '';
  return TEST_SSO_ENV_KEYWORDS.some((keyword) => normalized.includes(keyword));
}

function normalizePortalDomain(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed) {
    return null;
  }
  const withoutTrailingSlash = trimmed.replace(/\/+$/, '');
  if (/^https?:\/\//i.test(withoutTrailingSlash)) {
    return withoutTrailingSlash;
  }
  return `https://${withoutTrailingSlash}`;
}

/**
 * Load site department types from Apollo config and update the shared cache.
 * Key: cli.registry.security.scope.group.site
 * Returns a Set of category codes (e.g. "承包区", "独立网点").
 */
export async function loadSiteDepartmentTypes(): Promise<Set<string>> {
  const value = await fetchApolloConfigValue('cli.registry.security.scope.group.site');
  setSiteDepartmentTypes(value);
  const types = new Set(
    value
      ? value
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
      : [],
  );
  logger.info('[ApolloConfig] site department types loaded:', Array.from(types));
  return types;
}

let hqInferenceProductCode: string | null = null;
let hqInferencePortalDomain: string | null = null;
let siteInferencePortalDomain: string | null = null;

/**
 * Load HQ inference product code from Apollo config.
 * Key: claw.hq.inference.product.code
 */
export async function loadHqInferenceProductCode(): Promise<void> {
  const value = await fetchApolloConfigValue('claw.hq.inference.product.code');
  if (value?.trim()) {
    hqInferenceProductCode = value.trim();
    logger.info(`[ApolloConfig] HQ inference product code loaded: ${hqInferenceProductCode}`);
  }
}

export function getHqInferenceProductCode(): string {
  return hqInferenceProductCode ?? DEFAULT_HQ_INFERENCE_PRODUCT_CODE;
}

export function hasHqInferenceProductCodeCached(): boolean {
  return hqInferenceProductCode !== null;
}

/**
 * Load HQ inference portal domain from Apollo.
 * Key: claw.hq.inference.portal.domain
 */
export async function loadHqInferencePortalDomain(): Promise<void> {
  const value = await fetchApolloConfigValue('claw.hq.inference.portal.domain');
  const normalized = normalizePortalDomain(value);
  if (normalized) {
    hqInferencePortalDomain = normalized;
    logger.info(`[ApolloConfig] HQ inference portal domain loaded: ${hqInferencePortalDomain}`);
  } else {
    logger.info('[ApolloConfig] HQ inference portal domain not configured in Apollo, will use fallback');
  }
}

/**
 * Load site inference portal domain from Apollo.
 * Key: claw.site.inference.portal.domain
 */
export async function loadSiteInferencePortalDomain(): Promise<void> {
  const value = await fetchApolloConfigValue('claw.site.inference.portal.domain');
  const normalized = normalizePortalDomain(value);
  if (normalized) {
    siteInferencePortalDomain = normalized;
    logger.info(`[ApolloConfig] Site inference portal domain loaded: ${siteInferencePortalDomain}`);
  } else {
    logger.info('[ApolloConfig] Site inference portal domain not configured in Apollo, will use fallback');
  }
}

/**
 * 登录 / setup 前拉取推理相关 Apollo 配置（product code + HQ/Site portal 域名）。
 */
export async function loadClawInferenceRuntimeConfig(): Promise<void> {
  await Promise.all([
    loadHqInferenceProductCode(),
    loadHqInferencePortalDomain(),
    loadSiteInferencePortalDomain(),
  ]);

  const ssoEnv = await getSsoEnvironment();
  const hqDomain = resolveHqInferencePortalDomain(ssoEnv);
  const siteDomain = resolveSiteInferencePortalDomain(ssoEnv);
  logger.info(
    `[ApolloConfig] Inference portal domains synced: ssoEnv=${ssoEnv ?? 'unknown'}, ` +
      `hq=${hqDomain} (source=${hqInferencePortalDomain ? 'apollo' : 'fallback'}), ` +
      `site=${siteDomain} (source=${siteInferencePortalDomain ? 'apollo' : 'fallback'})`,
  );
}

export function hasHqInferencePortalDomainCached(): boolean {
  return hqInferencePortalDomain !== null;
}

export function hasSiteInferencePortalDomainCached(): boolean {
  return siteInferencePortalDomain !== null;
}

export function resolveHqInferencePortalDomain(ssoEnv?: string | null): string {
  if (hqInferencePortalDomain) {
    return hqInferencePortalDomain;
  }
  return isTestSsoEnvironment(ssoEnv)
    ? DEFAULT_HQ_INFERENCE_PORTAL_DOMAINS.test
    : DEFAULT_HQ_INFERENCE_PORTAL_DOMAINS.prod;
}

export function resolveSiteInferencePortalDomain(ssoEnv?: string | null): string {
  if (siteInferencePortalDomain) {
    return siteInferencePortalDomain;
  }
  return isTestSsoEnvironment(ssoEnv)
    ? DEFAULT_SITE_INFERENCE_PORTAL_DOMAINS.test
    : DEFAULT_SITE_INFERENCE_PORTAL_DOMAINS.prod;
}

/** 登出时清除推理运行时 Apollo 缓存，避免换用户复用旧配置。 */
export function clearInferenceRuntimeConfigCache(): void {
  hqInferenceProductCode = null;
  hqInferencePortalDomain = null;
  siteInferencePortalDomain = null;
}
