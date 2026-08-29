import {
  supportsEngine,
  type SclawAgentEngine,
  type SclawAgentExtensionDefinition,
  type SclawExtensionDiagnostic,
} from '../../shared/agent-extensions';
import type { ClaudeNativeContribution } from './adapters/claude/types';
import type { PiNativeContribution } from './adapters/pi/types';
import { clawScheduledPathGuardDefinition } from './extensions/claw-scheduled-path-guard/definition';
import { stoScheduledTaskToolDefinition } from './extensions/sto-scheduled-task-tool/definition';

export interface RegisteredAgentExtension {
  common: SclawAgentExtensionDefinition;
  native?: {
    claude?: ClaudeNativeContribution;
    pi?: PiNativeContribution;
  };
}

/** Internal, compile-time allowlist. Entries are reviewed and bundled with SClaw. */
export const SCLAW_AGENT_EXTENSIONS: readonly RegisteredAgentExtension[] = [{
  common: clawScheduledPathGuardDefinition,
}, {
  common: stoScheduledTaskToolDefinition,
}];

const EXTENSION_ID_PATTERN = /^[a-z][a-z0-9-]{0,127}$/;
const RESOURCE_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/;

export function isValidAgentExtensionId(value: string): boolean {
  return EXTENSION_ID_PATTERN.test(value);
}

export function isValidAgentExtensionResourceName(value: string): boolean {
  return RESOURCE_NAME_PATTERN.test(value);
}

export function validateAgentExtensionRegistry(
  entries: readonly RegisteredAgentExtension[],
): SclawExtensionDiagnostic[] {
  const diagnostics: SclawExtensionDiagnostic[] = [];
  const extensionIds = new Set<string>();
  const toolOwners: Record<SclawAgentEngine, Map<string, string>> = {
    claude: new Map(),
    pi: new Map(),
  };
  const claudeMcpOwners = new Map<string, string>();

  for (const entry of entries) {
    const { common } = entry;
    if (!isValidAgentExtensionId(common.id)) {
      diagnostics.push({
        extensionId: common.id,
        code: 'INVALID_EXTENSION_ID',
        message: `Invalid extension id: ${common.id}`,
      });
    }
    if (extensionIds.has(common.id)) {
      diagnostics.push({
        extensionId: common.id,
        code: 'DUPLICATE_EXTENSION_ID',
        message: `Duplicate extension id: ${common.id}`,
      });
    }
    extensionIds.add(common.id);

    for (const [engine, native] of [
      ['claude', entry.native?.claude],
      ['pi', entry.native?.pi],
    ] as const) {
      if (!supportsEngine(common, engine)) continue;
      const replaceCommon = native?.mode === 'replace';
      const commonTools = replaceCommon
        ? []
        : (common.tools ?? []).filter((tool) => supportsEngine(tool, engine));
      for (const tool of commonTools) {
        if (!isValidAgentExtensionResourceName(tool.name)) {
          diagnostics.push({
            extensionId: common.id,
            contributionId: tool.name,
            code: 'INVALID_TOOL_NAME',
            message: `Invalid ${engine} tool name: ${tool.name}`,
          });
          continue;
        }
        const normalized = tool.name.trim().toLowerCase();
        const owner = toolOwners[engine].get(normalized);
        if (owner) {
          diagnostics.push({
            extensionId: common.id,
            contributionId: tool.name,
            code: 'DUPLICATE_TOOL_NAME',
            message: `${engine} tool ${tool.name} is already declared by ${owner}`,
          });
        } else {
          toolOwners[engine].set(normalized, common.id);
        }
      }

      if (engine === 'claude' && commonTools.length > 0) {
        const owner = claudeMcpOwners.get(common.id);
        if (owner) {
          diagnostics.push({
            extensionId: common.id,
            contributionId: common.id,
            code: 'DUPLICATE_MCP_SERVER',
            message: `Claude MCP server ${common.id} is already declared by ${owner}`,
          });
        } else {
          claudeMcpOwners.set(common.id, common.id);
        }
      }

      for (const toolName of native?.claims?.tools ?? []) {
        if (!isValidAgentExtensionResourceName(toolName)) {
          diagnostics.push({
            extensionId: common.id,
            contributionId: toolName,
            code: 'INVALID_NATIVE_RESOURCE_NAME',
            message: `Invalid ${engine} native tool name: ${toolName}`,
          });
          continue;
        }
        const normalized = toolName.trim().toLowerCase();
        const owner = toolOwners[engine].get(normalized);
        if (owner) {
          diagnostics.push({
            extensionId: common.id,
            contributionId: toolName,
            code: 'NATIVE_TOOL_COLLISION',
            message: `${engine} native tool ${toolName} is already declared by ${owner}`,
          });
        } else {
          toolOwners[engine].set(normalized, common.id);
        }
      }

      if (engine === 'claude') {
        for (const serverName of entry.native?.claude?.claims?.mcpServers ?? []) {
          if (!isValidAgentExtensionResourceName(serverName)) {
            diagnostics.push({
              extensionId: common.id,
              contributionId: serverName,
              code: 'INVALID_NATIVE_RESOURCE_NAME',
              message: `Invalid Claude native MCP server name: ${serverName}`,
            });
            continue;
          }
          const owner = claudeMcpOwners.get(serverName);
          if (owner) {
            diagnostics.push({
              extensionId: common.id,
              contributionId: serverName,
              code: 'NATIVE_MCP_SERVER_COLLISION',
              message: `Claude native MCP server ${serverName} is already declared by ${owner}`,
            });
          } else {
            claudeMcpOwners.set(serverName, common.id);
          }
        }
      }
    }
  }

  return diagnostics;
}
