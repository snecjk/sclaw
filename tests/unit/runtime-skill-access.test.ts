import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  beginRuntimeSkillAccessTurn,
  clearRuntimeSkillAccess,
  findRuntimeSkillCandidateForRead,
  registerRuntimeSkillCandidates,
} from '../../electron/agent-extensions/extensions/sto-skill-runtime/access';

const roots: string[] = [];
const sessionKey = 'pi:main:runtime-access';

afterEach(async () => {
  clearRuntimeSkillAccess(sessionKey);
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('runtime Skill read access', () => {
  it('authorizes only the current run and files inside a searched candidate root', async () => {
    const skillRoot = await mkdtemp(join(tmpdir(), 'sclaw-runtime-skill-'));
    roots.push(skillRoot);
    const skillMdPath = join(skillRoot, 'SKILL.md');
    const referencePath = join(skillRoot, 'reference.md');
    await Promise.all([
      writeFile(skillMdPath, '# Skill', 'utf-8'),
      writeFile(referencePath, '# Reference', 'utf-8'),
    ]);
    beginRuntimeSkillAccessTurn(sessionKey, 'run-1');
    registerRuntimeSkillCandidates(sessionKey, 'run-1', [{
      slug: 'runtime-skill',
      sourceHash: 'hash-1',
      skillRoot,
      skillMdPath,
    }]);

    await expect(findRuntimeSkillCandidateForRead({
      sessionKey,
      runId: 'run-1',
      requestedPath: referencePath,
    })).resolves.toMatchObject({ candidate: { slug: 'runtime-skill' } });
    await expect(findRuntimeSkillCandidateForRead({
      sessionKey,
      runId: 'run-2',
      requestedPath: referencePath,
    })).resolves.toBeUndefined();
    await expect(findRuntimeSkillCandidateForRead({
      sessionKey,
      runId: 'run-1',
      requestedPath: join(dirname(skillRoot), 'outside.md'),
    })).resolves.toBeUndefined();
  });
});
