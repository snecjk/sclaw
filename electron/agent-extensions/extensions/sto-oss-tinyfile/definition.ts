import type { SclawAgentExtensionDefinition } from '../../../../shared/agent-extensions';
import { STO_OSS_TINY_FILE_CAPABILITY } from './capability';
import { stoOssTinyFileTools } from './operations';

export const stoOssTinyFileDefinition: SclawAgentExtensionDefinition = {
  id: 'sto-oss-tinyfile',
  version: '1.0.0',
  engines: ['claude', 'pi'],
  requiredCapabilities: [STO_OSS_TINY_FILE_CAPABILITY],
  tools: stoOssTinyFileTools,
};
