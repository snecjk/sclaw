/**
 * AppDev 工具调用聚合（P1 交互改造 T02）
 *
 * 把一轮生成中的 ToolStatus[] 聚合为文件级增删行统计 / 命令 / 读取 / 其他，
 * 供流式摘要行（AppDevToolRollupLine）与轮次汇总卡（AppDevTurnSummaryCard）使用。
 *
 * 纯函数、零引擎改动：Edit/Write 的 file_path/old_string/new_string/content
 * 已由 ToolStatus.input 流式携带（src/stores/chat/types.ts）。
 * 只统计 status === 'completed' 的工具（running/error 的 input 可能不完整）。
 */
import type { RawMessage, ToolStatus } from '@/stores/chat';
import {
  readTurnStreamingToolsCache,
  type CachedTurnStreamingTool,
} from '@/lib/thinking-turn-tools-cache';
import { resolveDoneTurnStreamingTools } from '@/lib/thinking-done-tools';
import { buildTurnDisplayCacheKey } from '@/pages/Chat/thinking/segment-merge';
import { buildTurnStableKey } from '@/pages/Chat/chat-display';

export type AppDevToolKind = 'file' | 'command' | 'read' | 'other';

export interface AppDevFileRollup {
  path: string;
  added: number;
  removed: number;
  /** 该文件上的文件操作次数（同文件多次编辑会合并）。 */
  ops: number;
  hasCreate: boolean;
  hasEdit: boolean;
  /** 最近 N 次编辑原文（供对话内 inline diff；cap 防膨胀）。 */
  edits: AppDevEditSnippet[];
}

export interface AppDevEditSnippet {
  oldText: string;
  newText: string;
}

export interface AppDevCommandRollup {
  cmd: string;
}

export interface AppDevToolRollupTotals {
  added: number;
  removed: number;
  fileOps: number;
  commands: number;
  reads: number;
  others: number;
  /** 参与聚合的 completed 工具总数（汇总卡「已处理 N 个任务」口径）。 */
  completedTools: number;
}

export interface AppDevToolRollup {
  files: AppDevFileRollup[];
  commands: AppDevCommandRollup[];
  reads: number;
  others: number;
  totals: AppDevToolRollupTotals;
}

export interface AppDevFileOpStat {
  path: string | null;
  added: number;
  removed: number;
  isCreate: boolean;
  edits: AppDevEditSnippet[];
}

const FILE_OP_RE = /edit|write|create|multi_edit/i;
const COMMAND_RE = /bash|shell|command|run/i;
const READ_RE = /read|grep|glob|search/i;
const MAX_EDITS_PER_FILE = 3;
const MAX_EDIT_TEXT_CHARS = 8_192;

function capEditText(text: string): string {
  return text.length > MAX_EDIT_TEXT_CHARS ? text.slice(0, MAX_EDIT_TEXT_CHARS) : text;
}

function pushEdit(
  edits: AppDevEditSnippet[],
  oldText: string,
  newText: string,
): void {
  edits.push({ oldText: capEditText(oldText), newText: capEditText(newText) });
  while (edits.length > MAX_EDITS_PER_FILE) edits.shift();
}

/** 工具名归类：文件操作 / 命令 / 读取 / 其他（未知引擎工具名归"其他"）。 */
export function classifyAppDevTool(name: string): AppDevToolKind {
  if (FILE_OP_RE.test(name)) return 'file';
  if (COMMAND_RE.test(name)) return 'command';
  if (READ_RE.test(name)) return 'read';
  return 'other';
}

/** 流式 input 可能是 JSON 字符串；解析失败（不完整）时返回 null 跳过一次统计。 */
function normalizeToolInput(input: unknown): Record<string, unknown> | null {
  if (input == null) return null;
  if (typeof input === 'string') {
    const trimmed = input.trim();
    if (!trimmed) return null;
    try {
      const parsed: unknown = JSON.parse(trimmed);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
      return null;
    } catch {
      return null;
    }
  }
  if (typeof input === 'object' && !Array.isArray(input)) {
    return input as Record<string, unknown>;
  }
  return null;
}

