import { describe, expect, it, vi } from 'vitest';
import {
  SclawCapabilityRegistry,
  SclawExtensionStateManager,
  type SclawExtensionLogger,
} from '../../shared/agent-extensions';
import { buildClaudeAgentExtensions } from '../../electron/agent-extensions/adapters/claude';
import { buildPiAgentExtensions } from '../../electron/agent-extensions/adapters/pi';
import {
  STO_OSS_TINY_FILE_CAPABILITY,
  type StoOssTinyFilePort,
} from '../../electron/agent-extensions/extensions/sto-oss-tinyfile/capability';
import { stoOssTinyFileDefinition } from '../../electron/agent-extensions/extensions/sto-oss-tinyfile/definition';
import { uploadFileToTempOssTool } from '../../electron/agent-extensions/extensions/sto-oss-tinyfile/operations';

function dependencies() {
  const port: StoOssTinyFilePort = {
    upload: vi.fn(async () => ({
      url: 'https://oss.example.com/report.pdf?sig=1',
      tempUrl: 'https://oss.example.com/report.pdf?sig=1',
      ossKey: 'claw_tiny_file/report.pdf',
      resourceId: 'report.pdf',
      fileType: 'pdf',
      name: 'report.pdf',
    })),
  };
  const logger: SclawExtensionLogger = {
    debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(),
  };
  return {
    port,
    logger,
    capabilities: new SclawCapabilityRegistry().provide(STO_OSS_TINY_FILE_CAPABILITY, port),
    stateManager: new SclawExtensionStateManager(),
  };
}

describe('sto-oss-tinyfile common extension', () => {
  it('uses the Pi Worker default capability registry', async () => {
    const result = await buildPiAgentExtensions({
      sessionKey: 'agent:main:chat',
      mode: 'interactive',
      entries: [{ common: stoOssTinyFileDefinition }],
      stateManager: new SclawExtensionStateManager(),
    });
    expect(result.diagnostics).not.toContainEqual(expect.objectContaining({
      extensionId: 'sto-oss-tinyfile',
      code: 'MISSING_CAPABILITY',
    }));
    expect(result.initiallyActiveToolNames).toContain('upload_file_to_temp_oss');
  });

  it('registers the upload tool for Claude and Pi', async () => {
    const deps = dependencies();
    const entries = [{ common: stoOssTinyFileDefinition }];
    const claude = await buildClaudeAgentExtensions({
      sessionKey: 'agent:main:chat', mode: 'interactive', entries, ...deps,
    });
    const server = claude.options.mcpServers?.['sto-oss-tinyfile'] as unknown as {
      instance: { _registeredTools: Record<string, unknown> };
    };
    expect(Object.keys(server.instance._registeredTools)).toEqual(['upload_file_to_temp_oss']);

    const pi = await buildPiAgentExtensions({
      sessionKey: 'agent:main:chat', mode: 'interactive', entries, ...deps,
    });
    expect(pi.initiallyActiveToolNames).toEqual(['upload_file_to_temp_oss']);
  });

  it('is available in scheduled mode', async () => {
    const deps = dependencies();
    const result = await buildClaudeAgentExtensions({
      sessionKey: 'claude-task:t1:run',
      mode: 'scheduled',
      entries: [{ common: stoOssTinyFileDefinition }],
      ...deps,
    });
    expect(result.options.mcpServers?.['sto-oss-tinyfile']).toBeDefined();
  });

  it('skips the extension when its capability is absent', async () => {
    const result = await buildPiAgentExtensions({
      sessionKey: 'agent:main:chat',
      mode: 'interactive',
      entries: [{ common: stoOssTinyFileDefinition }],
      capabilities: new SclawCapabilityRegistry(),
      stateManager: new SclawExtensionStateManager(),
    });
    expect(result.diagnostics).toContainEqual(expect.objectContaining({
      extensionId: 'sto-oss-tinyfile',
      code: 'MISSING_CAPABILITY',
      contributionId: 'sto.oss-tiny-file',
    }));
  });

  it('returns an uploaded URL envelope without expiry guidance', async () => {
    const deps = dependencies();
    const outcome = await uploadFileToTempOssTool.execute({
      filePath: 'output/report.pdf',
    }, {
      engine: 'pi',
      sessionKey: 'agent:main:chat',
      mode: 'interactive',
      commandShell: 'powershell',
      cwd: 'D:/workspace',
      toolCallId: 'tool-upload',
      capabilities: deps.capabilities,
      state: deps.stateManager.forExtension('agent:main:chat', 'sto-oss-tinyfile'),
      logger: deps.logger,
    });

    expect(outcome).toMatchObject({
      success: true,
      type: 'oss_file_uploaded',
      domain: 'oss',
      data: {
        url: 'https://oss.example.com/report.pdf?sig=1',
        temporary: true,
      },
    });
    expect(outcome).not.toHaveProperty('data.expiresSeconds');
    expect(outcome.message).not.toMatch(/有效期|过期|7 天/);
    expect(deps.port.upload).toHaveBeenCalledWith(expect.objectContaining({
      filePath: 'output/report.pdf',
      cwd: 'D:/workspace',
    }));
  });

  it('converts upload failures into a tool failure', async () => {
    const deps = dependencies();
    vi.mocked(deps.port.upload).mockRejectedValue(new Error('File not found'));
    const outcome = await uploadFileToTempOssTool.execute({ filePath: 'missing.txt' }, {
      engine: 'claude',
      sessionKey: 'agent:main:chat',
      mode: 'interactive',
      commandShell: 'bash',
      toolCallId: 'tool-upload-failed',
      capabilities: deps.capabilities,
      state: deps.stateManager.forExtension('agent:main:chat', 'sto-oss-tinyfile'),
      logger: deps.logger,
    });
    expect(outcome).toMatchObject({
      success: false,
      error: { code: 'sto_oss_tiny_file_error', message: 'File not found' },
    });
  });
});
