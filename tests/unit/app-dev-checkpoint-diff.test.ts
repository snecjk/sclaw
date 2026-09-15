/**
 * T04 checkpoint diff / hash 回传 / 指定版本恢复的服务级测试：
 * 用 tmp 目录真实 git 仓库（参照 app-dev-preview-routes.test.ts 的 tmp 做法）。
 */
import { execFile } from 'child_process';
import { mkdtemp, readFile, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { promisify } from 'util';
import { describe, expect, it } from 'vitest';
import {
  createCheckpointDetailed,
  diffCheckpoint,
  restoreCheckpoint,
} from '../../electron/services/app-dev-service';

const execFileAsync = promisify(execFile);

async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync('git', args, { cwd });
  return stdout.trim();
}

async function initRepo(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'sclaw-app-diff-'));
  await git(root, ['init']);
  return root;
}

describe('createCheckpointDetailed（hash 随创建回传）', () => {
  it('created 时返回新 commit hash，clean-head 时返回当前 HEAD', async () => {
    const root = await initRepo();
    await writeFile(join(root, 'a.txt'), '1\n2\n3\n', 'utf8');

    const first = await createCheckpointDetailed(root, '初始版本');
    expect(first.status).toBe('created');
    expect(first.hash).toMatch(/^[0-9a-f]{40}$/);
    expect(await git(root, ['rev-parse', 'HEAD'])).toBe(first.hash);
    expect(await git(root, ['log', '-1', '--format=%s'])).toBe('初始版本');

    // 无改动 → clean-head，hash 为当前 HEAD
    const clean = await createCheckpointDetailed(root, '空轮次');
    expect(clean.status).toBe('clean-head');
    expect(clean.hash).toBe(first.hash);

    // 有改动 → 新 hash
    await writeFile(join(root, 'a.txt'), '1\n2\n3\n4\n', 'utf8');
    const second = await createCheckpointDetailed(root, '对话修改 · 加一行');
    expect(second.status).toBe('created');
    expect(second.hash).toMatch(/^[0-9a-f]{40}$/);
    expect(second.hash).not.toBe(first.hash);
  });
});

