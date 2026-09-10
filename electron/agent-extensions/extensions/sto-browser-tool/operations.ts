import { Type, type Static, type TObject } from 'typebox';
import {
  sclawToolFailure,
  type SclawToolDefinition,
  type SclawToolOutcome,
} from '../../../../shared/agent-extensions';
import { isEmbedAppChatSessionKey } from '../../../../shared/session-type';
import { attachSuccessfulActProgress } from '../../../../shared/browser-bridge/act-progress';
import {
  formatBridgeSessionList,
  normalizeBridgeSessionId,
} from '../../../../shared/browser-bridge/pick-session';
import { WEB_BRIDGE_ORDINARY_CHAT_ENABLED } from '../../../../shared/browser-bridge/ship-gate';
import { STO_BROWSER_BRIDGE_ACTIVATION } from './activation';
import {
  STO_BROWSER_BRIDGE_CAPABILITY,
  StoBrowserBridgePortError,
  type BrowserBridgeAction,
  type BrowserBridgeSession,
  type StoBrowserBridgePort,
} from './capability';

function tool<T extends TObject>(definition: SclawToolDefinition<T>): SclawToolDefinition<T> {
  return { ...definition, activation: STO_BROWSER_BRIDGE_ACTIVATION };
}

const sessionId = Type.Optional(Type.String({
  minLength: 1,
  description: 'Bridge 会话 ID。内嵌预览必须传 embed-<runtimeId>。',
}));

const sessionSchema = Type.Object({ sessionId });
const clickSchema = Type.Object({
  sessionId,
  ref: Type.Optional(Type.String({ minLength: 1, description: '元素 ref，如 @e5' })),
  name: Type.Optional(Type.String({ minLength: 1, description: '可见文案，如「客户管理」' })),
});
const fillSchema = Type.Object({
  sessionId,
  ref: Type.Optional(Type.String({ minLength: 1, description: '元素 ref，如 @e3' })),
  name: Type.Optional(Type.String({ minLength: 1, description: '字段文案或 placeholder' })),
  value: Type.String({ description: '要填写的内容' }),
});
const navigateSchema = Type.Object({
  sessionId,
  url: Type.String({ minLength: 1, description: '目标 URL' }),
});
const emptySchema = Type.Object({});

function isEmbedSession(session: BrowserBridgeSession): boolean {
  return session.source === 'embed' || session.tabId < 0 || session.sessionId.startsWith('embed-');
}

async function resolveSessionId(
  port: StoBrowserBridgePort,
  requestedSessionId: string | undefined,
  context: Parameters<SclawToolDefinition['execute']>[1],
): Promise<string> {
  const requested = normalizeBridgeSessionId(requestedSessionId);
  const embedChat = isEmbedAppChatSessionKey(context.sessionKey);
  if (requested) {
    if (embedChat && !requested.startsWith('embed-')) {
      throw new StoBrowserBridgePortError(
        'EMBED_SESSION_ID_INVALID',
        '应用广场内嵌会话必须使用用户消息上下文中的 embed-<runtimeId> sessionId',
      );
    }
    return requested;
  }
  if (embedChat) {
    throw new StoBrowserBridgePortError(
      'EMBED_SESSION_ID_REQUIRED',
      '应用广场内嵌会话必须显式传入用户消息上下文中的 bridgeSessionId',
    );
  }

  const sessions = await port.listSessions(context.signal);
  const external = sessions.find((item) => !isEmbedSession(item));
  if (external) return external.sessionId;
  // TODO(web-bridge): WEB_BRIDGE_ORDINARY_CHAT_ENABLED = true 后自动 ensure-session 接管本机 Chrome。
  if (WEB_BRIDGE_ORDINARY_CHAT_ENABLED) {
    return port.ensureSession(context.signal);
  }
  throw new StoBrowserBridgePortError(
    'BROWSER_NOT_CONNECTED',
    '未找到已连接的外部 Browser Bridge 会话。请安装浏览器扩展并完成配对，或显式传入 sessionId。',
  );
}

