/**
 * Three-way source merge for Site App collaboration (no local Git).
 * Markers and hunk rules match git merge, with Local / Remote labels.
 */

export const CONFLICT_OURS_MARK = '<<<<<<< Local';
export const CONFLICT_MID_MARK = '=======';
export const CONFLICT_THEIRS_MARK = '>>>>>>> Remote';

export const STO_MERGE_RELATIVE = '.sto/merge';
export const STO_BASE_SNAPSHOT_RELATIVE = '.sto/base-snapshot';

export type SourceConflictKind = 'text' | 'binary' | 'add-delete';
export type SourceConflictStatus = 'unresolved' | 'resolved';

export type SourcePullClientAction =
  | 'already-synced'
  | 'local-ahead'
  | 'applied'
  | 'merged'
  | 'conflicts';

export interface SourceConflictFile {
  path: string;
  kind: SourceConflictKind;
  status: SourceConflictStatus;
}

export interface MergeTextResult {
  text: string;
  conflicted: boolean;
}

export interface FileMergeInput {
  path: string;
  base: Buffer | null;
  ours: Buffer | null;
  theirs: Buffer | null;
}

export type FileMergeAction = 'keep-ours' | 'take-theirs' | 'delete' | 'write' | 'conflict';

export interface FileMergeOutput {
  path: string;
  action: FileMergeAction;
  kind?: SourceConflictKind;
  content?: Buffer;
}

const TEXT_MERGE_MAX_LINES = 4_000;
const TEXT_MERGE_MAX_BYTES = 2 * 1024 * 1024;

const BINARY_EXTENSIONS = new Set([
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'ico', 'bmp', 'pdf',
  'woff', 'woff2', 'ttf', 'otf', 'eot',
  'zip', 'gz', 'tgz', 'wasm', 'mp3', 'mp4', 'webm',
]);

export function hasConflictMarkers(text: string): boolean {
  return text.includes(CONFLICT_OURS_MARK);
}

export function isBinaryPath(path: string): boolean {
  const ext = path.split('.').pop()?.toLowerCase() ?? '';
  return BINARY_EXTENSIONS.has(ext);
}

export function isBinaryBuffer(buffer: Buffer): boolean {
  if (buffer.length > TEXT_MERGE_MAX_BYTES) return true;
  return buffer.includes(0);
}

export function formatConflictText(ours: string, theirs: string): string {
  const oursBody = ours.endsWith('\n') || ours.length === 0 ? ours : `${ours}\n`;
  const theirsBody = theirs.endsWith('\n') || theirs.length === 0 ? theirs : `${theirs}\n`;
  return `${CONFLICT_OURS_MARK}\n${oursBody}${CONFLICT_MID_MARK}\n${theirsBody}${CONFLICT_THEIRS_MARK}\n`;
}

interface LineHunk {
  baseStart: number;
  baseEnd: number;
  sideStart: number;
  sideEnd: number;
}

function splitLines(text: string): string[] {
  if (text.length === 0) return [];
  const parts = text.split('\n');
  if (parts.length > 0 && parts[parts.length - 1] === '') parts.pop();
  return parts;
}

function joinLines(lines: string[]): string {
  if (lines.length === 0) return '';
  return `${lines.join('\n')}\n`;
}

function diffOps(base: string[], side: string[]): Array<'eq' | 'del' | 'ins'> {
  const n = base.length;
  const m = side.length;
  const dp: Uint16Array[] = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      dp[i][j] = base[i] === side[j]
        ? (dp[i + 1][j + 1] + 1)
        : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const ops: Array<'eq' | 'del' | 'ins'> = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (base[i] === side[j]) {
      ops.push('eq');
      i += 1;
      j += 1;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      ops.push('del');
      i += 1;
    } else {
      ops.push('ins');
      j += 1;
    }
  }
  while (i < n) {
    ops.push('del');
    i += 1;
  }
  while (j < m) {
    ops.push('ins');
    j += 1;
  }
  return ops;
}