describe('diffCheckpoint（两 hash 间逐文件差异）', () => {
  it('M/A/D 文件：numstat 正确，文本文件回前后全文', async () => {
    const root = await initRepo();
    await writeFile(join(root, 'mod.txt'), '1\n2\n3\n', 'utf8');
    await writeFile(join(root, 'del.txt'), 'bye\n', 'utf8');
    await writeFile(join(root, 'keep.txt'), 'keep\n', 'utf8');
    const first = await createCheckpointDetailed(root, 'v1');

    await writeFile(join(root, 'mod.txt'), '1\n2\n3\n4\n5\n', 'utf8');
    await writeFile(join(root, 'new.txt'), 'hello\nworld\n', 'utf8');
    await git(root, ['rm', '-q', 'del.txt']);
    const second = await createCheckpointDetailed(root, '对话修改 · v2');

    const diff = await diffCheckpoint(root, second.hash!);
    expect(diff).not.toBeNull();
    expect(diff!.hash).toBe(second.hash);
    expect(diff!.parentHash).toBe(first.hash);
    expect(diff!.subject).toBe('对话修改 · v2');

    const byPath = new Map(diff!.files.map((file) => [file.path, file]));
    expect(byPath.has('keep.txt')).toBe(false);

    const mod = byPath.get('mod.txt');
    expect(mod?.status).toBe('M');
    expect(mod?.added).toBe(2);
    expect(mod?.removed).toBe(0);
    expect(mod?.original).toBe('1\n2\n3\n');
    expect(mod?.modified).toBe('1\n2\n3\n4\n5\n');

    const added = byPath.get('new.txt');
    expect(added?.status).toBe('A');
    expect(added?.added).toBe(2);
    expect(added?.original).toBe('');
    expect(added?.modified).toBe('hello\nworld\n');

    const deleted = byPath.get('del.txt');
    expect(deleted?.status).toBe('D');
    expect(deleted?.removed).toBe(1);
    expect(deleted?.original).toBe('bye\n');
    expect(deleted?.modified).toBe('');
  });

  it('首个 commit（无父）：parentHash 为 null，全部按新增处理（全绿）', async () => {
    const root = await initRepo();
    await writeFile(join(root, 'a.txt'), 'alpha\n', 'utf8');
    await writeFile(join(root, 'b.txt'), 'beta\n', 'utf8');
    const first = await createCheckpointDetailed(root, 'v1');

    const diff = await diffCheckpoint(root, first.hash!);
    expect(diff).not.toBeNull();
    expect(diff!.parentHash).toBeNull();
    const contentFiles = diff!.files.filter((file) => file.path !== '.gitignore');
    expect(contentFiles.length).toBeGreaterThanOrEqual(2);
    for (const file of contentFiles) {
      expect(file.status).toBe('A');
      expect(file.original).toBe('');
      expect(file.modified).toBeTruthy();
    }
  });

  it('二进制文件只回统计，不回全文', async () => {
    const root = await initRepo();
    await writeFile(join(root, 'logo.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01, 0x02]));
    const commit = await createCheckpointDetailed(root, '加图片');

    const diff = await diffCheckpoint(root, commit.hash!);
    const file = diff!.files.find((item) => item.path === 'logo.png');
    expect(file).toBeTruthy();
    expect(file!.binary).toBe(true);
    expect(file!.added).toBeNull();
    expect(file!.removed).toBeNull();
    expect(file!.original).toBeUndefined();
    expect(file!.modified).toBeUndefined();
  });

  it('超过 1MB 的文件标记 truncated，不回全文', async () => {
    const root = await initRepo();
    await writeFile(join(root, 'big.txt'), 'a'.repeat(1_100_000), 'utf8');
    const commit = await createCheckpointDetailed(root, '大文件');

    const diff = await diffCheckpoint(root, commit.hash!);
    const file = diff!.files.find((item) => item.path === 'big.txt');
    expect(file).toBeTruthy();
    expect(file!.binary).toBeUndefined();
    expect(file!.truncated).toBe(true);
    expect(file!.modified).toBeUndefined();
  }, 20_000);

  it('T10：baseHash..hash 任意两版区间对比', async () => {
    const root = await initRepo();
    await writeFile(join(root, 'a.txt'), 'v1\n', 'utf8');
    const v1 = await createCheckpointDetailed(root, 'v1');
    await writeFile(join(root, 'a.txt'), 'v2\n', 'utf8');
    await createCheckpointDetailed(root, 'v2');
    await writeFile(join(root, 'a.txt'), 'v3\n', 'utf8');
    const v3 = await createCheckpointDetailed(root, 'v3');

    const diff = await diffCheckpoint(root, v3.hash!, v1.hash!);
    expect(diff).not.toBeNull();
    expect(diff!.parentHash).toBe(v1.hash);
    const file = diff!.files.find((item) => item.path === 'a.txt');
    expect(file?.status).toBe('M');
    expect(file?.original).toBe('v1\n');
    expect(file?.modified).toBe('v3\n');
  });

  it('非法 / 不存在的 hash 返回 null（含 HEAD~1 这类拼接注入）', async () => {
    const root = await initRepo();
    await writeFile(join(root, 'a.txt'), '1\n', 'utf8');
    await createCheckpointDetailed(root, 'v1');

    await expect(diffCheckpoint(root, 'HEAD~1')).resolves.toBeNull();
    await expect(diffCheckpoint(root, 'not-a-hash')).resolves.toBeNull();
    await expect(diffCheckpoint(root, 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef')).resolves.toBeNull();
    await expect(diffCheckpoint(root, '')).resolves.toBeNull();
  });
});

describe('restoreCheckpoint（指定 hash 回滚 + 自动备份分支）', () => {
  it('回滚到指定 checkpoint：工作区内容还原且出现 sclaw-backup-* 分支', async () => {
    const root = await initRepo();
    await writeFile(join(root, 'page.txt'), 'v1 内容\n', 'utf8');
    const first = await createCheckpointDetailed(root, 'v1');

    await writeFile(join(root, 'page.txt'), 'v2 内容\n', 'utf8');
    await createCheckpointDetailed(root, 'v2');

    const result = await restoreCheckpoint(root, first.hash!);
    expect(result.restored).toBe(true);
    expect(result.backupRef).toMatch(/^sclaw-backup-\d+$/);
    expect(await readFile(join(root, 'page.txt'), 'utf8')).toBe('v1 内容\n');
    expect(await git(root, ['rev-parse', 'HEAD'])).toBe(first.hash);

    const branches = await git(root, ['branch', '--list', 'sclaw-backup-*']);
    expect(branches.length).toBeGreaterThan(0);
  });
});
