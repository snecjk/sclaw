import { logger } from '../utils/logger';
import {
  SclawCapabilityRegistry,
  SclawExtensionStateManager,
  type SclawExtensionLogger,
} from '../../shared/agent-extensions';
import { STO_SCHEDULED_TASK_CAPABILITY } from './extensions/sto-scheduled-task-tool/capability';
import { createHostApiScheduledTaskPort } from './extensions/sto-scheduled-task-tool/host-api-capability';

export const sclawAgentExtensionCapabilities = new SclawCapabilityRegistry()
  .provide(STO_SCHEDULED_TASK_CAPABILITY, createHostApiScheduledTaskPort());
export const sclawAgentExtensionState = new SclawExtensionStateManager();

export const sclawAgentExtensionLogger: SclawExtensionLogger = {
  debug: (message, details) => logger.debug(message, details),
  info: (message, details) => logger.info(message, details),
  warn: (message, details) => logger.warn(message, details),
  error: (message, details) => logger.error(message, details),
};