function pickString(args: Record<string, unknown>, keys: readonly string[]): string | null {
  for (const key of keys) {
    const value = args[key];
    if (typeof value === 'string' && value) return value;
  }
  return null;
}

/** 行数统计：空串 0 行；"a\nb" 2 行；结尾换行不多计。 */
export function countAppDevLines(text: string): number {
  if (!text) return 0;
  let breaks = 0;
  for (let i = 0; i < text.length; i += 1) {
    if (text.charCodeAt(i) === 10) breaks += 1;
  }
  return text.endsWith('\n') ? breaks : breaks + 1;
}

function splitLines(text: string): string[] {
  if (!text) return [];
  const lines = text.split('\n');
  if (lines.length > 0 && lines[lines.length - 1] === '' && text.endsWith('\n')) {
    lines.pop();
  }
  return lines;
}

/**
 * 编辑增删行：裁掉 old/new 的公共前后缀行后，剩余行数即 +/−。
 * 与 git numstat 在连续改动块场景下口径一致（优于直接拿两侧总行数）。
 */
export function diffAppDevLineCounts(oldText: string, newText: string): { added: number; removed: number } {
  const oldLines = splitLines(oldText);
  const newLines = splitLines(newText);
  let prefix = 0;
  const maxPrefix = Math.min(oldLines.length, newLines.length);
  while (prefix < maxPrefix && oldLines[prefix] === newLines[prefix]) prefix += 1;
  let suffix = 0;
  while (
    suffix < maxPrefix - prefix
    && oldLines[oldLines.length - 1 - suffix] === newLines[newLines.length - 1 - suffix]
  ) {
    suffix += 1;
  }
  return {
    added: newLines.length - prefix - suffix,
    removed: oldLines.length - prefix - suffix,
  };
}

export type AppDevDiffLine = { type: 'same' | 'add' | 'del'; text: string };

/** 与 diffAppDevLineCounts 同口径的行级 diff（前后缀 same + 中间 del/add）。 */
export function buildAppDevLineDiff(oldText: string, newText: string): AppDevDiffLine[] {
  const oldLines = splitLines(oldText);
  const newLines = splitLines(newText);
  let prefix = 0;
  const maxPrefix = Math.min(oldLines.length, newLines.length);
  while (prefix < maxPrefix && oldLines[prefix] === newLines[prefix]) prefix += 1;
  let suffix = 0;
  while (
    suffix < maxPrefix - prefix
    && oldLines[oldLines.length - 1 - suffix] === newLines[newLines.length - 1 - suffix]
  ) {
    suffix += 1;
  }
  const lines: AppDevDiffLine[] = [];
  for (let i = 0; i < prefix; i += 1) {
    lines.push({ type: 'same', text: oldLines[i]! });
  }
  for (let i = prefix; i < oldLines.length - suffix; i += 1) {
    lines.push({ type: 'del', text: oldLines[i]! });
  }
  for (let i = prefix; i < newLines.length - suffix; i += 1) {
    lines.push({ type: 'add', text: newLines[i]! });
  }
  for (let i = oldLines.length - suffix; i < oldLines.length; i += 1) {
    lines.push({ type: 'same', text: oldLines[i]! });
  }
  return lines;
}

