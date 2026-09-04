import { createRequire } from 'node:module';

type ClaudeAgentSdk = typeof import('@anthropic-ai/claude-agent-sdk');

const nodeRequire = createRequire(__filename);

let cachedSdk: ClaudeAgentSdk | null = null;

/**
 * Load claude-agent-sdk via require() so @loongsuite/cms_node_sdk can patch
 * query/startup through InstrumentationNodeModuleDefinition.
 * Dynamic import() bypasses the require hook and produces no claude_agent spans.
 */
export function loadClaudeAgentSdk(): ClaudeAgentSdk {
  cachedSdk ??= nodeRequire('@anthropic-ai/claude-agent-sdk') as ClaudeAgentSdk;
  return cachedSdk;
}

export async function loadClaudeAgentSdkAsync(): Promise<ClaudeAgentSdk> {
  return loadClaudeAgentSdk();
}
