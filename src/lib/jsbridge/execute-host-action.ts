import { toast } from 'sonner';
import type { BridgeRequest, BridgeResponse } from '../../../shared/jsbridge/protocol';
import { JSBRIDGE_PROTOCOL, JSBRIDGE_VERSION } from '../../../shared/jsbridge/protocol';
import {
  isJsBridgeHostActionEnvelope,
  type JsBridgeHostAction,
} from '../../../shared/jsbridge/host-actions';
import { appNavigate } from '@/lib/app-navigate';
import { openInSclawBrowser } from '@/lib/open-sclaw-browser';
import { dispatchChatSend } from '@/hooks/dispatch-chat-send';
import { useAppPlazaShellStore } from '@/stores/app-plaza-shell';
import { useMoreAppsStore } from '@/stores/more-apps';
import { useJsBridgeHostStore } from '@/stores/jsbridge-host';
import { useChatStore } from '@/stores/chat';
import { useComposerFlowStore } from '@/stores/composer-flow';
import { openFlowCardPreview } from '@/lib/flow-card-preview';
import { resolveComposerFillSegments, type ResolvedComposerFill } from '@/lib/jsbridge/resolve-composer-fill-segments';
import type { BridgeComposerFillSegment } from '../../../shared/jsbridge/composer-fill-segments';
import type { PersistedComposerSegment } from '@/lib/dingtalk-mention-composer';

function okResponse(request: BridgeRequest, data: unknown): BridgeResponse {
  return {
    protocol: JSBRIDGE_PROTOCOL,
    version: JSBRIDGE_VERSION,
    type: 'response',
    id: request.id,
    ok: true,
    data,
  };
}

function resolveEmbedTab(runtimeId?: string | null) {
  const shell = useAppPlazaShellStore.getState();
  if (runtimeId) {
    return shell.browserTabs.find((tab) => tab.embedRuntimeId === runtimeId) ?? null;
  }
  const active = shell.browserTabs.find((tab) => tab.id === shell.activeTabId);
  return active?.status === 'live' ? active : null;
}

async function ensureEmbedChatReady(tabId: string, createNew = false): Promise<string | null> {
  const shell = useAppPlazaShellStore.getState();
  const tab = shell.browserTabs.find((entry) => entry.id === tabId);
  if (!tab?.embedRuntimeId) return null;

  if (createNew) {
    shell.createChatSession(tabId);
  } else if (!tab.chatSessionKey || !tab.chatPanelOpen) {
    shell.openChatPanel(tabId);
  } else {
    // Panel already open: re-bind chat store to this tab's right-side session.
    shell.ensureEmbedChatActive(tabId);
  }

  const next = useAppPlazaShellStore.getState().browserTabs.find((entry) => entry.id === tabId);
  return next?.chatSessionKey ?? null;
}

function resolveHostComposerFill(input: {
  text: string;
  segments?: BridgeComposerFillSegment[];
}): ResolvedComposerFill {
  if (input.segments?.length) {
    return resolveComposerFillSegments(input.segments);
  }
  const text = input.text.trim();
  if (!text) {
    return { segments: [], plainText: '', skillMetas: [], workflows: [] };
  }
  return {
    segments: [{ type: 'text', text }],
    plainText: text,
    skillMetas: [],
    workflows: [],
  };
}

async function sendToSession(
  sessionKey: string,
  input: {
    text: string;
    segments?: PersistedComposerSegment[];
    skillMetas?: import('@/types/skill-meta').SkillMeta[];
    workflows?: Array<{ id: string; name: string; source?: string }>;
  },
): Promise<void> {
  const chat = useChatStore.getState();
  if (chat.currentSessionKey !== sessionKey) {
    chat.switchSession(sessionKey);
  }
  await dispatchChatSend({
    text: input.text,
    composerSegments: input.segments,
    skillMetas: input.skillMetas,
    workflows: input.workflows,
  });
}

async function fillEmbedComposer(input: {
  runtimeId?: string | null;
  resolved: ResolvedComposerFill;
  send?: boolean;
  openPanel?: boolean;
  createSession?: boolean;
}): Promise<{ sessionKey: string | null; seedToken: string | null }> {
  const tab = resolveEmbedTab(input.runtimeId);
  if (!tab?.embedRuntimeId) {
    throw new Error('No active App Plaza browser tab for embed chat');
  }

  if (input.openPanel !== false) {
    useAppPlazaShellStore.getState().openChatPanel(tab.id);
  }

  const sessionKey = await ensureEmbedChatReady(tab.id, input.createSession === true);
  const seedToken = useJsBridgeHostStore.getState().setEmbedComposerSeed(
    tab.embedRuntimeId,
    {
      text: input.resolved.plainText,
      segments: input.resolved.segments,
    },
  );

  if (input.send && sessionKey) {
    await sendToSession(sessionKey, {
      text: input.resolved.plainText,
      segments: input.resolved.segments,
      skillMetas: input.resolved.skillMetas,
      workflows: input.resolved.workflows,
    });
  }

  return { sessionKey, seedToken };
}

async function fillMainComposer(input: {
  resolved: ResolvedComposerFill;
  send?: boolean;
  newSession?: boolean;
  title?: string;
}): Promise<{ sessionKey: string | null }> {
  appNavigate('/');

  const chat = useChatStore.getState();
  if (input.newSession !== false) {
    chat.newSession();
  }

  const sessionKey = useChatStore.getState().currentSessionKey;
  const trimmedTitle = input.title?.trim();
  if (trimmedTitle) {
    useChatStore.getState().renameSession(sessionKey, trimmedTitle);
  }

  if (input.send) {
    await sendToSession(sessionKey, {
      text: input.resolved.plainText,
      segments: input.resolved.segments,
      skillMetas: input.resolved.skillMetas,
      workflows: input.resolved.workflows,
    });
    return { sessionKey };
  }

  useJsBridgeHostStore.getState().setMainComposerSeed({
    text: input.resolved.plainText,
    segments: input.resolved.segments,
  });
  return { sessionKey };
}

