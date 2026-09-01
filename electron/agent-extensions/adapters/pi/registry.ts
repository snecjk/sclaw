import { SCLAW_AGENT_EXTENSIONS, type RegisteredAgentExtension } from '../../registry';
import { buildClawScheduledPathGuard } from '../../extensions/claw-scheduled-path-guard/pi';
import { buildPiBrowserUseExtension } from '../../extensions/pi-browser-use/pi';
import type { PiNativeContribution } from './types';

const PI_NATIVE_CONTRIBUTIONS: Readonly<Record<string, PiNativeContribution>> = {
  'claw-scheduled-path-guard': {
    mode: 'replace',
    build: buildClawScheduledPathGuard,
  },
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