/** 提取单个文件操作的增删行统计；input 不完整/无法识别时返回 null。 */
export function extractAppDevFileOpStat(tool: Pick<ToolStatus, 'name' | 'input'>): AppDevFileOpStat | null {
  if (classifyAppDevTool(tool.name) !== 'file') return null;
  const args = normalizeToolInput(tool.input);
  if (!args) return null;
  const path = pickString(args, ['file_path', 'filePath', 'path', 'file']);
  const isCreate = /write|create/i.test(tool.name) && !/edit/i.test(tool.name);

  // MultiEdit：edits[] 逐项求和
  const edits = args.edits;
  if (Array.isArray(edits)) {
    let added = 0;
    let removed = 0;
    let counted = false;
    const snippets: AppDevEditSnippet[] = [];
    for (const edit of edits) {
      if (!edit || typeof edit !== 'object') continue;
      const entry = edit as Record<string, unknown>;
      const oldString = typeof entry.old_string === 'string' ? entry.old_string : null;
      const newString = typeof entry.new_string === 'string' ? entry.new_string : null;
      if (oldString === null && newString === null) continue;
      const diff = diffAppDevLineCounts(oldString ?? '', newString ?? '');
      added += diff.added;
      removed += diff.removed;
      pushEdit(snippets, oldString ?? '', newString ?? '');
      counted = true;
    }
    if (!counted) return path ? { path, added: 0, removed: 0, isCreate: false, edits: [] } : null;
    return { path, added, removed, isCreate: false, edits: snippets };
  }

  // Edit：old_string / new_string
  const oldString = typeof args.old_string === 'string' ? args.old_string : null;
  const newString = typeof args.new_string === 'string' ? args.new_string : null;
  if (oldString !== null || newString !== null) {
    const diff = diffAppDevLineCounts(oldString ?? '', newString ?? '');
    const snippets: AppDevEditSnippet[] = [];
    pushEdit(snippets, oldString ?? '', newString ?? '');
    return { path, added: diff.added, removed: diff.removed, isCreate: false, edits: snippets };
  }

  // Write/Create：content 全计 +
  const content = typeof args.content === 'string' ? args.content : null;
  if (content !== null) {
    const snippets: AppDevEditSnippet[] = [];
    pushEdit(snippets, '', content);
    return { path, added: countAppDevLines(content), removed: 0, isCreate: true, edits: snippets };
  }

  return path ? { path, added: 0, removed: 0, isCreate, edits: [] } : null;
}

