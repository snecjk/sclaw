import { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Spin } from 'antd';
import { useNavigate } from 'react-router-dom';
import { MessageProcessor, type Catalog, type SurfaceModel } from '@a2ui/web_core/v0_9';
import { A2uiSurface, type ReactComponentImplementation } from '@a2ui/react/v0_9';

import actionRegistryJson from '../../contracts/action-registry.v1.json';
import {
  executeAction,
  type ActionRegistry,
  type HostActionPayload,
} from '../runtime/action-executor';
import { getHostCatalogs, resolveCatalogIds } from '../runtime/catalog';
import { isPageId, loadPageMessages, routePathForPageId, type PageId } from '../runtime/page-registry';

const actionRegistry = actionRegistryJson as ActionRegistry;

type HostProcessor = MessageProcessor<ReactComponentImplementation>;
type HostSurface = SurfaceModel<ReactComponentImplementation>;

function pickPayload(raw: unknown): HostActionPayload {
  if (!raw || typeof raw !== 'object') return { name: '' };
  const obj = raw as Record<string, unknown>;
  const inner = obj.action && typeof obj.action === 'object' ? (obj.action as Record<string, unknown>) : obj;
  return {
    name: typeof inner.name === 'string' ? inner.name : '',
    surfaceId: typeof inner.surfaceId === 'string' ? inner.surfaceId : undefined,
    sourceComponentId: typeof inner.sourceComponentId === 'string' ? inner.sourceComponentId : undefined,
    context: inner.context && typeof inner.context === 'object' ? inner.context as Record<string, unknown> : {},
  };
}

export function A2uiPageHost({ pageId }: { pageId: PageId }) {
  const navigate = useNavigate();
  const navigateRef = useRef(navigate);
  navigateRef.current = navigate;

  const [bootError, setBootError] = useState<string | null>(null);
  const [surfaces, setSurfaces] = useState<HostSurface[]>([]);

  const processor = useMemo(() => {
    try {
      const messages = resolveCatalogIds(loadPageMessages(pageId));
      const next = new MessageProcessor(
        getHostCatalogs() as Catalog<ReactComponentImplementation>[],
        async (rawAction) => {
          const payload = pickPayload(rawAction);
          const actionId = payload.name.trim();
          if (actionId === 'app.navigate') {
            const target = payload.context?.pageId;
            if (typeof target === 'string' && target.trim()) {
              const raw = target.trim();
              const path = isPageId(raw) ? routePathForPageId(raw) : raw;
              navigateRef.current(`/${path}`);
            }
            return;
          }
          await executeAction(actionRegistry, rawAction);
        },
      );
      next.processMessages(messages as unknown as Parameters<HostProcessor['processMessages']>[0]);
      return { processor: next, error: null as string | null };
    } catch (err) {
      return {
        processor: null as HostProcessor | null,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }, [pageId]);

  useEffect(() => {
    setBootError(processor.error);
    const active = processor.processor;
    if (!active) {
      setSurfaces([]);
      return;
    }
    const sync = () => setSurfaces(Array.from(active.model.surfacesMap.values()));
    sync();
    const createdSub = active.onSurfaceCreated(sync);
    const deletedSub = active.onSurfaceDeleted(sync);
    return () => {
      createdSub.unsubscribe();
      deletedSub.unsubscribe();
      setSurfaces([]);
    };
  }, [processor]);

  if (bootError) {
    return (
      <Alert type="error" showIcon message="A2UI 页面加载失败" description={bootError} />
    );
  }

  if (!processor.processor || surfaces.length === 0) {
    return (
      <div style={{ padding: 48, textAlign: 'center' }}>
        <Spin tip="正在加载页面..." />
      </div>
    );
  }

  return (
    <div className="a2ui-page-host" data-a2ui-page-id={pageId} style={{ width: '100%' }}>
      {surfaces.map((surface) => (
        <div key={surface.id} data-a2ui-surface-id={surface.id}>
          <A2uiSurface surface={surface} />
        </div>
      ))}
    </div>
  );
}