function changeHunks(ops: Array<'eq' | 'del' | 'ins'>): LineHunk[] {
  const hunks: LineHunk[] = [];
  let baseIndex = 0;
  let sideIndex = 0;
  let offset = 0;
  while (offset < ops.length) {
    if (ops[offset] === 'eq') {
      baseIndex += 1;
      sideIndex += 1;
      offset += 1;
      continue;
    }
    const baseStart = baseIndex;
    const sideStart = sideIndex;
    while (offset < ops.length && ops[offset] !== 'eq') {
      if (ops[offset] === 'del') baseIndex += 1;
      else sideIndex += 1;
      offset += 1;
    }
    hunks.push({
      baseStart,
      baseEnd: baseIndex,
      sideStart,
      sideEnd: sideIndex,
    });
  }
  return hunks;
}

function applyHunksToRange(
  base: string[],
  side: string[],
  hunks: LineHunk[],
  start: number,
  end: number,
): string[] {
  const out: string[] = [];
  let cursor = start;
  for (const hunk of hunks) {
    if (hunk.baseEnd <= start || hunk.baseStart >= end) continue;
    while (cursor < hunk.baseStart) {
      out.push(base[cursor]);
      cursor += 1;
    }
    out.push(...side.slice(hunk.sideStart, hunk.sideEnd));
    cursor = hunk.baseEnd;
  }
  while (cursor < end) {
    out.push(base[cursor]);
    cursor += 1;
  }
  return out;
}

function mergeLinesDiff3(base: string[], ours: string[], theirs: string[]): MergeTextResult {
  const oursHunks = changeHunks(diffOps(base, ours));
  const theirsHunks = changeHunks(diffOps(base, theirs));
  const result: string[] = [];
  let conflicted = false;
  let cursor = 0;
  let oursIndex = 0;
  let theirsIndex = 0;

  const takeEqual = (until: number) => {
    while (cursor < until) {
      result.push(base[cursor]);
      cursor += 1;
    }
  };

  while (oursIndex < oursHunks.length || theirsIndex < theirsHunks.length) {
    const oursHunk = oursHunks[oursIndex];
    const theirsHunk = theirsHunks[theirsIndex];
    if (oursHunk && (!theirsHunk || oursHunk.baseEnd <= theirsHunk.baseStart)) {
      takeEqual(oursHunk.baseStart);
      result.push(...ours.slice(oursHunk.sideStart, oursHunk.sideEnd));
      cursor = oursHunk.baseEnd;
      oursIndex += 1;
      continue;
    }
    if (theirsHunk && (!oursHunk || theirsHunk.baseEnd <= oursHunk.baseStart)) {
      takeEqual(theirsHunk.baseStart);
      result.push(...theirs.slice(theirsHunk.sideStart, theirsHunk.sideEnd));
      cursor = theirsHunk.baseEnd;
      theirsIndex += 1;
      continue;
    }

    let regionStart = Math.min(oursHunk.baseStart, theirsHunk.baseStart);
    let regionEnd = Math.max(oursHunk.baseEnd, theirsHunk.baseEnd);
    let nextOurs = oursIndex;
    let nextTheirs = theirsIndex;
    let expanding = true;
    while (expanding) {
      expanding = false;
      while (nextOurs < oursHunks.length && oursHunks[nextOurs].baseStart < regionEnd) {
        regionEnd = Math.max(regionEnd, oursHunks[nextOurs].baseEnd);
        nextOurs += 1;
        expanding = true;
      }
      while (nextTheirs < theirsHunks.length && theirsHunks[nextTheirs].baseStart < regionEnd) {
        regionEnd = Math.max(regionEnd, theirsHunks[nextTheirs].baseEnd);
        nextTheirs += 1;
        expanding = true;
      }
    }

    takeEqual(regionStart);
    const oursLines = applyHunksToRange(base, ours, oursHunks, regionStart, regionEnd);
    const theirsLines = applyHunksToRange(base, theirs, theirsHunks, regionStart, regionEnd);
    if (oursLines.join('\n') === theirsLines.join('\n')) {
      result.push(...oursLines);
    } else {
      conflicted = true;
      result.push(CONFLICT_OURS_MARK, ...oursLines, CONFLICT_MID_MARK, ...theirsLines, CONFLICT_THEIRS_MARK);
    }
    cursor = regionEnd;
    oursIndex = nextOurs;
    theirsIndex = nextTheirs;
  }

  takeEqual(base.length);
  return { text: joinLines(result), conflicted };
}

