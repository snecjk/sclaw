import { describe, expect, it } from 'vitest';
import { parseToolWorkspaceHints } from '../../shared/tool-workspace-hints';

describe('tool-workspace-hints', () => {
  it('parses cwd and outputDir from tool result JSON text', () => {
    const hints = parseToolWorkspaceHints([{
      type: 'text',
      text: JSON.stringify({
        cwd: '/Users/sto/.stoclaw/openclaw/workspace',
        outputDir: '/Users/sto/.stoclaw/openclaw/workspace/.claw-output',
      }),
    }]);
    expect(hints.cwd).toBe('/Users/sto/.stoclaw/openclaw/workspace');
    expect(hints.outputDir).toBe('/Users/sto/.stoclaw/openclaw/workspace/.claw-output');
  });

  it('parses runDir from nested envelope data', () => {
    const hints = parseToolWorkspaceHints({
      type: 'python_run_complete',
      success: true,
      domain: 'runtime',
      data: {
        runDir: '/Users/sto/.kimi/daimon/runtime/python/run-abc123',
        outputFiles: [{ path: '/Users/sto/.kimi/daimon/runtime/python/run-abc123/out.json' }],
      },
    });
    expect(hints.runDir).toBe('/Users/sto/.kimi/daimon/runtime/python/run-abc123');
  });

  it('reads workspace alias fields', () => {
    const hints = parseToolWorkspaceHints({
      workspacePath: '/tmp/workspace',
      run_dir: '/tmp/workspace/run-1',
    });
    expect(hints.cwd).toBe('/tmp/workspace');
    expect(hints.runDir).toBe('/tmp/workspace/run-1');
  });
});
