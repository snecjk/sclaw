// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { createHash, randomBytes } from 'node:crypto';

// app.getPath('userData') 指向每个用例独立的临时目录
const testState = vi.hoisted(() => ({ rootDir: '' }));

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn(() => testState.rootDir),
    getAppPath: vi.fn(() => testState.rootDir),
    isPackaged: false,
  },
}));

// 部分 mock node:crypto：randomBytes 可控（O_EXCL 冲突用例），createHash/randomUUID 等保持真实
vi.mock('node:crypto', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:crypto')>();
  return {
    ...actual,
    randomBytes: vi.fn((size: number) => actual.randomBytes(size)),
  };
});

const realCrypto = await vi.importActual<typeof import('node:crypto')>('node:crypto');
const mockRandomBytes = vi.mocked(randomBytes);

import {
  getBrowserArtifactsRootDir,
  pruneExpiredBrowserArtifacts,
  readBaArtifact,
  writeBaArtifact,
} from '../../electron/services/browser-automation/artifact-writer';
import { browserAutomationRepository } from '../../electron/db/repositories/browser-automation-repository';
import { setupInMemoryDb, type InMemoryDb } from '../db/helpers';

const FIXED_INSTANT = new Date(2026, 8, 3, 10, 0, 0); // 本地时间 2026-09-03 10:00:00

function artifactsDateDir(): string {
  return join(getBrowserArtifactsRootDir(), '20260903');
}

