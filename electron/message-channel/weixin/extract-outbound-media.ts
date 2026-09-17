/**
 * Extract local media file paths from assistant answer text for Weixin outbound.
 * Matches Markdown file:// links, bare file:// URLs, and absolute/workspace paths
 * ending with known media extensions (including backtick / Chinese-colon wrapped paths).
 */

import { existsSync } from 'node:fs';
import { basename, extname } from 'node:path';
import { resolveWorkspaceFilePath } from '../../utils/artifact-path';

const MEDIA_EXTS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp',
  '.mp4', '.mov', '.webm', '.mkv',
  '.mp3', '.ogg', '.wav',
  '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx',
  '.html', '.htm',
  '.zip', '.txt', '.csv', '.md',
]);

const EXT_ALT = [...MEDIA_EXTS].map((e) => e.slice(1)).join('|');

const FILE_URL_RE = /\[([^\]]*)\]\((file:\/\/\/?[^)\s]+)\)/gi;
const BARE_FILE_URL_RE = /(?<!\]\()(file:\/\/\/[^\s)\]>"'`]+)/gi;
/** Absolute paths ending with a known media extension (Unix + Windows). */
const ABS_MEDIA_PATH_RE = new RegExp(
  `(?<![A-Za-z0-9_./\\\\-])((?:/(?:Users|home|tmp|var|Volumes)[^\\s\\\`'\"<>）】\\]]+?\\.(?:${EXT_ALT}))|(?:[A-Za-z]:[\\\\/][^\\s\\\`'\"<>）】\\]]+?\\.(?:${EXT_ALT})))`,
  'gi',
);
/** Workspace-relative output paths like .claw-output/foo.mp3 */
const REL_OUTPUT_MEDIA_RE = new RegExp(
  `(?<![A-Za-z0-9_./\\\\-])((?:\\.?/?\\.claw-output|\\.?/?outputs?|\\.?/?output)/[^\\s\\\`'\"<>）】\\]]+?\\.(?:${EXT_ALT}))`,
  'gi',
);

function fileUrlToPath(url: string): string {
  try {
    const u = new URL(url);
    if (u.protocol !== 'file:') return url;
    let p = decodeURIComponent(u.pathname);
    if (/^\/[A-Za-z]:\//.test(p)) p = p.slice(1);
    return p;
  } catch {
    return url.replace(/^file:\/\//, '');
  }
}

function cleanPathCandidate(raw: string): string {
  return raw
    .trim()
    .replace(/^[`'"“”‘’]+/, '')
    .replace(/[`'"“”‘’]+$/, '')
    .replace(/[，。；;]+$/, '');
}

function isMediaPath(filePath: string): boolean {
  return MEDIA_EXTS.has(extname(filePath).toLowerCase());
}

function resolveExisting(raw: string): string | null {
  const trimmed = cleanPathCandidate(raw);
  if (!trimmed) return null;
  try {
    const resolved = resolveWorkspaceFilePath(trimmed);
    if (existsSync(resolved) && isMediaPath(resolved)) return resolved;
  } catch {
    // ignore
  }
  if (existsSync(trimmed) && isMediaPath(trimmed)) return trimmed;
  return null;
}

export type ExtractedOutboundMedia = {
  /** Answer text with media markdown/paths removed (may be empty). */
  text: string;
  filePaths: string[];
};

/**
 * Parse assistant answer → local media paths + remaining text.
 */
export function extractOutboundMediaFromAnswer(answer: string): ExtractedOutboundMedia {
  let text = answer;
  const found: string[] = [];
  const seen = new Set<string>();

  const push = (raw: string) => {
    const path = resolveExisting(raw);
    if (!path || seen.has(path)) return;
    seen.add(path);
    found.push(path);
  };

  text = text.replace(FILE_URL_RE, (_m, _label: string, url: string) => {
    push(fileUrlToPath(url));
    return '';
  });

  text = text.replace(BARE_FILE_URL_RE, (_m, url: string) => {
    push(fileUrlToPath(url));
    return '';
  });

  text = text.replace(ABS_MEDIA_PATH_RE, (m, pathPart: string) => {
    const resolved = resolveExisting(pathPart);
    if (!resolved) return m;
    push(pathPart);
    return m.replace(pathPart, '');
  });

  text = text.replace(REL_OUTPUT_MEDIA_RE, (m, pathPart: string) => {
    const resolved = resolveExisting(pathPart);
    if (!resolved) return m;
    push(pathPart);
    return m.replace(pathPart, '');
  });

  text = text
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]+\n/g, '\n')
    .trim();

  return { text, filePaths: found };
}

export function mediaFileLabel(filePath: string): string {
  return basename(filePath);
}
