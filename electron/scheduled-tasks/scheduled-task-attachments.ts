/**
 * 定时任务附件持久化：把 staging 文件复制到
 * `~/.stoclaw/scheduled-tasks/{taskId}/attachments/{id}-{fileName}`。
 *
 * Chat 在线/本地文件先落 `~/.stoclaw/openclaw/media/outbound/`；
 * 保存/NL 建任务时再拷到本目录，供 cron 重复执行。
 */
import { access, copyFile, mkdir, readdir, unlink } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { basename, extname, join, normalize, resolve } from 'node:path';
import { homedir } from 'node:os';
import { getStoClawHomeDir } from '../utils/paths';
import { logger } from '../utils/logger';
import { MEDIA_ATTACHED_REGEX } from '../../shared/media-path-enrich';

export type TaskAttachmentProvenance = { kind: string; [key: string]: unknown };

export type TaskComposerAttachmentRecord = {
  id?: string;
  fileName: string;
  mimeType: string;
  /** 客户端 staging / 旧持久路径；复制源 */
  sourcePath?: string;
  /** 任务专属持久路径 */
  persistentPath?: string;
  provenance?: TaskAttachmentProvenance;
};

export function normalizeAttachmentProvenance(value: unknown): TaskAttachmentProvenance {
  if (value && typeof value === 'object' && typeof (value as { kind?: unknown }).kind === 'string') {
    return value as TaskAttachmentProvenance;
  }
  return { kind: 'local' };
}

/**
 * 模型常把 outbound 绝对路径写进 prompt（不经 attachments / media attached 行）。
 * 匹配 ~/.stoclaw/.../outbound/<id>[.ext] 及可选（展示名）。
 */
const STOCLAW_OUTBOUND_PATH_RE =
  /(?:~|\/Users\/[^/\s]+|\/home\/[^/\s]+)?\/\.stoclaw\/(?:openclaw\/media\/outbound|scheduled-tasks\/[^/\s]+\/attachments)\/[^\s）)"'，,]+/g;