async function runBridgeTool(
  action: BrowserBridgeAction,
  input: { sessionId?: string },
  payload: Record<string, unknown>,
  context: Parameters<SclawToolDefinition['execute']>[1],
): Promise<SclawToolOutcome> {
  try {
    const port = context.capabilities.require(STO_BROWSER_BRIDGE_CAPABILITY);
    const resolvedSessionId = await resolveSessionId(port, input.sessionId, context);
    const data = await port.runCommand({
      sessionId: resolvedSessionId,
      action,
      payload,
      signal: context.signal,
    });
    const progressed = await attachSuccessfulActProgress({
      action,
      payload,
      result: data,
      snapshot: () => port.runCommand({
        sessionId: resolvedSessionId,
        action: 'snapshot',
        payload: {},
        signal: context.signal,
      }),
    });
    return {
      success: true,
      type: `browser_bridge_${action}_completed`,
      domain: 'browser-bridge',
      data: progressed,
    };
  } catch (error) {
    return sclawToolFailure(
      'browser-bridge',
      error instanceof StoBrowserBridgePortError ? error.code : 'BROWSER_BRIDGE_ERROR',
      error instanceof Error ? error.message : String(error),
    );
  }
}

export const stoBrowserBridgeTools = [
  tool({
    name: 'bridge_snapshot',
    label: '获取浏览器页面结构',
    description: '获取当前 Browser Bridge 页面可交互元素树（含 @e ref）。',
    parameters: sessionSchema,
    execute(input: Static<typeof sessionSchema>, context) {
      return runBridgeTool('snapshot', input, {}, context);
    },
  }),
  tool({
    name: 'bridge_click',
    label: '点击浏览器元素',
    description: '按 ref 或可见文案点击 Browser Bridge 页面元素。',
    parameters: clickSchema,
    execute(input: Static<typeof clickSchema>, context) {
      if (!input.ref?.trim() && !input.name?.trim()) {
        return Promise.resolve(sclawToolFailure(
          'browser-bridge',
          'BROWSER_TARGET_REQUIRED',
          'bridge_click 必须提供 ref 或 name',
        ));
      }
      return runBridgeTool('click', input, {
        ...(input.ref?.trim() ? { ref: input.ref.trim() } : {}),
        ...(input.name?.trim() ? { name: input.name.trim() } : {}),
      }, context);
    },
  }),
  tool({
    name: 'bridge_fill',
    label: '填写浏览器输入框',
    description: '按 ref、字段文案或 placeholder 定位输入框并填写内容。',
    parameters: fillSchema,
    execute(input: Static<typeof fillSchema>, context) {
      if (!input.ref?.trim() && !input.name?.trim()) {
        return Promise.resolve(sclawToolFailure(
          'browser-bridge',
          'BROWSER_TARGET_REQUIRED',
          'bridge_fill 必须提供 ref 或 name',
        ));
      }
      return runBridgeTool('fill', input, {
        value: input.value,
        ...(input.ref?.trim() ? { ref: input.ref.trim() } : {}),
        ...(input.name?.trim() ? { name: input.name.trim() } : {}),
      }, context);
    },
  }),
  tool({
    name: 'bridge_navigate',
    label: '浏览器页面导航',
    description: '在当前 Browser Bridge 会话中导航到指定 URL。',
    parameters: navigateSchema,
    execute(input: Static<typeof navigateSchema>, context) {
      return runBridgeTool('navigate', input, { url: input.url }, context);
    },
  }),
  tool({
    name: 'bridge_screenshot',
    label: '浏览器页面截图',
    description: '截取当前 Browser Bridge 会话页面的可见区域。',
    parameters: sessionSchema,
    execute(input: Static<typeof sessionSchema>, context) {
      return runBridgeTool('screenshot', input, {}, context);
    },
  }),
  tool({
    name: 'bridge_list_sessions',
    label: '列出浏览器桥接会话',
    description: '检查内嵌 WebView 或 Chrome Browser Bridge 是否已连接。',
    parameters: emptySchema,
    async execute(_input: Static<typeof emptySchema>, context) {
      try {
        const sessions = await context.capabilities
          .require(STO_BROWSER_BRIDGE_CAPABILITY)
          .listSessions(context.signal);
        return {
          success: true,
          type: 'browser_bridge_sessions_listed',
          domain: 'browser-bridge',
          data: formatBridgeSessionList(sessions),
        };
      } catch (error) {
        return sclawToolFailure(
          'browser-bridge',
          error instanceof StoBrowserBridgePortError ? error.code : 'BROWSER_BRIDGE_ERROR',
          error instanceof Error ? error.message : String(error),
        );
      }
    },
  }),
];
