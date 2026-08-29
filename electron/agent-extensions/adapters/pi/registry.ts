import { SCLAW_AGENT_EXTENSIONS, type RegisteredAgentExtension } from '../../registry';
import { buildClawScheduledPathGuard } from '../../extensions/claw-scheduled-path-guard/pi';

export const PI_AGENT_EXTENSIONS: readonly RegisteredAgentExtension[] = SCLAW_AGENT_EXTENSIONS.map(
  (entry) => entry.common.id === 'claw-scheduled-path-guard'
    ? {
        ...entry,
        native: {
          pi: {
            mode: 'replace',
            build: buildClawScheduledPathGuard,
          },
        },
      }
    : entry,
);
