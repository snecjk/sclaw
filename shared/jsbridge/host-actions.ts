/** Marker returned by Main handlers; Host renderer executes the action and responds to Guest. */

import type { BridgeComposerFillSegment } from './composer-fill-segments';

export const JSBRIDGE_HOST_ACTION_MARKER = '__stoclaw_host_action__' as const;

export type JsBridgeChatTarget = 'embed' | 'main' | 'auto';

export type JsBridgeNavJumpType = 'webview' | 'app' | 'route' | 'external';

export type JsBridgeHostAction =
  | { type: 'ui.alert'; title: string; message: string; confirmLabel?: string }
  | {
      type: 'ui.confirm';
      title: string;
      message: string;
      confirmLabel?: string;
      cancelLabel?: string;
      destructive?: boolean;
    }
  | { type: 'ui.openDrawer'; kind: 'chat'; runtimeId?: string | null }
  | {
      type: 'chat.fillComposer';
      text: string;
      segments?: BridgeComposerFillSegment[];
      target: JsBridgeChatTarget;
      send?: boolean;
      openPanel?: boolean;
      runtimeId?: string | null;
    }
  | {
      type: 'chat.openSession';
      target: 'embed' | 'main';
      text?: string;
      segments?: BridgeComposerFillSegment[];
      send?: boolean;
      title?: string;
      runtimeId?: string | null;
    }
  | {
      type: 'nav.jump';
      jumpType: JsBridgeNavJumpType;
      url?: string;
      appId?: string;
      route?: string;
      title?: string;
      bound?: boolean;
    }
  | {
      type: 'composer.openFilePicker';
      accept?: string;
      multiple?: boolean;
    }
  | {
      type: 'nav.openPreviewTab';
      url: string;
      title?: string;
    };

export interface JsBridgeHostActionEnvelope {
  [JSBRIDGE_HOST_ACTION_MARKER]: true;
  action: JsBridgeHostAction;
}

export function isJsBridgeHostActionEnvelope(value: unknown): value is JsBridgeHostActionEnvelope {
  if (!value || typeof value !== 'object') return false;
  return (value as Record<string, unknown>)[JSBRIDGE_HOST_ACTION_MARKER] === true
    && typeof (value as JsBridgeHostActionEnvelope).action === 'object';
}

export function createHostActionEnvelope(action: JsBridgeHostAction): JsBridgeHostActionEnvelope {
  return { [JSBRIDGE_HOST_ACTION_MARKER]: true, action };
}
