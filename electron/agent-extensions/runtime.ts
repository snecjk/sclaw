import { logger } from '../utils/logger';
import {
  SclawCapabilityRegistry,
  SclawExtensionStateManager,
  type SclawExtensionLogger,
} from '../../shared/agent-extensions';

export const sclawAgentExtensionCapabilities = new SclawCapabilityRegistry();
export const sclawAgentExtensionState = new SclawExtensionStateManager();

export const sclawAgentExtensionLogger: SclawExtensionLogger = {
  debug: (message, details) => logger.debug(message, details),
  info: (message, details) => logger.info(message, details),
  warn: (message, details) => logger.warn(message, details),
  error: (message, details) => logger.error(message, details),
};