/** 去掉 `cd /abs/path &&` 前缀，露出真正执行的命令（对齐 Cursor 终端摘要）。 */
export function shortenAppDevCommandDisplay(command: string): string {
  const trimmed = command.trim();
  if (!trimmed) return trimmed;
  const stripped = trimmed.replace(/^(?:cd\s+(?:'[^']+'|"[^"]+"|\S+)\s*(?:&&|;)\s*)+/i, '').trim();
  return stripped || trimmed;
}

/** 提取命令文本（Bash 类）：command 字段首行，兜底 summary / 工具名。 */
export function extractAppDevCommandLabel(
  tool: Pick<ToolStatus, 'name' | 'input' | 'summary'>,
): string {
  const args = normalizeToolInput(tool.input);
  const raw = args
    ? pickString(args, ['command', 'cmd', 'script'])
    : null;
  const firstLine = (raw ?? '').split('\n').map((line) => line.trim()).find(Boolean);
  const label = firstLine ?? (typeof tool.summary === 'string' && tool.summary.trim() ? tool.summary.trim() : tool.name);
  const shortened = shortenAppDevCommandDisplay(label);
  return shortened.length > 60 ? `${shortened.slice(0, 59)}…` : shortened;
}

export function appDevToolBaseName(path: string): string {
  const segments = path.split(/[\\/]/).filter(Boolean);
  return segments[segments.length - 1] ?? path;
}

/** 文件操作的中文动词：纯创建 → 创建，其余 → 编辑。 */
export function appDevFileOpVerb(file: Pick<AppDevFileRollup, 'hasCreate' | 'hasEdit'>): string {
  return file.hasCreate && !file.hasEdit ? '创建' : '编辑';
}

/** 单个工具的一行中文描述（待办清单兜底项 / 汇总卡明细行用）。 */
export function describeAppDevTool(tool: Pick<ToolStatus, 'name' | 'input' | 'summary'>): string {
  const kind = classifyAppDevTool(tool.name ?? '');
  if (kind === 'file') {
    const stat = extractAppDevFileOpStat(tool);
    const target = stat?.path ? appDevToolBaseName(stat.path) : '文件';
    const isCreate = stat?.isCreate ?? (/write|create/i.test(tool.name) && !/edit/i.test(tool.name));
    return `${isCreate ? '创建' : '编辑'} ${target}`;
  }
  if (kind === 'command') {
    return `执行 ${extractAppDevCommandLabel(tool)}`;
  }
  if (kind === 'read') {
    const args = tool.input && typeof tool.input === 'object' && !Array.isArray(tool.input)
      ? tool.input as Record<string, unknown>
      : null;
    const path = args ? pickString(args, ['file_path', 'filePath', 'path', 'file']) : null;
    return path ? `读取 ${appDevToolBaseName(path)}` : '检索资料';
  }
  return tool.name || '其他操作';
}

const EMPTY_TOTALS: AppDevToolRollupTotals = {
  added: 0,
  removed: 0,
  fileOps: 0,
  commands: 0,
  reads: 0,
  others: 0,
  completedTools: 0,
};

export function emptyAppDevToolRollup(): AppDevToolRollup {
  return { files: [], commands: [], reads: 0, others: 0, totals: { ...EMPTY_TOTALS } };
}

/** 聚合一轮的工具调用（只统计 completed）。 */
export function rollupAppDevTools(tools: readonly ToolStatus[]): AppDevToolRollup {
  const rollup = emptyAppDevToolRollup();
  const fileIndexByPath = new Map<string, number>();

  for (const tool of tools) {
    if (!tool || tool.status !== 'completed') continue;
    rollup.totals.completedTools += 1;
    const kind = classifyAppDevTool(tool.name ?? '');

    if (kind === 'file') {
      rollup.totals.fileOps += 1;
      const stat = extractAppDevFileOpStat(tool);
      if (stat) {
        rollup.totals.added += stat.added;
        rollup.totals.removed += stat.removed;
        if (stat.path) {
          const existingIndex = fileIndexByPath.get(stat.path);
          if (existingIndex != null) {
            const file = rollup.files[existingIndex]!;
            file.added += stat.added;
            file.removed += stat.removed;
            file.ops += 1;
            file.hasCreate = file.hasCreate || stat.isCreate;
            file.hasEdit = file.hasEdit || !stat.isCreate;
            for (const snippet of stat.edits) {
              pushEdit(file.edits, snippet.oldText, snippet.newText);
            }
          } else {
            fileIndexByPath.set(stat.path, rollup.files.length);
            rollup.files.push({
              path: stat.path,
              added: stat.added,
              removed: stat.removed,
              ops: 1,
              hasCreate: stat.isCreate,
              hasEdit: !stat.isCreate,
              edits: [...stat.edits],
            });
          }
        }
      }
      continue;
    }

    if (kind === 'command') {
      rollup.totals.commands += 1;
      rollup.commands.push({ cmd: extractAppDevCommandLabel(tool) });
      continue;
    }

    if (kind === 'read') {
      rollup.totals.reads += 1;
      rollup.reads += 1;
      continue;
    }

    rollup.totals.others += 1;
    rollup.others += 1;
  }

  return rollup;
}

export function isAppDevToolRollupEmpty(rollup: AppDevToolRollup): boolean {
  return rollup.totals.completedTools === 0;
}

/**
 * completed 工具的廉价签名：用于生成中高频 streamingTools 更新的 memo 化。
 * completed 工具的 input 视为终态（状态翻为 completed 时 updatedAt 已变化），
 * 因此签名只需覆盖 completed 子集的 id/status/updatedAt。
 */
export function appDevCompletedToolsSignature(tools: readonly ToolStatus[]): string {
  let sig = '';
  for (const tool of tools) {
    if (!tool || tool.status !== 'completed') continue;
    sig += `${tool.toolCallId ?? tool.id ?? tool.name}:${tool.updatedAt ?? 0}|`;
  }
  return sig;
}

/** 耗时格式化：<60s → "24s"；≥60s → "1m 5s"。 */
export function formatAppDevDurationMs(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '0s';
  const totalSeconds = Math.round(ms / 1000);
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return seconds > 0 ? `${minutes}m ${seconds}s` : `${minutes}m`;
}

/** 消息 timestamp 归一化为毫秒（秒级 / 字符串容忍）。 */
export function normalizeAppDevTimestamp(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return value < 1_000_000_000_000 ? value * 1000 : value;
  }
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

/**
 * 轮次耗时：优先 anchorAt（用户消息时间）→ 最后一个工具 updatedAt；
 * 无 anchor 时退回工具窗口（首个工具开始 → 最后工具结束），再退回 endedAt。
 */
export function resolveAppDevTurnDurationMs(input: {
  anchorAt?: number | null;
  endedAt?: number | null;
  tools?: readonly Pick<ToolStatus, 'updatedAt' | 'durationMs'>[];
}): number | null {
  const tools = input.tools ?? [];
  let lastToolEnd: number | null = null;
  let firstToolStart: number | null = null;
  for (const tool of tools) {
    // ToolStatus.updatedAt 约定为 epoch 毫秒，不做秒级归一（消息 timestamp 才需要）
    const updatedAt = typeof tool.updatedAt === 'number' && Number.isFinite(tool.updatedAt)
      ? tool.updatedAt
      : null;
    if (updatedAt == null) continue;
    if (lastToolEnd == null || updatedAt > lastToolEnd) lastToolEnd = updatedAt;
    const start = updatedAt - (typeof tool.durationMs === 'number' && tool.durationMs > 0 ? tool.durationMs : 0);
    if (firstToolStart == null || start < firstToolStart) firstToolStart = start;
  }

  const end = lastToolEnd ?? input.endedAt ?? null;
  const start = input.anchorAt ?? firstToolStart ?? null;
  if (start == null || end == null) return null;
  const duration = end - start;
  return duration > 0 ? duration : null;
}

/**
 * 完成轮次的工具来源：优先 streamingTools 缓存，Claude 引擎合并
 * tool_result 与 assistant tool_use 补全（与 AssistantTurnMessage 完成态同口径）。
 */
export function resolveAppDevTurnTools(input: {
  sessionKey: string;
  turnKey: string;
  turnMessages: readonly RawMessage[];
  toolResults: readonly RawMessage[];
  precedingUserMessage?: RawMessage | null;
  engineType?: 'openclaw' | 'claude';
}): ToolStatus[] {
  const cacheKey = buildTurnDisplayCacheKey(input.sessionKey, input.turnKey);
  // 与 AssistantTurnMessage 的 turnCacheAliasKeys 同款：user 维度别名键。
  const aliasKeys: string[] = [];
  const userCacheKey = input.precedingUserMessage?.id
    ? buildTurnDisplayCacheKey(
        input.sessionKey,
        buildTurnStableKey(input.precedingUserMessage, 0),
      )
    : undefined;
  if (userCacheKey && userCacheKey !== cacheKey) aliasKeys.push(userCacheKey);
  let cached: CachedTurnStreamingTool[];
  if (input.engineType === 'claude') {
    cached = resolveDoneTurnStreamingTools({
      turnStableKey: cacheKey,
      aliasKeys,
      turnMessages: input.turnMessages,
      toolResults: input.toolResults,
    });
  } else {
    cached = readTurnStreamingToolsCache(cacheKey, aliasKeys);
    if (cached.length === 0) {
      // 缓存未命中（如历史会话重新打开）：合并 transcript 内的 tool_use 补全。
      cached = resolveDoneTurnStreamingTools({
        turnStableKey: cacheKey,
        aliasKeys,
        turnMessages: input.turnMessages,
        toolResults: input.toolResults,
      });
    }
  }
  const now = Date.now();
  return cached.map((tool, index) => ({
    id: tool.id,
    toolCallId: tool.toolCallId,
    name: tool.name,
    status: tool.status ?? 'completed',
    input: tool.input,
    updatedAt: now + index,
  }));
}
