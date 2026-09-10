import { describe, expect, it, vi } from 'vitest';

vi.mock('../../electron/utils/openclaw-auth', () => ({
  getOrCreateBrowserAutomationToken: vi.fn(() => 'test-token'),
}));

import {
  BA_SYSTEM_PROMPT,
  BROWSER_AUTOMATION_MCP_SERVER_NAME,
  browserAutomationMcpToolName,
  createBrowserAutomationMcpServer,
} from '../../sto-plugin/claude/sto-browser-automation/tools';
import { buildStoBrowserAutomationClaudeRuntimeOptions } from '../../sto-plugin/claude/sto-browser-automation/sdk';

describe('sto-browser-automation Claude MCP', () => {
  it('uses the OpenClaw BA_SYSTEM_PROMPT as the single source', () => {
    expect(BA_SYSTEM_PROMPT).toContain('ba_screenshot');
    expect(BA_SYSTEM_PROMPT).toContain('ba_print_pdf');
    expect(BA_SYSTEM_PROMPT).toContain('ba_cdp');
  });

  it('builds MCP tool names with sto-browser-automation prefix', () => {
    expect(browserAutomationMcpToolName('ba_screenshot')).toBe(
      'mcp__sto-browser-automation__ba_screenshot',
    );
  });

  it('creates in-process MCP server', () => {
    const server = createBrowserAutomationMcpServer({ hostApiPort: 3210 });
    expect(server).toBeDefined();
    expect(server.type).toBe('sdk');
    expect(BROWSER_AUTOMATION_MCP_SERVER_NAME).toBe('sto-browser-automation');
  });

  it('skips ba_* MCP for embed app chat (bridge_* owns that surface)', () => {
    const runtime = buildStoBrowserAutomationClaudeRuntimeOptions({
      sessionKey: 'agent:main:session-embed-app-teambition--abc',
      hostApiPort: 3210,
    });
    expect(runtime.mcpServers).toBeUndefined();
    expect(runtime.systemPromptAppend).toBeUndefined();
  });

  it('registers ba_* MCP for ordinary sessions', () => {
    const runtime = buildStoBrowserAutomationClaudeRuntimeOptions({
      sessionKey: 'agent:main:main',
      hostApiPort: 3210,
    });
    expect(runtime.systemPromptAppend).toBe(BA_SYSTEM_PROMPT);
    expect(runtime.mcpServers?.['sto-browser-automation']).toBeDefined();
  });
});
