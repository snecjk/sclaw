/**
 * Migration + path helpers for project agent `.sclaw` workspace.
 * Covered by unit tests; keep behavior documented for OpenSpec apply.
 */
import { describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, writeFile, readFile, access } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { prepareProjectAgentWorkspace } from '../../electron/services/project-agent-workspace';

describe('prepareProjectAgentWorkspace', () => {
  it('creates .sclaw and migrates bootstrap + .claw-output from project root', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'sclaw-project-'));
    await writeFile(join(projectRoot, 'AGENTS.md'), '# agents', 'utf8');
    await writeFile(join(projectRoot, 'USER.md'), '# user', 'utf8');
    await mkdir(join(projectRoot, '.claw-output'));
    await writeFile(join(projectRoot, '.claw-output', 'report.html'), '<html></html>', 'utf8');

    const workspace = await prepareProjectAgentWorkspace(projectRoot);

    expect(workspace).toBe(join(projectRoot, '.sclaw'));
    expect(await readFile(join(workspace, 'AGENTS.md'), 'utf8')).toBe('# agents');
    expect(await readFile(join(workspace, 'USER.md'), 'utf8')).toBe('# user');
    expect(await readFile(join(workspace, '.claw-output', 'report.html'), 'utf8')).toBe('<html></html>');

    await expect(access(join(projectRoot, 'AGENTS.md'))).rejects.toThrow();
    await expect(access(join(projectRoot, '.claw-output'))).rejects.toThrow();
  });
});
