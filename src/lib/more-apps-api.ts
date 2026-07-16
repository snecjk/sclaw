/**
 * More Apps registry host-api client
 */
import { hostApiFetch } from '@/lib/host-api';
import type { MoreAppsRegistry } from '../../shared/more-apps-registry';
import { createEmptyMoreAppsRegistry } from '../../shared/more-apps-registry';

export type { MoreAppsRegistry };

export async function fetchMoreAppsRegistry(): Promise<MoreAppsRegistry> {
  try {
    return await hostApiFetch<MoreAppsRegistry>('/api/more-apps');
  } catch (error) {
    console.error('[more-apps-api] fetch failed', error);
    return createEmptyMoreAppsRegistry();
  }
}

export async function saveMoreAppsRegistry(registry: MoreAppsRegistry): Promise<MoreAppsRegistry> {
  const result = await hostApiFetch<{ success: boolean; registry?: MoreAppsRegistry; error?: string }>(
    '/api/more-apps',
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(registry),
    },
  );
  if (!result.success || !result.registry) {
    throw new Error(result.error || 'Failed to save more-apps registry');
  }
  return result.registry;
}

export async function migrateMoreAppsRegistry(
  payload: MoreAppsRegistry,
): Promise<{ migrated: boolean; registry: MoreAppsRegistry }> {
  const result = await hostApiFetch<{
    success: boolean;
    migrated?: boolean;
    registry?: MoreAppsRegistry;
    error?: string;
  }>('/api/more-apps/migrate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!result.success || !result.registry) {
    throw new Error(result.error || 'Failed to migrate more-apps registry');
  }
  return {
    migrated: result.migrated === true,
    registry: result.registry,
  };
}
