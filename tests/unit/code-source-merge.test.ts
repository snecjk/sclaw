import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  applyArchiveFileDiff,
  beginThreeWayMerge,
  cacheBaseSnapshotFromWorkspace,
} from '../../electron/utils/code-source-merge';
import {
  cleanupSourceSnapshot,
  createSourceSnapshot,
} from '../../electron/utils/code-source-archive';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function makeWorkspace(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'sclaw-merge-'));
  roots.push(root);
  await mkdir(join(root, 'src'), { recursive: true });
  return root;
}

async function packWorkspace(workspace: string): Promise<Buffer> {
  const snapshot = await createSourceSnapshot(workspace);
  const archive = await readFile(snapshot.archivePath);
  await cleanupSourceSnapshot(snapshot);
  return archive;
}

describe('code source merge workspace', () => {
  it('applies remote file diff without deleting untouched local-only files when local matches base', async () => {
    const workspace = await makeWorkspace();
    await writeFile(join(workspace, 'src', 'shared.ts'), 'v1\n', 'utf8');
    await cacheBaseSnapshotFromWorkspace(workspace);

    const remoteRoot = await makeWorkspace();
    await writeFile(join(remoteRoot, 'src', 'shared.ts'), 'v2\n', 'utf8');
    await writeFile(join(remoteRoot, 'src', 'remote.ts'), 'remote\n', 'utf8');
    const archive = await packWorkspace(remoteRoot);

    await applyArchiveFileDiff(archive, workspace);
    expect(await readFile(join(workspace, 'src', 'shared.ts'), 'utf8')).toBe('v2\n');
    expect(await readFile(join(workspace, 'src', 'remote.ts'), 'utf8')).toBe('remote\n');
  });

  it('three-way merges non-overlapping local and remote edits when base snapshot exists', async () => {
    const workspace = await makeWorkspace();
    await writeFile(join(workspace, 'src', 'a.ts'), 'base-a\n', 'utf8');
    await writeFile(join(workspace, 'src', 'b.ts'), 'base-b\n', 'utf8');
    await cacheBaseSnapshotFromWorkspace(workspace);

    await writeFile(join(workspace, 'src', 'a.ts'), 'local-a\n', 'utf8');

    const remoteRoot = await makeWorkspace();
    await writeFile(join(remoteRoot, 'src', 'a.ts'), 'base-a\n', 'utf8');
    await writeFile(join(remoteRoot, 'src', 'b.ts'), 'remote-b\n', 'utf8');
    const archive = await packWorkspace(remoteRoot);

    const result = await beginThreeWayMerge({
      workspace,
      remoteArchive: archive,
      oursBaseRevisionId: 'rev-base',
      theirsRevisionId: 'rev-head',
      theirsCommitSha: 'sha-head',
      theirsSourceSha256: 'deadbeef',
    });

    expect(result.conflicts).toEqual([]);
    expect(result.autoMerged).toBe(true);
    expect(await readFile(join(workspace, 'src', 'a.ts'), 'utf8')).toBe('local-a\n');
    expect(await readFile(join(workspace, 'src', 'b.ts'), 'utf8')).toBe('remote-b\n');
  });
});