export function mergeTextThreeWay(base: string | null, ours: string, theirs: string): MergeTextResult {
  if (ours === theirs) return { text: ours, conflicted: false };
  if (base != null && ours === base) return { text: theirs, conflicted: false };
  if (base != null && theirs === base) return { text: ours, conflicted: false };
  if (base == null) {
    return { text: formatConflictText(ours, theirs), conflicted: true };
  }

  const baseLines = splitLines(base);
  const oursLines = splitLines(ours);
  const theirsLines = splitLines(theirs);
  if (
    baseLines.length > TEXT_MERGE_MAX_LINES
    || oursLines.length > TEXT_MERGE_MAX_LINES
    || theirsLines.length > TEXT_MERGE_MAX_LINES
  ) {
    return { text: formatConflictText(ours, theirs), conflicted: true };
  }
  return mergeLinesDiff3(baseLines, oursLines, theirsLines);
}

function buffersEqual(left: Buffer, right: Buffer): boolean {
  return left.length === right.length && left.equals(right);
}

export function classifyFileMerge(input: FileMergeInput): FileMergeOutput {
  const { path, base, ours, theirs } = input;
  if (!ours && !theirs) return { path, action: 'delete' };
  if (ours && theirs && buffersEqual(ours, theirs)) return { path, action: 'keep-ours' };

  if (!ours && theirs) {
    if (!base) return { path, action: 'take-theirs', content: theirs };
    if (buffersEqual(base, theirs)) return { path, action: 'delete' };
    return { path, action: 'conflict', kind: 'add-delete' };
  }

  if (ours && !theirs) {
    if (!base) return { path, action: 'keep-ours' };
    if (buffersEqual(base, ours)) return { path, action: 'delete' };
    return { path, action: 'conflict', kind: 'add-delete' };
  }

  if (base && buffersEqual(ours!, base)) return { path, action: 'take-theirs', content: theirs! };
  if (base && buffersEqual(theirs!, base)) return { path, action: 'keep-ours' };

  const binary = isBinaryPath(path)
    || isBinaryBuffer(ours!)
    || isBinaryBuffer(theirs!)
    || (base != null && isBinaryBuffer(base));
  if (binary) return { path, action: 'conflict', kind: 'binary' };

  const merged = mergeTextThreeWay(
    base ? base.toString('utf8') : null,
    ours!.toString('utf8'),
    theirs!.toString('utf8'),
  );
  const content = Buffer.from(merged.text, 'utf8');
  if (!merged.conflicted) return { path, action: 'write', content };
  return { path, action: 'conflict', kind: 'text', content };
}

export function pullToastMessage(
  action: SourcePullClientAction | string | undefined,
  conflictCount = 0,
): { kind: 'success' | 'message'; text: string } {
  switch (action) {
    case 'already-synced':
      return { kind: 'success', text: '已是最新' };
    case 'local-ahead':
      return { kind: 'message', text: '本地已有未提交改动，未覆盖本地代码。请直接提交。' };
    case 'applied':
      return { kind: 'success', text: '已拉取远端更新' };
    case 'merged':
      return { kind: 'success', text: '已合并远端更新，请检查后提交' };
    case 'conflicts':
      return { kind: 'message', text: `有 ${conflictCount} 个文件需要处理：用我的 / 用远端 / 编辑` };
    default:
      return { kind: 'success', text: '拉取成功' };
  }
}
