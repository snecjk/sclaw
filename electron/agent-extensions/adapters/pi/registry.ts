import { SCLAW_AGENT_EXTENSIONS, type RegisteredAgentExtension } from '../../registry';
import { isEmbedAppChatSessionKey } from '../../../../shared/session-type';
import { WEB_BRIDGE_ORDINARY_CHAT_ENABLED } from '../../../../shared/browser-bridge/ship-gate';
import { buildPiBrowserUseExtension } from '../../extensions/pi-browser-use/pi';
import {
  buildPiMemoryExtension,
  PI_MEMORY_TOOL_NAMES,
} from '../../extensions/pi-memory/pi';
import type { PiNativeContribution } from './types';

const PI_NATIVE_CONTRIBUTIONS: Readonly<Record<string, PiNativeContribution>> = {
  'pi-browser-use': {
    mode: 'replace',
    build: buildPiBrowserUseExtension,
  },
  'pi-memory': {
    mode: 'replace',
    claims: { tools: PI_MEMORY_TOOL_NAMES },
    build: buildPiMemoryExtension,
  },
};

export const PI_AGENT_EXTENSIONS: readonly RegisteredAgentExtension[] = SCLAW_AGENT_EXTENSIONS.map(
  (entry) => {
    const contribution = PI_NATIVE_CONTRIBUTIONS[entry.common.id];
    if (!contribution) return entry;
    return {
      ...entry,
      native: {
        ...entry.native,
        pi: contribution,
      },
    };
  },
);

/**
 * Select exactly one browser implementation for each Pi chat surface.
 * Web Bridge 主聊天未完成：普通会话仍走 pi-browser-use（与 main 一致）。
 */
export function selectPiAgentExtensions(
  sessionKey: string,
  entries: readonly RegisteredAgentExtension[] = PI_AGENT_EXTENSIONS,
): readonly RegisteredAgentExtension[] {
  // TODO(web-bridge): WEB_BRIDGE_ORDINARY_CHAT_ENABLED = true 后，普通 Pi 也只用 bridge_*。
  if (WEB_BRIDGE_ORDINARY_CHAT_ENABLED) {
    return entries.filter((entry) => entry.common.id !== 'pi-browser-use');
  }
  const embedChat = isEmbedAppChatSessionKey(sessionKey);
  return entries.filter((entry) => (
    embedChat
      ? entry.common.id !== 'pi-browser-use'
      : entry.common.id !== 'sto-browser-tool'
  ));
}
