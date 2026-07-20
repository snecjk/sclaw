/**
 * More Apps (应用广场) registry document shared by Main + Renderer.
 */

export const MORE_APPS_REGISTRY_VERSION = 1 as const;
export type MoreAppsTone = 'blue' | 'orange' | 'green' | 'purple' | 'teal' | 'gray';

/** Persisted external app fields (subset of UI AppItem). */
export interface MoreAppsExternalApp {
  id: string;
  name: string;
  url: string;
  description?: string;
  iconKey?: string;
  iconUrl?: string;
  tone?: MoreAppsTone;
  category?: string;
  hidden?: boolean;
  kind?: 'builtin' | 'external';
  installed?: boolean;
  external?: boolean;
  official?: boolean;
  recommended?: boolean;
  badge?: string;
  recent?: string;
  createdAt?: number;
  order?: number;
}

export interface MoreAppsRegistry {
  version: typeof MORE_APPS_REGISTRY_VERSION;
  externalApps: MoreAppsExternalApp[];
  installedIds: string[];
  favoriteIds: string[];
}

export function createEmptyMoreAppsRegistry(): MoreAppsRegistry {
  return {
    version: MORE_APPS_REGISTRY_VERSION,
    externalApps: [],
    installedIds: [],
    favoriteIds: [],
  };
}

export function isMoreAppsRegistryEmpty(registry: MoreAppsRegistry): boolean {
  return (
    registry.externalApps.length === 0 &&
    registry.installedIds.length === 0 &&
    registry.favoriteIds.length === 0
  );
}
