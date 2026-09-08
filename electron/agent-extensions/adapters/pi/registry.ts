import { SCLAW_AGENT_EXTENSIONS, type RegisteredAgentExtension } from '../../registry';
import { buildPiBrowserUseExtension } from '../../extensions/pi-browser-use/pi';
import type { PiNativeContribution } from './types';

const PI_NATIVE_CONTRIBUTIONS: Readonly<Record<string, PiNativeContribution>> = {
  'pi-browser-use': {
    mode: 'replace',
    build: buildPiBrowserUseExtension,
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

/** Interactive Pi chats drive the user's Chrome (or App Plaza webview) via bridge_*. */
export function selectPiAgentExtensions(
  _sessionKey: string,
  entries: readonly RegisteredAgentExtension[] = PI_AGENT_EXTENSIONS,
): readonly RegisteredAgentExtension[] {
  return entries.filter((entry) => entry.common.id !== 'pi-browser-use');
}
