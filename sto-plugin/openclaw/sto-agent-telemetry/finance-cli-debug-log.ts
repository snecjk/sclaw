/**
 * 报价相关 sai-cli 调试日志：打印入参与返回，便于本地排查。
 * 覆盖网关注册（VIP）：
 *   vip quotation-check validate
 *   vip quotation-draft parse / create
 *   vip quotation save
 *   vip quotation batch-check validate
 */
import { extractCommandText, pickCliParams } from "./command-extract.js";
import { pickToolResult } from "./tool-result-extract.js";

const TAG = "quote-cli-debug";

/** Match registered VIP quote CLIs (and legacy finance.* for leftover agent calls). */
const QUOTE_CLI_COMMAND_RE =
  /\b(?:vip\s+quotation(?:-check|-draft)?(?:\s+batch-check)?\s+(?:validate|parse|create|save)|finance\s+(?:quotation(?:-draft)?|sclaw-quotation)\s+(?:check|upload|validate|preview|create))\b/i;

const MAX_LOG_CHARS = 8000;

export function isFinanceQuoteCliCommand(command: string | undefined): boolean {
  if (!command?.trim()) return false;
  return QUOTE_CLI_COMMAND_RE.test(command);
}

function truncateForLog(value: unknown): string {
  let text: string;
  try {
    text = typeof value === "string" ? value : JSON.stringify(value, null, 2);
  } catch {
    text = String(value);
  }
  if (text.length <= MAX_LOG_CHARS) return text;
  return `${text.slice(0, MAX_LOG_CHARS)}\n…[truncated ${text.length - MAX_LOG_CHARS} chars]`;
}

function resolveCommand(params: Record<string, unknown> | undefined, command?: string): string | undefined {
  if (typeof command === "string" && command.trim()) {
    return command.trim();
  }
  const picked = pickCliParams(params);
  return picked ? extractCommandText(picked) : undefined;
}

type LoggerLike = {
  info?: (message: string) => void;
  warn?: (message: string) => void;
};

export function logFinanceCliBefore(
  logger: LoggerLike,
  input: {
    toolName?: string;
    toolCallId?: string;
    params?: Record<string, unknown>;
    command?: string;
  },
): void {
  const command = resolveCommand(input.params, input.command);
  if (!isFinanceQuoteCliCommand(command)) return;

  const picked = pickCliParams(input.params) ?? input.params;
  logger.info?.(
    `[${TAG}] BEFORE tool=${input.toolName ?? "-"} toolCallId=${input.toolCallId ?? "-"} command=${command}\n` +
      `入参:\n${truncateForLog(picked ?? {})}`,
  );
}

export function logFinanceCliAfter(
  logger: LoggerLike,
  input: {
    toolName?: string;
    toolCallId?: string;
    params?: Record<string, unknown>;
    command?: string;
    result?: unknown;
    error?: unknown;
    durationMs?: number;
    rawEvent?: Record<string, unknown>;
  },
): void {
  const command = resolveCommand(input.params, input.command);
  if (!isFinanceQuoteCliCommand(command)) return;

  const picked = pickCliParams(input.params) ?? input.params;
  const result =
    input.result ??
    (input.rawEvent ? pickToolResult(input.rawEvent) : undefined);
  const duration =
    typeof input.durationMs === "number" ? `${input.durationMs}ms` : "-";
  const errPart = input.error != null ? `\n错误: ${truncateForLog(input.error)}` : "";

  logger.info?.(
    `[${TAG}] AFTER tool=${input.toolName ?? "-"} toolCallId=${input.toolCallId ?? "-"} ` +
      `command=${command} duration=${duration}\n` +
      `入参:\n${truncateForLog(picked ?? {})}\n` +
      `返回:\n${truncateForLog(result ?? null)}${errPart}`,
  );
}