const STOCLAW_PATH_WITH_LABEL_RE =
  /((?:~|\/Users\/[^/\s]+|\/home\/[^/\s]+)?\/\.stoclaw\/(?:openclaw\/media\/outbound|scheduled-tasks\/[^/\s]+\/attachments)\/[^\s）)"'，,]+)\s*[（(]([^）)]+)[）)]/g;

function guessMime(fileName: string): string {
  const ext = extname(fileName).toLowerCase();
  switch (ext) {
    case '.xlsx':
    case '.xls':
      return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    case '.csv':
      return 'text/csv';
    case '.txt':
    case '.md':
      return 'text/plain';
    case '.pdf':
      return 'application/pdf';
    case '.html':
    case '.htm':
      return 'text/html';
    case '.json':
      return 'application/json';
    case '.png':
      return 'image/png';
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    default:
      return 'application/octet-stream';
  }
}

function expandHomePath(raw: string): string {
  const trimmed = raw.trim().replace(/[，,;；]+$/g, '');
  if (trimmed.startsWith('~/') || trimmed === '~') {
    return join(homedir(), trimmed.slice(2));
  }
  return trimmed;
}

export function resolveAttachmentDisplayName(sourcePath: string, label?: string): string {
  const pathBase = basename(sourcePath) || 'file';
  const pathExt = extname(pathBase);
  const trimmed = label?.trim();
  if (!trimmed) return pathBase;
  if (extname(trimmed)) return trimmed;
  if (pathExt) return `${trimmed}${pathExt}`;
  return trimmed;
}

/** 从正文提取 StoClaw outbound / 任务附件绝对路径（含可选中文展示名）。 */
export function parseStoClawOutboundPathsFromText(text: string | null | undefined): TaskComposerAttachmentRecord[] {
  if (!text?.trim()) return [];
  const byPath = new Map<string, TaskComposerAttachmentRecord>();

  for (const match of text.matchAll(STOCLAW_PATH_WITH_LABEL_RE)) {
    const sourcePath = expandHomePath(match[1] ?? '');
    const label = (match[2] ?? '').trim();
    if (!sourcePath || !isAllowedAttachmentSourcePath(sourcePath)) continue;
    if (!existsSync(sourcePath)) continue;
    const fileName = resolveAttachmentDisplayName(sourcePath, label);
    byPath.set(sourcePath, {
      fileName,
      mimeType: guessMime(fileName.includes('.') ? fileName : sourcePath),
      sourcePath,
      provenance: { kind: 'local' },
    });
  }

  for (const match of text.matchAll(STOCLAW_OUTBOUND_PATH_RE)) {
    const sourcePath = expandHomePath(match[0] ?? '');
    if (!sourcePath || !isAllowedAttachmentSourcePath(sourcePath)) continue;
    if (!existsSync(sourcePath)) continue;
    if (byPath.has(sourcePath)) continue;
    const fileName = resolveAttachmentDisplayName(sourcePath);
    byPath.set(sourcePath, {
      fileName,
      mimeType: guessMime(fileName),
      sourcePath,
      provenance: { kind: 'local' },
    });
  }

  return [...byPath.values()];
}

/** 剥掉 prompt 里被回填的 outbound 绝对路径及可选（展示名）。不剥中文「文件」叙述。 */
export function stripStoClawOutboundPathsFromText(text: string): string {
  return text
    .replace(STOCLAW_PATH_WITH_LABEL_RE, '')
    .replace(STOCLAW_OUTBOUND_PATH_RE, '')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function sanitizeFileName(name: string): string {
  return name.replace(/[\\/:*?"<>|]/g, '_').slice(0, 180) || 'file';
}

export function getScheduledTaskAttachmentsDir(taskId: string): string {
  return join(getStoClawHomeDir(), 'scheduled-tasks', taskId, 'attachments');
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * 仅允许从 StoClaw 家目录下的 staging（尤其 outbound）拷贝，防任意路径读取。
 */
export function isAllowedAttachmentSourcePath(filePath: string): boolean {
  const trimmed = filePath.trim();
  if (!trimmed) return false;
  let resolved: string;
  try {
    resolved = resolve(expandHomePath(trimmed));
  } catch {
    return false;
  }
  const root = resolve(getStoClawHomeDir());
  const normalizedRoot = normalize(`${root}/`);
  const normalizedPath = normalize(resolved);
  return normalizedPath === root || normalizedPath.startsWith(normalizedRoot);
}

/** 从 Gateway 文案解析 `[media attached: path (mime) | …]`。 */
export function parseMediaAttachedAttachments(
  text: string | null | undefined,
): TaskComposerAttachmentRecord[] {
  if (!text) return [];
  const out: TaskComposerAttachmentRecord[] = [];
  const seen = new Set<string>();
  const regex = new RegExp(MEDIA_ATTACHED_REGEX.source, MEDIA_ATTACHED_REGEX.flags);
  for (const match of text.matchAll(regex)) {
    const sourcePath = (match[1] ?? '').trim();
    const mimeType = (match[2] ?? '').trim() || 'application/octet-stream';
    if (!sourcePath || seen.has(sourcePath)) continue;
    if (!isAllowedAttachmentSourcePath(sourcePath)) continue;
    seen.add(sourcePath);
    out.push({
      fileName: basename(sourcePath) || 'file',
      mimeType,
      sourcePath,
    });
  }
  return out;
}

/** 剥掉 `[media attached:…]`，保持 prompt 干净。 */
export function stripMediaAttachedFromText(text: string): string {
  return text
    .replace(new RegExp(MEDIA_ATTACHED_REGEX.source, MEDIA_ATTACHED_REGEX.flags), '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function normalizeAttachmentInput(
  raw: unknown,
): TaskComposerAttachmentRecord[] {
  if (!Array.isArray(raw)) return [];
  const out: TaskComposerAttachmentRecord[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const record = item as Record<string, unknown>;
    const sourcePath = typeof record.sourcePath === 'string'
      ? record.sourcePath.trim()
      : typeof record.persistentPath === 'string'
        ? record.persistentPath.trim()
        : '';
    if (!sourcePath || seen.has(sourcePath)) continue;
    if (!isAllowedAttachmentSourcePath(sourcePath)) continue;
    seen.add(sourcePath);
    const fileName = typeof record.fileName === 'string' && record.fileName.trim()
      ? record.fileName.trim()
      : basename(sourcePath) || 'file';
    const mimeType = typeof record.mimeType === 'string' && record.mimeType.trim()
      ? record.mimeType.trim()
      : 'application/octet-stream';
    out.push({
      id: typeof record.id === 'string' ? record.id : undefined,
      fileName,
      mimeType,
      sourcePath,
      persistentPath: typeof record.persistentPath === 'string'
        ? record.persistentPath
        : undefined,
      provenance: normalizeAttachmentProvenance(record.provenance),
    });
  }
  return out;
}

/**
 * 合并显式 attachments + prompt 内 media 行 → extra.composerAttachments / file segments，
 * 并剥掉 prompt 里的 `[media attached:]`。
 */
export function prepareScheduledTaskAttachmentsForSave(input: {
  prompt: string;
  extra?: Record<string, unknown> | null;
  /** 顶层附件（NL 工具）；与 extra.composerAttachments 合并 */
  attachments?: unknown;
}): {
  prompt: string;
  extra: Record<string, unknown> | null;
} {
  const fromTop = normalizeAttachmentInput(input.attachments);
  const fromExtra = normalizeAttachmentInput(input.extra?.composerAttachments);
  const fromPrompt = parseMediaAttachedAttachments(input.prompt);
  // 防御：NL 模型常把 ~/.stoclaw/.../outbound 绝对路径写进正文，不经 media attached 行
  const fromOutboundPaths = parseStoClawOutboundPathsFromText(input.prompt);
  const mergedByPath = new Map<string, TaskComposerAttachmentRecord>();
  for (const att of [...fromExtra, ...fromTop, ...fromPrompt, ...fromOutboundPaths]) {
    const key = (att.sourcePath || att.persistentPath || '').trim();
    if (!key) continue;
    if (!mergedByPath.has(key)) {
      mergedByPath.set(key, {
        ...att,
        provenance: normalizeAttachmentProvenance(att.provenance),
      });
    }
  }
  const attachments = [...mergedByPath.values()];
  const prompt = stripStoClawOutboundPathsFromText(stripMediaAttachedFromText(input.prompt));

  if (attachments.length === 0) {
    if (!input.extra || typeof input.extra !== 'object') {
      return { prompt, extra: input.extra ?? null };
    }
    return { prompt, extra: { ...input.extra } };
  }

  const extra: Record<string, unknown> = {
    ...(input.extra && typeof input.extra === 'object' ? input.extra : {}),
    composerAttachments: attachments,
  };

  const existingSegments = Array.isArray(extra.composerSegments)
    ? [...(extra.composerSegments as unknown[])]
    : [];

  const fileSegments = attachments.map((att) => ({
    type: 'file' as const,
    fileName: att.fileName,
    mimeType: att.mimeType,
    fileSize: 0,
    preview: null as string | null,
    filePath: att.sourcePath,
    stagedPath: att.sourcePath,
    provenance: att.provenance,
  }));

  // UI Modal 已 bake 的交错 segments：就地补齐 file 路径，禁止 `[...files, ...rest]` 重排
  // （重排会导致编辑回填 chip 全堆前面、正文碎片连在一起，排版乱）。
  if (existingSegments.length > 0) {
    const unusedAttachments = [...attachments];
    const takeAttachment = (fileName?: string) => {
      const byName = fileName
        ? unusedAttachments.findIndex((att) => att.fileName === fileName)
        : -1;
      const index = byName >= 0 ? byName : 0;
      if (index < 0 || index >= unusedAttachments.length) return null;
      return unusedAttachments.splice(index, 1)[0] ?? null;
    };
    extra.composerSegments = existingSegments.map((seg) => {
      if (!seg || typeof seg !== 'object') return seg;
      const record = seg as {
        type?: string;
        fileName?: string;
        mimeType?: string;
        filePath?: string;
        stagedPath?: string;
        provenance?: unknown;
      };
      if (record.type !== 'file') return seg;
      const att = takeAttachment(record.fileName);
      if (!att) return seg;
      return {
        ...record,
        type: 'file' as const,
        fileName: att.fileName || record.fileName,
        mimeType: att.mimeType || record.mimeType || 'application/octet-stream',
        fileSize: 0,
        preview: null,
        filePath: att.sourcePath || att.persistentPath || record.filePath,
        stagedPath: att.sourcePath || att.persistentPath || record.stagedPath,
        provenance: att.provenance ?? record.provenance,
      };
    });
    // NL 稀疏：segments 里没有对应 file chip 时，把剩余附件补到末尾（不插队破坏顺序）
    if (unusedAttachments.length > 0) {
      const existingHadFile = existingSegments.some(
        (seg) => seg && typeof seg === 'object' && (seg as { type?: string }).type === 'file',
      );
      const extras = unusedAttachments.map((att) => ({
        type: 'file' as const,
        fileName: att.fileName,
        mimeType: att.mimeType,
        fileSize: 0,
        preview: null as string | null,
        filePath: att.sourcePath,
        stagedPath: att.sourcePath,
        provenance: att.provenance,
      }));
      extra.composerSegments = existingHadFile
        ? [...(extra.composerSegments as unknown[]), ...extras]
        : [...extras, ...(extra.composerSegments as unknown[])];
    }
  } else {
    // 无既有 segments（NL 稀疏）：用发现的附件生成 file segments
    extra.composerSegments = fileSegments;
  }

  return { prompt, extra };
}

/**
 * 将 composerAttachments 中尚未落盘到任务目录的文件复制过去，
 * 返回带 persistentPath 的新列表，并清理目录内不再引用的旧文件。
 */
export async function persistScheduledTaskAttachments(
  taskId: string,
  attachments: TaskComposerAttachmentRecord[] | undefined | null,
): Promise<TaskComposerAttachmentRecord[]> {
  const dir = getScheduledTaskAttachmentsDir(taskId);
  const list = Array.isArray(attachments) ? attachments : [];
  if (list.length === 0) {
    if (!(await pathExists(dir))) return [];
  } else {
    await mkdir(dir, { recursive: true });
  }

  const keptPaths = new Set<string>();
  const result: TaskComposerAttachmentRecord[] = [];

  for (let i = 0; i < list.length; i += 1) {
    const att = list[i];
    const id = (att.id?.trim() || `att-${i + 1}`).replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64) || `att-${i + 1}`;
    const safeName = sanitizeFileName(att.fileName || 'file');
    const targetPath = join(dir, `${id}-${safeName}`);
    const source = att.sourcePath || att.persistentPath || '';

    if (att.persistentPath && att.persistentPath === targetPath && (await pathExists(targetPath))) {
      keptPaths.add(targetPath);
      result.push({
        id,
        fileName: att.fileName,
        mimeType: att.mimeType,
        persistentPath: targetPath,
        provenance: att.provenance,
      });
      continue;
    }

    if (source) {
      const resolvedSource = resolve(expandHomePath(source));
      if (await pathExists(resolvedSource)) {
        const normalizedDir = normalize(`${dir}/`);
        const underTaskDir = resolvedSource === dir || resolvedSource.startsWith(normalizedDir);
        if (!isAllowedAttachmentSourcePath(resolvedSource) && !underTaskDir) {
          logger.warn('[scheduled-task] reject attachment source outside ~/.stoclaw', {
            taskId,
            source,
          });
          continue;
        }
        try {
          if (resolvedSource !== targetPath) {
            await copyFile(resolvedSource, targetPath);
          }
          keptPaths.add(targetPath);
          result.push({
            id,
            fileName: att.fileName,
            mimeType: att.mimeType,
            persistentPath: targetPath,
            provenance: att.provenance,
          });
        } catch (error) {
          logger.warn('[scheduled-task] persist attachment failed', {
            taskId,
            fileName: att.fileName,
            source,
            error: error instanceof Error ? error.message : String(error),
          });
          if (att.persistentPath && (await pathExists(att.persistentPath))) {
            keptPaths.add(att.persistentPath);
            result.push({
              id,
              fileName: att.fileName,
              mimeType: att.mimeType,
              persistentPath: att.persistentPath,
              provenance: att.provenance,
            });
          }
        }
        continue;
      }
    }

    if (att.persistentPath && (await pathExists(att.persistentPath))) {
      keptPaths.add(att.persistentPath);
      result.push({
        id,
        fileName: att.fileName,
        mimeType: att.mimeType,
        persistentPath: att.persistentPath,
        provenance: att.provenance,
      });
    }
  }

  try {
    const existing = await readdir(dir);
    for (const name of existing) {
      const full = join(dir, name);
      if (!keptPaths.has(full)) {
        await unlink(full).catch(() => {});
      }
    }
  } catch {
    // dir listing failure is non-fatal
  }

  return result;
}

/** 把持久化路径回写到 file segment 的 filePath/stagedPath。 */
export function rewriteComposerSegmentFilePaths(
  segments: unknown,
  attachments: TaskComposerAttachmentRecord[],
): unknown {
  if (!Array.isArray(segments)) return segments;
  let fileIndex = 0;
  return segments.map((seg) => {
    if (!seg || typeof seg !== 'object') return seg;
    const record = seg as Record<string, unknown>;
    if (record.type !== 'file') return seg;
    const att = attachments[fileIndex];
    fileIndex += 1;
    if (!att?.persistentPath) return seg;
    return {
      ...record,
      fileName: att.fileName ?? record.fileName,
      mimeType: att.mimeType ?? record.mimeType,
      filePath: att.persistentPath,
      stagedPath: att.persistentPath,
      provenance: att.provenance ?? record.provenance,
    };
  });
}

export function buildMediaFromComposerAttachments(
  extra: Record<string, unknown> | null | undefined,
): Array<{ filePath: string; mimeType: string; fileName: string }> {
  const raw = extra?.composerAttachments;
  if (!Array.isArray(raw)) return [];
  const media: Array<{ filePath: string; mimeType: string; fileName: string }> = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const record = item as TaskComposerAttachmentRecord;
    const filePath = record.persistentPath?.trim();
    if (!filePath) continue;
    media.push({
      filePath,
      mimeType: record.mimeType || 'application/octet-stream',
      fileName: record.fileName || basename(filePath),
    });
  }
  return media;
}
