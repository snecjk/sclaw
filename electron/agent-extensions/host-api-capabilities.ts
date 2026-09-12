import { SclawCapabilityRegistry } from '../../shared/agent-extensions';
import { STO_BROWSER_BRIDGE_CAPABILITY } from './extensions/sto-browser-tool/capability';
import { createHostApiBrowserBridgePort } from './extensions/sto-browser-tool/host-api-capability';
import { STO_SCHEDULED_TASK_CAPABILITY } from './extensions/sto-scheduled-task-tool/capability';
import { createHostApiScheduledTaskPort } from './extensions/sto-scheduled-task-tool/host-api-capability';
import { STO_WORKFLOW_CAPABILITY } from './extensions/sto-workflow-tool/capability';
import { createHostApiWorkflowPort } from './extensions/sto-workflow-tool/host-api-capability';
import { STO_DINGTALK_SEND_GUARD_CAPABILITY } from './extensions/sto-dingtalk-send-guard/capability';
import { createHostApiDingTalkSendGuardPort } from './extensions/sto-dingtalk-send-guard/host-api-capability';
import { STO_SKILL_RUNTIME_CAPABILITY } from './extensions/sto-skill-runtime/capability';
import { createHostApiSkillRuntimePort } from './extensions/sto-skill-runtime/host-api-capability';
import { STO_OSS_TINY_FILE_CAPABILITY } from './extensions/sto-oss-tinyfile/capability';
import { createHostApiOssTinyFilePort } from './extensions/sto-oss-tinyfile/host-api-capability';

/** Create process-local ports backed by the Electron Main Host API. */
export function createHostApiAgentExtensionCapabilities(): SclawCapabilityRegistry {
  return new SclawCapabilityRegistry()
    .provide(STO_BROWSER_BRIDGE_CAPABILITY, createHostApiBrowserBridgePort())
    .provide(STO_SCHEDULED_TASK_CAPABILITY, createHostApiScheduledTaskPort())
    .provide(STO_WORKFLOW_CAPABILITY, createHostApiWorkflowPort())
    .provide(STO_DINGTALK_SEND_GUARD_CAPABILITY, createHostApiDingTalkSendGuardPort())
    .provide(STO_SKILL_RUNTIME_CAPABILITY, createHostApiSkillRuntimePort())
    .provide(STO_OSS_TINY_FILE_CAPABILITY, createHostApiOssTinyFilePort());
}
