/**
 * Main-process message enrich: patch Gateway tool-result messages so that
 * bare file basenames become absolute paths before the renderer sees them.
 *
 * This is the "Gateway should have done this" layer — short-term fix until
 * OpenClaw upstream emits `outputFiles` with full paths.
 */

import { join, basename } from 'node:path';
import { existsSync } from 'node:fs';
import { resolveWorkspaceFilePath } from '../utils/artifact-path';
import { logger } from '../utils/logger';
import { parseToolWorkspaceHints } from '../../shared/tool-workspace-hints';
import {
  formatPreviewExtractLogMessage,
  truncatePreviewExtractExcerpt,
  type PreviewExtractTraceEvent,
} from '../../shared/preview-extract-trace';

function traceGatewayEnrich(event: PreviewExtractTraceEvent): void {
  logger.info(formatPreviewExtractLogMessage(event), event);
}

// ── Session-level runDir cache ─────────────────────────────────────
// Map<sessionKey, runDir> — tracks the most recent Python run directory per session.
const runDirCache = new Map<string, string>();

export function cacheRunDir(sessionKey: string, runDir: string): void {
  runDirCache.set(sessionKey, runDir);
  logger.debug('[enrich] cached runDir for session', sessionKey, runDir);
}

export function getCachedRunDir(sessionKey: string): string | undefined {
  return runDirCache.get(sessionKey);
}

// ── Extract runDir / cwd / files from tool result JSON ───────────

function extractRunDirFromPayload(payload: unknown): string | undefined {
  if (!payload || typeof payload !== 'object') return undefined;
  const p = payload as Record<string, unknown>;

  // Direct runDir / cwd fields
  const runDir = p.runDir ?? p.run_dir ?? p.cwd;
  if (typeof runDir === 'string' && runDir.length > 0) return runDir;

  // Nested in result object
  const result = p.result ?? p.output ?? p.data;
  if (result && typeof result === 'object') {
    const r = result as Record<string, unknown>;
    const nestedRunDir = r.runDir ?? r.run_dir ?? r.cwd;
    if (typeof nestedRunDir === 'string' && nestedRunDir.length > 0) return nestedRunDir;
  }

  return undefined;
}

function extractFilesFromPayload(payload: unknown): string[] | undefined {
  if (!payload || typeof payload !== 'object') return undefined;
  const p = payload as Record<string, unknown>;

  const files = p.files ?? p.outputFiles ?? p.output_files ?? p.attachments;
  if (Array.isArray(files)) {
    return files
      .filter((f): f is string => typeof f === 'string')
      .filter((f) => f.length > 0);
  }

  // Nested
  const result = p.result ?? p.output ?? p.data;
  if (result && typeof result === 'object') {
    const r = result as Record<string, unknown>;
    const nestedFiles = r.files ?? r.outputFiles ?? r.output_files ?? r.attachments;
    if (Array.isArray(nestedFiles)) {
      return nestedFiles
        .filter((f): f is string => typeof f === 'string')
        .filter((f) => f.length > 0);
    }
  }

  return undefined;
}

// ── Path helpers ───────────────────────────────────────────────────

function isAbsoluteOrFileUrl(path: string): boolean {
  if (path.startsWith('/')) return true;
  if (path.startsWith('file://')) return true;
  if (/^[A-Za-z]:[\\/]/.test(path)) return true;
  return false;
}

function resolveBareFilePath(fileName: string, runDir: string | undefined): string | undefined {
  if (isAbsoluteOrFileUrl(fileName)) return fileName;
  if (runDir) {
    const fullPath = join(runDir, fileName);
    if (existsSync(fullPath)) return fullPath;
  }
  const resolved = resolveWorkspaceFilePath(fileName);
  if (resolved && existsSync(resolved)) return resolved;
  return runDir ? join(runDir, fileName) : resolved;
}

// ── Media attached regex ──────────────────────────────────────────

const MEDIA_ATTACHED_REGEX = /\[media attached:\s*([^\n\r(]+?)\s*\(([^)]+)\)\s*\|\s*([^\]]*)\]/g;

// ── Enrich a single message content string ─────────────────────────

function enrichContentString(content: string, sessionKey: string): string {
  const runDir = getCachedRunDir(sessionKey);

  return content.replace(MEDIA_ATTACHED_REGEX, (match, filePath, mimeType, displayName) => {
    const filePathStr = filePath.trim();

    // Already absolute — skip
    if (isAbsoluteOrFileUrl(filePathStr)) return match;

    // No extension — likely a directory or junk, skip enrichment
    const fileName = basename(filePathStr);
    if (!fileName.includes('.')) {
      traceGatewayEnrich({
        source: 'gateway-enrich:media-attached',
        reason: 'skipped enrich: basename has no file extension',
        extracted: { filePath: filePathStr, fileName, mimeType: String(mimeType).trim() },
        excerpt: truncatePreviewExtractExcerpt(match),
        context: { sessionKey, action: 'skip' },
      });
      return match;
    }

    const resolved = resolveBareFilePath(filePathStr, runDir);
    if (!resolved || resolved === filePathStr) {
      traceGatewayEnrich({
        source: 'gateway-enrich:media-attached',
        reason: 'skipped enrich: could not resolve basename to existing file',
        extracted: { filePath: filePathStr, fileName, mimeType: String(mimeType).trim() },
        excerpt: truncatePreviewExtractExcerpt(match),
        context: { sessionKey, runDir, action: 'skip' },
      });
      return match;
    }

    traceGatewayEnrich({
      source: 'gateway-enrich:media-attached',
      reason: 'enriched basename to absolute path before IPC broadcast',
      extracted: {
        filePath: resolved,
        fileName: basename(resolved),
        mimeType: String(mimeType).trim(),
      },
      excerpt: truncatePreviewExtractExcerpt(match),
      context: {
        sessionKey,
        runDir,
        before: filePathStr,
        after: resolved,
        action: 'rewrite',
      },
    });

    return `[media attached: ${resolved} (${mimeType}) | ${displayName.trim()}]`;
  });
}

