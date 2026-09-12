import { describe, expect, it } from 'vitest';
import { createHostApiAgentExtensionCapabilities } from '../../electron/agent-extensions/host-api-capabilities';
import { STO_BROWSER_BRIDGE_CAPABILITY } from '../../electron/agent-extensions/extensions/sto-browser-tool/capability';
import { STO_DINGTALK_SEND_GUARD_CAPABILITY } from '../../electron/agent-extensions/extensions/sto-dingtalk-send-guard/capability';
import { STO_OSS_TINY_FILE_CAPABILITY } from '../../electron/agent-extensions/extensions/sto-oss-tinyfile/capability';
import { STO_SCHEDULED_TASK_CAPABILITY } from '../../electron/agent-extensions/extensions/sto-scheduled-task-tool/capability';
import { STO_SKILL_RUNTIME_CAPABILITY } from '../../electron/agent-extensions/extensions/sto-skill-runtime/capability';
import { STO_WORKFLOW_CAPABILITY } from '../../electron/agent-extensions/extensions/sto-workflow-tool/capability';

describe('Agent extension Host API capability factory', () => {
  it('provides every common Host API capability in each process-local registry', () => {
    const first = createHostApiAgentExtensionCapabilities();
    const second = createHostApiAgentExtensionCapabilities();
    const tokens = [
      STO_BROWSER_BRIDGE_CAPABILITY,
      STO_SCHEDULED_TASK_CAPABILITY,
      STO_WORKFLOW_CAPABILITY,
      STO_DINGTALK_SEND_GUARD_CAPABILITY,
      STO_SKILL_RUNTIME_CAPABILITY,
      STO_OSS_TINY_FILE_CAPABILITY,
    ];

    expect(second).not.toBe(first);
    for (const token of tokens) {
      expect(first.has(token), token.id).toBe(true);
      expect(second.has(token), token.id).toBe(true);
    }
  });
});
