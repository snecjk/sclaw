import { basicCatalog } from '@a2ui/react/v0_9';
import { ANTD_CATALOG_ID, antdCatalog } from '../catalog/antd-catalog';
import type { A2uiMessage } from './action-executor';

/** Allow pages to use short catalog tokens instead of full catalog URLs. */
export function resolveCatalogIds(messages: A2uiMessage[]): A2uiMessage[] {
  return messages.map((message) => {
    const createSurface = message.createSurface;
    if (!createSurface || typeof createSurface !== 'object') return message;
    const surface = { ...(createSurface as Record<string, unknown>) };
    if (surface.catalogId === 'basic') {
      surface.catalogId = basicCatalog.id;
    }
    if (surface.catalogId === 'antd' || surface.catalogId === 'sto') {
      surface.catalogId = ANTD_CATALOG_ID;
    }
    return { ...message, createSurface: surface };
  });
}

export function getHostCatalogs() {
  return [basicCatalog, antdCatalog];
}

/**
 * AG-UI transport is intentionally deferred.
 * Keep a stable sink so Local Action Runtime and a future AG-UI client share one action entrypoint.
 */
export type ActionTransport = {
  kind: 'local' | 'ag-ui';
  publishAction: (action: unknown) => void | Promise<void>;
};

export function createLocalActionTransport(
  handler: (action: unknown) => void | Promise<void>,
): ActionTransport {
  return {
    kind: 'local',
    publishAction: handler,
  };
}
