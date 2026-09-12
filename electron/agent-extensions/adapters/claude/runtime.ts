import {
  SclawExtensionStateManager,
  type SclawExtensionLogger,
} from '../../../../shared/agent-extensions';
import { logger } from '../../../utils/logger';
import { createHostApiAgentExtensionCapabilities } from '../../host-api-capabilities';

export const claudeAgentExtensionCapabilities = createHostApiAgentExtensionCapabilities();
export const claudeAgentExtensionState = new SclawExtensionStateManager();

export const claudeAgentExtensionLogger: SclawExtensionLogger = {
  debug: (message, details) => logger.debug(message, details),
  info: (message, details) => logger.info(message, details),
  warn: (message, details) => logger.warn(message, details),
  error: (message, details) => logger.error(message, details),
};
