/**
 * BAP 产物写盘加固（计划 §四 B3 / P0-5）：
 * 临时文件 → sha256 → O_EXCL 占位 → rename 同分区原子落盘 → ba_artifact 表登记元数据。
 * 二进制只落 `<userData>/browser-artifacts/<yyyymmdd>/`，不入库（§六 R8）。
 */
import { createHash, randomBytes } from 'node:crypto';
import { mkdir, open, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { basename, join, resolve, sep } from 'node:path';
import { app } from 'electron';
import type {
  BrowserAutomationArtifactRef,
  BrowserAutomationErrorCode,
} from '../../../shared/browser-automation/types';
import { formatShanghaiIso } from '../../../shared/workflow-timestamp';
import { browserAutomationRepository } from '../../db/repositories/browser-automation-repository';

export interface WriteBaArtifactInput {
  bytes: Buffer;
  kind: 'screenshot' | 'pdf' | 'read_page' | 'network_har';
  ext: '.png' | '.jpg' | '.pdf' | '.md' | '.json';
  sessionId: string;
  runId?: string;
}

const ARTIFACT_MIME_BY_EXT: Record<WriteBaArtifactInput['ext'], string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.pdf': 'application/pdf',
  '.md': 'text/markdown; charset=utf-8',
  '.json': 'application/json',
};

/** artifactId 白名单：sha256 前 16 位 + 时间基，禁止路径分隔符（防穿越第一道闸）。 */
const ARTIFACT_ID_PATTERN = /^[A-Za-z0-9-]+$/;

const pad2 = (value: number): string => String(value).padStart(2, '0');

function compactDate(date: Date): string {
  return `${date.getFullYear()}${pad2(date.getMonth() + 1)}${pad2(date.getDate())}`;
}