function resolveChatTarget(
  target: 'embed' | 'main' | 'auto',
  runtimeId?: string | null,
): 'embed' | 'main' {
  if (target === 'embed') return 'embed';
  if (target === 'main') return 'main';
  return runtimeId ? 'embed' : 'main';
}

function findCatalogApp(appId: string) {
  const store = useMoreAppsStore.getState();
  return store.catalogApps.find((app) => app.id === appId)
    ?? store.externalApps.find((app) => app.id === appId)
    ?? null;
}

export async function executeJsBridgeHostAction(
  action: JsBridgeHostAction,
  request: BridgeRequest,
): Promise<BridgeResponse> {
  switch (action.type) {
    case 'ui.alert': {
      await useJsBridgeHostStore.getState().showAlert({
        title: action.title,
        message: action.message,
        confirmLabel: action.confirmLabel,
      });
      return okResponse(request, { ok: true });
    }
    case 'ui.confirm': {
      const confirmed = await useJsBridgeHostStore.getState().showConfirm({
        title: action.title,
        message: action.message,
        confirmLabel: action.confirmLabel,
        cancelLabel: action.cancelLabel,
        destructive: action.destructive,
      });
      return okResponse(request, { confirmed });
    }
    case 'ui.openDrawer': {
      const targetTab = resolveEmbedTab(action.runtimeId);
      if (targetTab) {
        const shell = useAppPlazaShellStore.getState();
        if (targetTab.chatPanelOpen) {
          shell.ensureEmbedChatActive(targetTab.id);
        } else {
          shell.openChatPanel(targetTab.id);
        }
      } else {
        toast.message('请先打开应用广场浏览器标签页');
      }
      return okResponse(request, { ok: true });
    }
    case 'chat.fillComposer': {
      const resolved = resolveHostComposerFill({
        text: action.text,
        segments: action.segments,
      });
      const target = resolveChatTarget(action.target, action.runtimeId);
      if (target === 'embed') {
        const result = await fillEmbedComposer({
          runtimeId: action.runtimeId,
          resolved,
          send: action.send,
          openPanel: action.openPanel,
        });
        return okResponse(request, { target: 'embed', ...result });
      }
      const result = await fillMainComposer({
        resolved,
        send: action.send,
        newSession: false,
      });
      return okResponse(request, { target: 'main', ...result });
    }
    case 'chat.openSession': {
      if (action.target === 'main') {
        const resolved = resolveHostComposerFill({
          text: action.text ?? '',
        });
        const result = await fillMainComposer({
          resolved,
          send: action.send,
          newSession: true,
          title: action.title,
        });
        return okResponse(request, { target: 'main', ...result });
      }
      const resolved = resolveHostComposerFill({
        text: action.text ?? '',
      });
      const result = await fillEmbedComposer({
        runtimeId: action.runtimeId,
        resolved,
        send: action.send,
        openPanel: true,
        createSession: true,
      });
      return okResponse(request, { target: 'embed', ...result });
    }
    case 'nav.jump': {
      if (action.jumpType === 'app') {
        const app = findCatalogApp(action.appId ?? '');
        if (!app?.url) {
          return {
            protocol: JSBRIDGE_PROTOCOL,
            version: JSBRIDGE_VERSION,
            type: 'response',
            id: request.id,
            ok: false,
            error: { code: 'INVALID_PARAMS', message: `App not found: ${action.appId}` },
          };
        }
        openInSclawBrowser({
          url: app.url,
          title: action.title ?? app.name,
          appId: app.id,
          bound: app.installed ?? app.kind === 'builtin',
          iconUrl: app.iconUrl,
          iconKey: app.iconKey,
          tone: app.tone,
          systemCode: app.systemCode,
          skipLoginEligible: app.official ?? app.kind === 'builtin',
        });
        return okResponse(request, { type: 'app', appId: app.id, url: app.url });
      }
      if (action.jumpType === 'route') {
        appNavigate(action.route ?? '/');
        return okResponse(request, { type: 'route', route: action.route });
      }
      return okResponse(request, { ok: true, type: action.jumpType });
    }
    case 'composer.openFilePicker': {
      const requestId = useComposerFlowStore.getState().requestFilePicker({
        accept: action.accept,
        multiple: action.multiple,
      });
      return okResponse(request, { ok: true, requestId });
    }
    case 'nav.openPreviewTab': {
      const sessionKey = useChatStore.getState().currentSessionKey;
      openFlowCardPreview({
        url: action.url,
        title: action.title,
        mode: 'open',
        sessionKey,
      });
      return okResponse(request, { ok: true, url: action.url });
    }
    default:
      return {
        protocol: JSBRIDGE_PROTOCOL,
        version: JSBRIDGE_VERSION,
        type: 'response',
        id: request.id,
        ok: false,
        error: { code: 'INTERNAL_ERROR', message: 'Unsupported host action' },
      };
  }
}

export async function resolveJsBridgeResponse(
  request: BridgeRequest,
  response: BridgeResponse,
): Promise<BridgeResponse> {
  if (!response.ok || !isJsBridgeHostActionEnvelope(response.data)) {
    return response;
  }
  return executeJsBridgeHostAction(response.data.action, request);
}
