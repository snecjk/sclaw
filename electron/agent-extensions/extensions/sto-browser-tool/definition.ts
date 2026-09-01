import type { SclawAgentExtensionDefinition } from '../../../../shared/agent-extensions';
import { browserBridgeActivation } from './activation';
import { STO_BROWSER_BRIDGE_CAPABILITY } from './capability';
import { stoBrowserBridgeTools } from './operations';
import { browserBridgePrompt } from './prompts';

export const stoBrowserToolDefinition: SclawAgentExtensionDefinition = {
  id: 'sto-browser-tool',
  version: '1.0.0',
  engines: ['claude'],
  requiredCapabilities: [STO_BROWSER_BRIDGE_CAPABILITY],
  activations: [browserBridgeActivation],
  tools: stoBrowserBridgeTools,
  prompts: [browserBridgePrompt],
};
