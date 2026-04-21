/**
 * Subscription Type Definitions
 * Types for the subscription feature catalog
 */

/** Feature category tags */
export type FeatureCategory =
  | 'ai-enhanced'
  | 'data-analysis'
  | 'efficiency-tools'
  | 'communication'
  | 'security'
  | 'automation';

/** Subscription status */
export type SubscriptionStatus = 'subscribed' | 'unsubscribed';

/** A subscribable feature */
export interface SubscriptionFeature {
  id: string;
  name: string;
  description: string;
  icon: string;
  tags: FeatureCategory[];
  status: SubscriptionStatus;
  updatedAt?: string;
}

/** GET /api/subscriptions/features response */
export interface SubscriptionListResponse {
  success: boolean;
  data: SubscriptionFeature[];
  error?: string;
}

/** POST /api/subscriptions/subscribe | unsubscribe response */
export interface SubscriptionToggleResponse {
  success: boolean;
  data?: SubscriptionFeature;
  error?: string;
}
