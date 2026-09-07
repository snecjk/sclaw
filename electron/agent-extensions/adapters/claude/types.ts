import type { McpServerConfig } from '@anthropic-ai/claude-agent-sdk';
import type {
  SclawExtensionBuildContext,
  SclawNativeContributionMode,
} from '../../../../shared/agent-extensions';
import type { ClaudeRuntimeOptions } from '../../../engines/claude-runtime-extensions';

export interface ClaudeNativeContribution {
  mode?: SclawNativeContributionMode;
  claims?: {
    tools?: readonly string[];
    mcpServers?: readonly string[];
  };
  build(
    context: SclawExtensionBuildContext,
  ): Promise<ClaudeRuntimeOptions> | ClaudeRuntimeOptions;
}

export type ClaudeExtensionMcpServers = Record<string, McpServerConfig>;
