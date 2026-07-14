import { describe, it, expect, vi } from 'vitest';

// getDataDir() 调 app.getPath('userData')，vitest 里需 mock electron（复用 DB 测试的 seam）
const tempUserDataDir = vi.hoisted(() => {
  const path = require('node:path');
  const os = require('node:os');
  const fs = require('node:fs');
  const dir = path.join(os.tmpdir(), `stoclaw-wf-prompt-test-${process.pid}-${Date.now()}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
});
vi.mock('electron', () => ({
  app: { getPath: () => tempUserDataDir, isPackaged: false, getAppPath: () => tempUserDataDir },
}));

import path from 'node:path';
import { buildPrompt, workspacePath } from '../../electron/services/workflow-runtime/prompt-builder';
import { getDataDir } from '../../electron/utils/paths';

describe('prompt-builder', () => {
  it('uses client workspace path, no cloud /runtime paths', () => {
    const p = buildPrompt(
      { target: { provider: 'client_local', kind: 'agent_data_fetch' }, completionContract: { outputJsonSchema: { type: 'object' } } } as any,
      { runId: 'r1', nodeId: 'n1' } as any);
    expect(p).toContain('workspaces/r1/n1');
    expect(p).not.toContain('/runtime/outputs/');
    expect(p).not.toContain('/runtime/workspaces');
    expect(p.toLowerCase()).not.toContain('cloud_agent');
  });
  it('includes turn boundary, role, schema, delivery sections', () => {
    const p = buildPrompt(
      { target: { kind: 'agent_output' }, completionContract: { outputJsonSchema: { type: 'object', required: ['doc'] }, task: { goal: '生成文档', instruction: '用 markdown' } } } as any,
      { runId: 'r1', nodeId: 'n2' } as any);
    expect(p).toContain('[runId=r1 nodeId=n2]');
    expect(p).toContain('生成文档');
    expect(p).toContain('doc');
    expect(p).toContain('file:///');
  });
  it('includes retry-context when retryReason set', () => {
    const p = buildPrompt(
      { completionContract: { outputJsonSchema: { type: 'object' } } } as any,
      { runId: 'r1', nodeId: 'n1', retryReason: '输出缺少必填字段 x' } as any);
    expect(p).toContain('输出缺少必填字段 x');
    expect(p).toMatch(/副作用|重做前/i);
  });
  it('workspacePath resolves under userData', () => {
    expect(workspacePath('r1', 'n1')).toBe(path.join(getDataDir(), 'workflow-runtime', 'workspaces', 'r1', 'n1'));
  });
});
