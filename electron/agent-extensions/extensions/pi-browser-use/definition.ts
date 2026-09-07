import type { SclawAgentExtensionDefinition } from '../../../../shared/agent-extensions';

/** Engine-native managed Chrome automation for Pi sessions. */
export const piBrowserUseDefinition: SclawAgentExtensionDefinition = {
  id: 'pi-browser-use',
  version: '0.1.12',
  engines: ['pi'],
  modes: ['interactive'],
};
