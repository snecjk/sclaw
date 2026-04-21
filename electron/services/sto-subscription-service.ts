/**
 * STO Subscription Service
 *
 * Proxies subscription feature endpoints from the STO AI Memory Center backend
 * using the stored stoToken and the shared auth header helper.
 */

import { getStoToken } from '../utils/auth-store';
import { buildStoMemoryCenterAuthHeaders } from '../utils/sto-memory-api-auth';
import { resolveStoBaseUrl } from '../utils/sto-domain';
import { logger } from '../utils/logger';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SubscriptionFeature {
  id: string;
  name: string;
  description: string;
  icon: string;
  tags: string[];
  status: 'subscribed' | 'unsubscribed';
  updatedAt?: string;
}

export interface SubscriptionListResponse {
  success: boolean;
  data: SubscriptionFeature[];
  error?: string;
}

export interface SubscriptionToggleResponse {
  success: boolean;
  data?: SubscriptionFeature;
  error?: string;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class StoSubscriptionService {
  /**
   * Fetch all subscribable features with current user's subscription status.
   */
  async listFeatures(): Promise<SubscriptionListResponse> {
    const baseUrl = await resolveStoBaseUrl();
    const token = await getStoToken();
    if (!token) throw new Error('未登录或 stoToken 已过期，请重新登录');

    const url = `${baseUrl}/agent/v1/subscriptions/features`;
    logger.info(`[StoSubscriptionService] listFeatures: ${url}`);

    const res = await fetch(url, {
      method: 'GET',
      headers: {
        ...buildStoMemoryCenterAuthHeaders(token),
        'Content-Type': 'application/json',
      },
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`STO 订阅功能列表获取失败 (${res.status}): ${text}`);
    }

    return (await res.json()) as SubscriptionListResponse;
  }

  /**
   * Subscribe to a feature.
   */
  async subscribe(featureId: string): Promise<SubscriptionToggleResponse> {
    const baseUrl = await resolveStoBaseUrl();
    const token = await getStoToken();
    if (!token) throw new Error('未登录或 stoToken 已过期，请重新登录');

    const url = `${baseUrl}/agent/v1/subscriptions/subscribe`;
    logger.info(`[StoSubscriptionService] subscribe: ${url} featureId=${featureId}`);

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        ...buildStoMemoryCenterAuthHeaders(token),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ featureId }),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`STO 订阅失败 (${res.status}): ${text}`);
    }

    return (await res.json()) as SubscriptionToggleResponse;
  }

  /**
   * Unsubscribe from a feature.
   */
  async unsubscribe(featureId: string): Promise<SubscriptionToggleResponse> {
    const baseUrl = await resolveStoBaseUrl();
    const token = await getStoToken();
    if (!token) throw new Error('未登录或 stoToken 已过期，请重新登录');

    const url = `${baseUrl}/agent/v1/subscriptions/unsubscribe`;
    logger.info(`[StoSubscriptionService] unsubscribe: ${url} featureId=${featureId}`);

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        ...buildStoMemoryCenterAuthHeaders(token),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ featureId }),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`STO 取消订阅失败 (${res.status}): ${text}`);
    }

    return (await res.json()) as SubscriptionToggleResponse;
  }
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

let instance: StoSubscriptionService | null = null;

export function getStoSubscriptionService(): StoSubscriptionService {
  if (!instance) {
    instance = new StoSubscriptionService();
  }
  return instance;
}
