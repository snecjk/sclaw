/**
 * Claude PreToolUse: block connector-gated binaries unless connected (parity with Gateway preload).
 */
import type {
  HookCallback,
  HookCallbackMatcher,
  HookEvent,
  HookJSONOutput,
  PreToolUseHookInput,
} from '@anthropic-ai/claude-agent-sdk';

import { evaluateConnectorBashCommand } from '../../shared/connectors/bash-gate';
import {
  getCatalogGatedBinaries,
  getDenyArgsForBinary,
  getGatewayAllowlist,
  isBinaryAllowedByConnectors,
} from './gateway-allowlist';

function isPreToolUse(input: { hook_event_name?: string }): input is PreToolUseHookInput {
  return input.hook_event_name === 'PreToolUse';
}

function allow(): HookJSONOutput {
  return {};
}

function deny(reason: string): HookJSONOutput {
  return {
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: reason,
    },
  };
}

function evaluateBashCommand(command: string): HookJSONOutput | null {
  const decision = evaluateConnectorBashCommand(command, getGatewayAllowlist(), {
    gatedBinaries: getCatalogGatedBinaries(),
  });
  if (decision.blocked) {
    return deny(decision.reason);
  }
  return null;
}

export function createConnectorBashGateHook(): HookCallback {
  return async (input): Promise<HookJSONOutput> => {
    if (!isPreToolUse(input)) return allow();
    if (input.tool_name !== 'Bash') return allow();
    const toolInput = input.tool_input;
    const command = typeof toolInput === 'object' && toolInput && 'command' in toolInput
      ? String((toolInput as { command?: unknown }).command ?? '')
      : '';
    const blocked = evaluateBashCommand(command);
    return blocked ?? allow();
  };
}

export function buildConnectorBashGateHooks(): Partial<Record<HookEvent, HookCallbackMatcher[]>> {
  return {
    PreToolUse: [
      {
        matcher: 'Bash',
        hooks: [createConnectorBashGateHook()],
      },
    ],
  };
}

// Re-export for tests that assert allowlist wiring.
export { getDenyArgsForBinary, isBinaryAllowedByConnectors };