function compactTimestamp(date: Date): string {
  return `${compactDate(date)}${pad2(date.getHours())}${pad2(date.getMinutes())}${pad2(date.getSeconds())}`;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function artifactError(code: BrowserAutomationErrorCode, message: string): Error {
  return Object.assign(new Error(message), { code });
}

/** 产物根目录：<userData>/browser-artifacts/（按日切子目录）。 */
export function getBrowserArtifactsRootDir(): string {
  return join(app.getPath('userData'), 'browser-artifacts');
}

export const BROWSER_ARTIFACT_RETENTION_DAYS = 7;

function startOfLocalDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function parseCompactDateDir(name: string): Date | null {
  if (!/^\d{8}$/.test(name)) return null;
  const year = Number(name.slice(0, 4));
  const month = Number(name.slice(4, 6)) - 1;
  const day = Number(name.slice(6, 8));
  const parsed = new Date(year, month, day);
  if (parsed.getFullYear() !== year || parsed.getMonth() !== month || parsed.getDate() !== day) {
    return null;
  }
  return parsed;
}

/**
 * 7 天滚动清理（计划 §八.6）：删除早于保留窗口的按日目录，并清掉对应 ba_artifact 行。
 * 启动时 best-effort 调用，失败不得阻断主进程。
 */
export async function pruneExpiredBrowserArtifacts(opts?: {
  now?: Date;
  retentionDays?: number;
}): Promise<{ removedDirs: string[]; deletedRows: number }> {
  const now = opts?.now ?? new Date();
  const retentionDays = opts?.retentionDays ?? BROWSER_ARTIFACT_RETENTION_DAYS;
  const cutoffDay = startOfLocalDay(now);
  cutoffDay.setDate(cutoffDay.getDate() - retentionDays);

  const root = getBrowserArtifactsRootDir();
  const removedDirs: string[] = [];
  try {
    const entries = await readdir(root, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const dirDate = parseCompactDateDir(entry.name);
      if (!dirDate || dirDate >= cutoffDay) continue;
      const dirPath = join(root, entry.name);
      await rm(dirPath, { recursive: true, force: true });
      removedDirs.push(dirPath);
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error;
    }
  }

  let deletedRows = 0;
  try {
    deletedRows = await browserAutomationRepository.deleteArtifactsCreatedBefore(cutoffDay.toISOString());
  } catch {
    // DB 未就绪时只清盘；下次启动再扫元数据。
  }
  return { removedDirs, deletedRows };
}

export async function writeBaArtifact(input: WriteBaArtifactInput): Promise<BrowserAutomationArtifactRef> {
  const now = new Date();
  const dir = join(getBrowserArtifactsRootDir(), compactDate(now));
  await mkdir(dir, { recursive: true });

  const sha256 = createHash('sha256').update(input.bytes).digest('hex');
  const artifactId = `${compactTimestamp(now)}-${sha256.slice(0, 16)}`;
  const mimeType = ARTIFACT_MIME_BY_EXT[input.ext];
  const byteLength = input.bytes.byteLength;

  // O_EXCL 抢占最终文件名（创建空占位）；EEXIST 换随机名重试 ≤3 次。
  // 先占位后写 tmp：抢占失败的候选名不会留下孤儿 tmp 文件。
  let finalPath: string | null = null;
  for (let attempt = 0; attempt < 3 && !finalPath; attempt += 1) {
    const candidate = join(dir, `${input.kind}-${now.getTime()}-${randomBytes(4).toString('hex')}${input.ext}`);
    try {
      const handle = await open(candidate, 'wx');
      await handle.close();
      finalPath = candidate;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
        throw artifactError('ARTIFACT_WRITE_FAILED', `claim artifact path failed: ${messageOf(error)}`);
      }
    }
  }
  if (!finalPath) {
    throw artifactError('ARTIFACT_WRITE_FAILED', 'artifact name collision retries exhausted (EEXIST x3)');
  }

  const tmpPath = join(dir, `.${basename(finalPath)}.tmp-${process.pid}`);
  let renamed = false;
  try {
    await writeFile(tmpPath, input.bytes);
    await rename(tmpPath, finalPath);
    renamed = true;
  } catch (error) {
    // 失败时清理 tmp 与空占位文件（ENOSPC 等场景不留半成品）
    await rm(tmpPath, { force: true }).catch(() => undefined);
    if (!renamed) {
      await rm(finalPath, { force: true }).catch(() => undefined);
    }
    throw artifactError('ARTIFACT_WRITE_FAILED', `write artifact failed: ${messageOf(error)}`);
  }

  try {
    await browserAutomationRepository.insertArtifact({
      artifactId,
      sessionId: input.sessionId,
      runId: input.runId ?? null,
      kind: input.kind,
      path: finalPath,
      sha256,
      bytes: byteLength,
      mimeType,
    });
  } catch (error) {
    // 登记失败的产物无法被 readBaArtifact 找回 → 摘除文件，保持"落盘必已登记"不变式
    await rm(finalPath, { force: true }).catch(() => undefined);
    throw artifactError('ARTIFACT_WRITE_FAILED', `register artifact failed: ${messageOf(error)}`);
  }

  return {
    artifactId,
    path: finalPath,
    sha256,
    bytes: byteLength,
    mimeType,
    createdAt: formatShanghaiIso(),
  };
}

export async function readBaArtifact(artifactId: string): Promise<{
  ref: BrowserAutomationArtifactRef;
  bytes: Buffer;
}> {
  if (!ARTIFACT_ID_PATTERN.test(artifactId)) {
    throw new Error(`Invalid artifactId: ${artifactId}`);
  }
  const row = await browserAutomationRepository.getArtifact(artifactId);
  if (!row) {
    throw new Error(`Artifact not found: ${artifactId}`);
  }

  // 防穿越第二道闸：登记路径必须落在 browser-artifacts 根内
  const root = resolve(getBrowserArtifactsRootDir());
  const resolved = resolve(typeof row.path === 'string' ? row.path : '');
  if (resolved !== root && !resolved.startsWith(root + sep)) {
    throw new Error(`Artifact path escapes artifacts root: ${artifactId}`);
  }

  const bytes = await readFile(resolved);
  const ref: BrowserAutomationArtifactRef = {
    artifactId,
    path: resolved,
    sha256: String(row.sha256 ?? ''),
    bytes: Number(row.bytes ?? bytes.byteLength),
    mimeType: String(row.mime_type ?? 'application/octet-stream'),
    createdAt: String(row.created_at ?? ''),
  };
  return { ref, bytes };
}
