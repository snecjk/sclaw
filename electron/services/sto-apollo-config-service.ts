/**
 * STO Apollo Config Service
 * Reads dynamic configuration from the STO backend Apollo config endpoint.
 */

import { getStoToken } from '../utils/auth-store';
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

const DEFAULT_HQ_INFERENCE_PRODUCT_CODE = 'enterprise-Intelligence';

let hqInferenceProductCode: string | null = null;

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
