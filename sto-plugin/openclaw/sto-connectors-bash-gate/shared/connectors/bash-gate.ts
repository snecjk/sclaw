/**
 * Self-contained copy for Gateway extension install (~/.stoclaw/openclaw/extensions/...).
 * Keep in sync with repository root `shared/connectors/bash-gate.ts`.
 * Regenerate: `pnpm run sync:plugin-shared`
 */
import { SKILL_PLAZA_CONNECTORS_HREF } from './deep-link';
import { LEGACY_CONNECTOR_GATED_BINARIES } from './collect-gated-binaries';

/** @deprecated Prefer passing gatedBinaries from catalog file; kept for callers/tests. */
export const CONNECTOR_GATED_BINARIES = new Set<string>(LEGACY_CONNECTOR_GATED_BINARIES);

export type ConnectorAllowlistEntry = {
  connectorId?: string;
  allowBinary: string;
  denyArgs?: string[];
};

export type ConnectorBashGateDecision =
  | { blocked: true; reason: string }
  | { blocked: false };

const SHELL_TOOL_NAMES = new Set(['bash', 'shell', 'exec', 'run_shell', 'run_command']);

const COMMAND_PARAM_KEYS = [
  'command',
  'cmd',
  'script',
  'input',
  'bash_command',
  'shell_command',
  'shellCommand',
  'argv',
  'args',
  'program',
  'line',
  'arguments',
  'request',
] as const;

function normalizeBinaryName(token: string): string {
  const base = token.trim().split(/[/\\]/).pop() || token.trim();
  return base.toLowerCase().replace(/\.exe$/i, '');
}

function toGatedSet(gatedBinaries?: Iterable<string>): Set<string> {
  if (!gatedBinaries) return new Set(LEGACY_CONNECTOR_GATED_BINARIES);
  const set = new Set<string>();
  for (const item of gatedBinaries) {
    const name = normalizeBinaryName(item);
    if (name) set.add(name);
  }
  return set.size > 0 ? set : new Set(LEGACY_CONNECTOR_GATED_BINARIES);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function findGatedBinaryInCommand(
  command: string,
  gatedBinaries?: Iterable<string>,
): string | null {
  const gated = toGatedSet(gatedBinaries);
  const trimmed = command.trim();
  if (!trimmed) return null;
  const tokens = trimmed.split(/\s+/);
  for (const token of tokens) {
    const name = normalizeBinaryName(token.replace(/^["']|["']$/g, ''));
    if (gated.has(name)) return name;
  }
  for (const name of gated) {
    const re = new RegExp(`\\b${escapeRegExp(name)}\\b`, 'i');
    if (re.test(trimmed)) return name;
  }
  return null;
}

export function isBinaryAllowedByAllowlist(
  entries: ConnectorAllowlistEntry[],
  binary: string,
): boolean {
  const name = binary.trim().toLowerCase().replace(/\.exe$/i, '');
  return entries.some((entry) => entry.allowBinary.toLowerCase() === name);
}

export function getDenyArgsForAllowlistBinary(
  entries: ConnectorAllowlistEntry[],
  binary: string,
): string[] {
  const name = binary.trim().toLowerCase().replace(/\.exe$/i, '');
  const matched = entries.filter((entry) => entry.allowBinary.toLowerCase() === name);
  const deny = new Set<string>();
  for (const entry of matched) {
    for (const arg of entry.denyArgs ?? []) deny.add(arg.toLowerCase());
  }
  return [...deny];
}

function isDeniedUpgradeArg(binary: string, command: string, denyArgs: string[]): boolean {
  if (denyArgs.length === 0) return false;
  const lower = command.toLowerCase();
  return denyArgs.some((arg) => {
    const re = new RegExp(`(?:^|\\s)${arg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:\\s|$)`, 'i');
    return re.test(lower);
  });
}

export function buildConnectorNotConnectedReason(binary: string): string {
  return (
    `[StoClaw 连接器策略] 未连接对应连接器，无法执行 ${binary}。` +
    '**请勿**继续 which/find/openclaw --help 等探测；**直接回复用户**需先在「技能 → 连接器」完成连接：' +
    `[打开「技能 → 连接器」](${SKILL_PLAZA_CONNECTORS_HREF})`
  );
}

export function evaluateConnectorBashCommand(
  command: string,
  allowlistEntries: ConnectorAllowlistEntry[],
  options?: { gatedBinaries?: Iterable<string> },
): ConnectorBashGateDecision {
  const binary = findGatedBinaryInCommand(command, options?.gatedBinaries);
  if (!binary) return { blocked: false };
  if (!isBinaryAllowedByAllowlist(allowlistEntries, binary)) {
    return { blocked: true, reason: buildConnectorNotConnectedReason(binary) };
  }
  const denyArgs = getDenyArgsForAllowlistBinary(allowlistEntries, binary);
  const effectiveDeny = denyArgs.length > 0 ? denyArgs : ['upgrade', 'install'];
  if (isDeniedUpgradeArg(binary, command, effectiveDeny)) {
    return {
      blocked: true,
      reason: `[StoClaw 安全策略] 禁止在应用内执行 ${binary} 的安装/升级操作。`,
    };
  }
  return { blocked: false };
}

function collectCommandStrings(value: unknown, out: string[]): void {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed) out.push(trimmed);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectCommandStrings(item, out);
    return;
  }
  if (!value || typeof value !== 'object') return;
  const record = value as Record<string, unknown>;
  for (const key of COMMAND_PARAM_KEYS) {
    const nested = record[key];
    if (nested != null) collectCommandStrings(nested, out);
  }
}

/** Extract shell command text from OpenClaw / Claude tool params. */
export function extractShellCommandFromToolParams(
  toolName: string,
  params: Record<string, unknown> | undefined,
): string {
  const chunks: string[] = [];
  if (params) collectCommandStrings(params, chunks);
  if (chunks.length === 0) {
    try {
      const serialized = JSON.stringify(params ?? {});
      if (serialized && serialized !== '{}') chunks.push(serialized);
    } catch {
      // ignore
    }
  }
  const name = toolName.trim().toLowerCase();
  if (chunks.length === 0 && SHELL_TOOL_NAMES.has(name)) return '';
  return chunks.join('\n');
}

export function isShellLikeToolName(toolName: string): boolean {
  const name = toolName.trim().toLowerCase();
  if (SHELL_TOOL_NAMES.has(name)) return true;
  return name.includes('bash') || name.includes('shell') || name.includes('exec');
}

export function evaluateConnectorToolCall(
  toolName: string,
  params: Record<string, unknown> | undefined,
  allowlistEntries: ConnectorAllowlistEntry[],
  options?: { gatedBinaries?: Iterable<string> },
): ConnectorBashGateDecision {
  if (!isShellLikeToolName(toolName)) return { blocked: false };
  const command = extractShellCommandFromToolParams(toolName, params);
  if (!command.trim()) return { blocked: false };
  return evaluateConnectorBashCommand(command, allowlistEntries, options);
}