describe('browser automation artifact writer (B3/B11)', () => {
  let db: InMemoryDb;

  beforeEach(async () => {
    testState.rootDir = mkdtempSync(join(tmpdir(), 'ba-artifacts-'));
    db = setupInMemoryDb();
    await browserAutomationRepository.upsertSession({ sessionId: 'sess-1', source: 'managed' });
  });

  afterEach(() => {
    vi.useRealTimers();
    mockRandomBytes.mockImplementation((size: number) => realCrypto.randomBytes(size));
    db.teardown();
    rmSync(testState.rootDir, { recursive: true, force: true });
  });

  it('writes bytes via tmp→rename, registers metadata (binary stays out of DB)', async () => {
    const bytes = Buffer.from('hello-artifact-二进制');
    const ref = await writeBaArtifact({
      bytes,
      kind: 'screenshot',
      ext: '.png',
      sessionId: 'sess-1',
      runId: 'run-1',
    });

    // ref 字段完整
    expect(ref.artifactId).toMatch(/^\d{14}-[0-9a-f]{16}$/);
    expect(ref.path.startsWith(getBrowserArtifactsRootDir())).toBe(true);
    expect(basename(ref.path)).toMatch(/^screenshot-\d+-[0-9a-f]{8}\.png$/);
    expect(ref.sha256).toBe(createHash('sha256').update(bytes).digest('hex'));
    expect(ref.bytes).toBe(bytes.byteLength);
    expect(ref.mimeType).toBe('image/png');
    expect(ref.createdAt).toBeTruthy();

    // 文件内容一致；tmp 文件无残留（目录里只有最终产物一个文件）
    expect(readFileSync(ref.path).equals(bytes)).toBe(true);
    const dirEntries = readdirSync(join(ref.path, '..'));
    expect(dirEntries.filter((name) => name.includes('.tmp-'))).toEqual([]);

    // DB 只登记元数据：列集合不含任何二进制字段
    const row = await browserAutomationRepository.getArtifact(ref.artifactId);
    expect(row).toBeTruthy();
    expect(Object.keys(row as Record<string, unknown>).sort()).toEqual(
      ['artifact_id', 'bytes', 'created_at', 'kind', 'mime_type', 'path', 'run_id', 'session_id', 'sha256'].sort(),
    );
    expect(row).toMatchObject({
      artifact_id: ref.artifactId,
      session_id: 'sess-1',
      run_id: 'run-1',
      kind: 'screenshot',
      sha256: ref.sha256,
      bytes: bytes.byteLength,
      mime_type: 'image/png',
    });

    // listArtifacts 过滤
    expect(await browserAutomationRepository.listArtifacts({ sessionId: 'sess-1' })).toHaveLength(1);
    expect(await browserAutomationRepository.listArtifacts({ runId: 'run-1' })).toHaveLength(1);
    expect(await browserAutomationRepository.listArtifacts({ sessionId: 'other' })).toHaveLength(0);
  });

  it('O_EXCL collision: retries with a fresh random name and never clobbers the existing file', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(FIXED_INSTANT);

    // 预置与首次抢占同名的占位文件（内容哨兵）
    mkdirSync(artifactsDateDir(), { recursive: true });
    const collidingName = `screenshot-${FIXED_INSTANT.getTime()}-aabbccdd.png`;
    const collidingPath = join(artifactsDateDir(), collidingName);
    writeFileSync(collidingPath, 'SENTINEL');

    // 第一次抢占固定随机数（必撞 EEXIST），第二次起恢复真实随机
    mockRandomBytes.mockReturnValueOnce(Buffer.from('aabbccdd', 'hex'));

    const bytes = Buffer.from('real-artifact');
    const ref = await writeBaArtifact({ bytes, kind: 'screenshot', ext: '.png', sessionId: 'sess-1' });

    // 换了新名字；哨兵文件未被覆盖；产物内容正确
    expect(basename(ref.path)).not.toBe(collidingName);
    expect(readFileSync(collidingPath, 'utf-8')).toBe('SENTINEL');
    expect(readFileSync(ref.path).equals(bytes)).toBe(true);
  });

  it('exhausts 3 collision retries → ARTIFACT_WRITE_FAILED, placeholder untouched', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(FIXED_INSTANT);

    mkdirSync(artifactsDateDir(), { recursive: true });
    const collidingPath = join(artifactsDateDir(), `pdf-${FIXED_INSTANT.getTime()}-aabbccdd.pdf`);
    writeFileSync(collidingPath, 'SENTINEL');

    // 所有抢占都返回同一随机名 → 三次 EEXIST
    mockRandomBytes.mockImplementation(() => Buffer.from('aabbccdd', 'hex'));

    await expect(
      writeBaArtifact({ bytes: Buffer.from('x'), kind: 'pdf', ext: '.pdf', sessionId: 'sess-1' }),
    ).rejects.toMatchObject({ code: 'ARTIFACT_WRITE_FAILED' });
    expect(readFileSync(collidingPath, 'utf-8')).toBe('SENTINEL');
  });

  it('readBaArtifact round-trips bytes and ref', async () => {
    const bytes = Buffer.from('%PDF-1.7 fake');
    const written = await writeBaArtifact({ bytes, kind: 'pdf', ext: '.pdf', sessionId: 'sess-1' });

    const { ref, bytes: readBack } = await readBaArtifact(written.artifactId);
    expect(readBack.equals(bytes)).toBe(true);
    expect(ref.artifactId).toBe(written.artifactId);
    expect(ref.sha256).toBe(written.sha256);
    expect(ref.mimeType).toBe('application/pdf');
  });

  it('readBaArtifact rejects path-traversal artifactIds', async () => {
    await expect(readBaArtifact('../evil')).rejects.toThrow(/Invalid artifactId/);
    await expect(readBaArtifact('a/b')).rejects.toThrow(/Invalid artifactId/);
    await expect(readBaArtifact('a b')).rejects.toThrow(/Invalid artifactId/);
    await expect(readBaArtifact('..')).rejects.toThrow(/Invalid artifactId/);
  });

  it('readBaArtifact rejects unknown artifactIds', async () => {
    await expect(readBaArtifact('deadbeefcafe0000')).rejects.toThrow(/not found/);
  });

  it('readBaArtifact rejects rows whose registered path escapes the artifacts root', async () => {
    const outsidePath = join(tmpdir(), 'outside-artifacts-root.txt');
    writeFileSync(outsidePath, 'escape');
    await browserAutomationRepository.insertArtifact({
      artifactId: 'escape-test-1',
      sessionId: 'sess-1',
      kind: 'read_page',
      path: outsidePath,
      sha256: '0'.repeat(64),
      bytes: 6,
      mimeType: 'text/markdown; charset=utf-8',
    });

    await expect(readBaArtifact('escape-test-1')).rejects.toThrow(/escapes artifacts root/);
    rmSync(outsidePath, { force: true });
  });

  it('prunes date directories older than 7 days', async () => {
    const root = getBrowserArtifactsRootDir();
    const stale = join(root, '20260820');
    const keep = join(root, '20260903');
    mkdirSync(stale, { recursive: true });
    mkdirSync(keep, { recursive: true });
    writeFileSync(join(stale, 'old.png'), 'old');
    writeFileSync(join(keep, 'new.png'), 'new');

    const result = await pruneExpiredBrowserArtifacts({
      now: FIXED_INSTANT,
      retentionDays: 7,
    });
    expect(result.removedDirs.some((dir) => dir.endsWith('20260820'))).toBe(true);
    expect(readdirSync(root)).toContain('20260903');
    expect(readdirSync(root)).not.toContain('20260820');
  });
});