// ── Enrich a message object (JSON-RPC notification params) ─────────

export function enrichMessageFilePaths(message: unknown, sessionKey: string): unknown {
  if (!message || typeof message !== 'object') return message;
  const msg = message as Record<string, unknown>;

  const hints = parseToolWorkspaceHints(msg.content ?? msg);
  let runDir = hints.runDir || hints.cwd || hints.outputDir;

  // If this is a tool_result / tool output, extract and cache runDir
  const payload = (msg as { payload?: unknown; params?: unknown; result?: unknown }).payload
    ?? (msg as { params?: unknown }).params
    ?? (msg as { result?: unknown }).result;
  if (!runDir) {
    runDir = extractRunDirFromPayload(payload);
  }
  if (runDir) {
    cacheRunDir(sessionKey, runDir);
  }

  // 2. Extract files from payload and cache them too
  const files = extractFilesFromPayload(payload);
  if (files && runDir) {
    for (const f of files) {
      if (!isAbsoluteOrFileUrl(f)) {
        // Cache the mapping: basename → full path for this session
        const fullPath = join(runDir, f);
        if (existsSync(fullPath)) {
          logger.debug('[enrich] mapped file', f, '→', fullPath);
        }
      }
    }
  }

  // 3. Enrich content string if present
  const content = msg.content;
  if (typeof content === 'string') {
    const enriched = enrichContentString(content, sessionKey);
    if (enriched !== content) {
      return { ...msg, content: enriched };
    }
  }

  // 4. Enrich content array (Anthropic/Gateway format)
  if (Array.isArray(content)) {
    const enrichedBlocks = (content as Array<Record<string, unknown>>).map((block) => {
      if (block.type === 'text' && typeof block.text === 'string') {
        const enrichedText = enrichContentString(block.text, sessionKey);
        if (enrichedText !== block.text) {
          return { ...block, text: enrichedText };
        }
      }
      return block;
    });
    const changed = enrichedBlocks.some((b, i) => b !== content[i]);
    if (changed) {
      return { ...msg, content: enrichedBlocks };
    }
  }

  return message;
}

// ── Enrich a notification params object ───────────────────────────

export function enrichNotificationParams(params: unknown, sessionKey: string): unknown {
  if (!params || typeof params !== 'object') return params;

  const p = params as Record<string, unknown>;
  let next: Record<string, unknown> | null = null;

  if (p.message && typeof p.message === 'object') {
    const enriched = enrichMessageFilePaths(p.message, sessionKey);
    if (enriched !== p.message) {
      next = { ...(next ?? p), message: enriched };
    }
  }

  if (p.data && typeof p.data === 'object') {
    const data = p.data as Record<string, unknown>;
    if (data.message && typeof data.message === 'object') {
      const enriched = enrichMessageFilePaths(data.message, sessionKey);
      if (enriched !== data.message) {
        next = { ...(next ?? p), data: { ...data, message: enriched } };
      }
    }
  }

  return next ?? params;
}

function readSessionKey(record: Record<string, unknown>): string {
  const key = record.sessionKey ?? record.sessionId;
  return typeof key === 'string' && key.trim() ? key.trim() : '';
}

function extractSessionKey(payload: unknown): string {
  if (!payload || typeof payload !== 'object') return '';
  const root = payload as Record<string, unknown>;

  const direct = readSessionKey(root);
  if (direct) return direct;

  const params = root.params;
  if (params && typeof params === 'object') {
    const p = params as Record<string, unknown>;
    const fromParams = readSessionKey(p);
    if (fromParams) return fromParams;
    const data = p.data;
    if (data && typeof data === 'object') {
      const fromData = readSessionKey(data as Record<string, unknown>);
      if (fromData) return fromData;
    }
  }

  return '';
}

/** Enrich a Gateway broadcast payload before IPC to renderer. */
export function enrichGatewayPayload(payload: unknown): unknown {
  if (!payload || typeof payload !== 'object') return payload;

  const root = payload as Record<string, unknown>;
  const sessionKey = extractSessionKey(payload) || '__global__';

  if (root.params && typeof root.params === 'object') {
    const enrichedParams = enrichNotificationParams(root.params, sessionKey);
    if (enrichedParams !== root.params) {
      return { ...root, params: enrichedParams };
    }
  }

  if (root.message && typeof root.message === 'object') {
    const enrichedMessage = enrichMessageFilePaths(root.message, sessionKey);
    if (enrichedMessage !== root.message) {
      return { ...root, message: enrichedMessage };
    }
  }

  if (root.role != null || root.content != null) {
    return enrichMessageFilePaths(root, sessionKey);
  }

  return payload;
}
