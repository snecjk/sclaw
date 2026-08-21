import { describe, expect, it } from 'vitest';
import {
  BRIDGE_SYSTEM_PROMPT,
  browserMcpToolName,
  createBrowserMcpServer,
  EMBED_BRIDGE_SYSTEM_PROMPT,
} from '../../sto-plugin/claude/sto-browser-tool/tools';
import { buildStoBrowserToolClaudeRuntimeOptions } from '../../sto-plugin/claude/sto-browser-tool/sdk';

describe('sto-browser-tool Claude MCP', () => {
  it('documents bridge_click in system prompt', () => {
    expect(BRIDGE_SYSTEM_PROMPT).toContain('bridge_click');
    expect(EMBED_BRIDGE_SYSTEM_PROMPT).toContain('不要调用 ba_*');
  });

  it('builds MCP tool names with sto-browser-tool prefix', () => {
    expect(browserMcpToolName('bridge_click')).toBe('mcp__sto-browser-tool__bridge_click');
  });

  it('creates in-process MCP server', () => {
    const server = createBrowserMcpServer({ hostApiPort: 3210 });
    expect(server).toBeDefined();
    expect(server.type).toBe('sdk');
  });

  it('uses embed-specific prompt for embed app chat sessions', () => {
    const runtime = buildStoBrowserToolClaudeRuntimeOptions({
      sessionKey: 'agent:main:session-embed-app-teambition--abc',
      hostApiPort: 3210,
    });
    expect(runtime.systemPromptAppend).toContain(EMBED_BRIDGE_SYSTEM_PROMPT);
    expect(runtime.mcpServers?.['sto-browser-tool']).toBeDefined();
  });

  it('uses general bridge prompt for non-embed sessions', () => {
    const runtime = buildStoBrowserToolClaudeRuntimeOptions({
      sessionKey: 'agent:main:main',
      hostApiPort: 3210,
    });
    expect(runtime.systemPromptAppend).toBe(BRIDGE_SYSTEM_PROMPT);
  });
});
