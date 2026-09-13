import type { SclawAgentExtensionDefinition } from '../../../../shared/agent-extensions';

/** Reviewed local Markdown memory for interactive Pi sessions. */
export const piMemoryDefinition: SclawAgentExtensionDefinition = {
  id: 'pi-memory',
  version: '0.4.2',
  engines: ['pi'],
  modes: ['interactive'],
};
