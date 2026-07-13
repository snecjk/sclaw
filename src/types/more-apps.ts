/**
 * More Apps (应用广场) type definitions
 * Aligned with the PRD demo (more-apps.js / more-apps.css)
 */

export type AppKind = 'builtin' | 'external';

/** Color tone for the circular gradient icon */
export type AppTone = 'blue' | 'orange' | 'green' | 'purple' | 'teal' | 'gray';

export interface AppItem {
  /** Unique identifier — builtin apps use a stable slug; external apps use a generated id */
  id: string;
  /** Display name */
  name: string;
  /** Short description */
  description?: string;
  /** URL to open in iframe / external browser */
  url: string;
  /** Icon key (for builtin) or icon SVG string (for external) */
  iconKey?: string;
  /** Remote icon URL — takes precedence over iconKey when set */
  iconUrl?: string;
  /** Color tone for the gradient icon background */
  tone?: AppTone;
  /** Category label for the "应用广场" tab filter */
  category?: string;
  /** Hide from market / installed lists without removing config */
  hidden?: boolean;
  /** Whether this is a builtin or user-added external app */
  kind: AppKind;
  /** Whether the app is currently installed */
  installed?: boolean;
  /** Whether this is an external app (user-added) */
  external?: boolean;
  /** Whether this is an official app */
  official?: boolean;
  /** Whether this app is recommended (shows in the featured section) */
  recommended?: boolean;
  /** Badge text like "热门", "推荐", "新品" */
  badge?: string;
  /** Recent usage time label like "今天 10:20" */
  recent?: string;
  /** ISO timestamp of creation (for external apps) */
  createdAt?: number;
  /** Sort order */
  order?: number;
}

export type MoreAppsTab = 'market' | 'installed';

export type MoreAppsSortMode = 'default' | 'name';

/** Market tab filter id — `featured` shows all visible apps; otherwise matches `category` */
export type MarketCategory = 'featured' | (string & {});
