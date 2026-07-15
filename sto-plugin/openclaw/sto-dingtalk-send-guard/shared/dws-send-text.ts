import { ensureDingTalkAgentSendDisclaimerFormat } from './dingtalk-disclaimer';

/**
 * Normalize `dws chat message send --text` payloads.
 * Models often copy JSON.stringify output into shell commands; bash does not
 * expand `\n` inside double quotes, so DingTalk receives literal backslash-n.
 */

/** Turn literal `\n` / `\t` / `\r` sequences into real whitespace. */
export function unescapeLiteralDwsSendText(text: string): string {
  if (!text || !/[\\][ntr]/.test(text)) return text;
  return text
    .replace(/\\n/g, '\n')
    .replace(/\\t/g, '\t')
    .replace(/\\r/g, '\r');
}

function unescapeBashDollarQuoted(text: string): string {
  return text
    .replace(/\\n/g, '\n')
    .replace(/\\t/g, '\t')
    .replace(/\\r/g, '\r')
    .replace(/\\'/g, "'")
    .replace(/\\\\/g, '\\');
}

function unescapeDoubleQuotedShell(text: string): string {
  let escaped = false;
  let out = '';
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (escaped) {
      if (ch === 'n') out += '\n';
      else if (ch === 't') out += '\t';
      else if (ch === 'r') out += '\r';
      else if (ch === '"') out += '"';
      else out += ch;
      escaped = false;
      continue;
    }
    if (ch === '\\') {
      escaped = true;
      continue;
    }
    out += ch;
  }
  return out;
}

/** Unescape PowerShell double-quoted literals (`n, `"`, `$`, ``). */
function unescapePowerShellDoubleQuoted(text: string): string {
  let out = '';
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === '`' && i + 1 < text.length) {
      const next = text[i + 1];
      if (next === 'n') {
        out += '\n';
        i += 1;
        continue;
      }
      if (next === 'r') {
        out += '\r';
        i += 1;
        continue;
      }
      if (next === 't') {
        out += '\t';
        i += 1;
        continue;
      }
      if (next === '"') {
        out += '"';
        i += 1;
        continue;
      }
      if (next === '$') {
        out += '$';
        i += 1;
        continue;
      }
      if (next === '`') {
        out += '`';
        i += 1;
        continue;
      }
    }
    out += ch;
  }
  return out;
}

function stripMistypedDollarPrefix(text: string): string {
  const trimmed = text.trimStart();
  if (!trimmed.startsWith('$')) return text;
  if (trimmed.startsWith("$'")) return text;
  if (trimmed.startsWith('$"')) return `${text.slice(0, text.indexOf('$'))}${trimmed.slice(1)}`;
  const next = trimmed[1];
  if (!next || /\s/.test(next) || next === '{' || next === '(') return text;
  return `${text.slice(0, text.indexOf('$'))}${trimmed.slice(1)}`;
}

/** Parse `--text` flag value from a shell script segment (supports embedded `"` in HTML). */
export function parseDwsSendTextFlagSegment(raw: string): string {
  const trimmed = stripMistypedDollarPrefix(raw).trim();
  if (!trimmed) return '';

  if (trimmed.startsWith("$'") && trimmed.endsWith("'")) {
    return unescapeBashDollarQuoted(trimmed.slice(2, -1));
  }

  const psHereMatch = trimmed.match(/^\(@'([\s\S]*)'@\)$/);
  if (psHereMatch) return psHereMatch[1];

  if (trimmed.startsWith('"')) {
    const lastQuote = trimmed.lastIndexOf('"');
    if (lastQuote > 0) {
      const inner = trimmed.slice(1, lastQuote);
      if (/`[nrt"$`]/.test(inner)) return unescapePowerShellDoubleQuoted(inner);
      return unescapeDoubleQuotedShell(inner);
    }
  }

  if (trimmed.startsWith("'") && trimmed.endsWith("'")) {
    return trimmed.slice(1, -1);
  }

  if (/`[nrt"$`]/.test(trimmed)) {
    return unescapePowerShellDoubleQuoted(trimmed);
  }

  return unescapeLiteralDwsSendText(trimmed);
}

/** Bash $'...' form so `\n` in the command line becomes a real newline. */
export function shellQuoteDwsSendTextForBash(text: string): string {
  const escaped = text
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t');
  return `$'${escaped}'`;
}

/**
 * PowerShell double-quoted string for OpenClaw exec on Windows (`powershell -Command`).
 * Keep the whole exec command on one line; do not embed multiline here-strings in -Command argv.
 */
export function shellQuoteDwsSendTextForPowerShell(text: string): string {
  const escaped = text
    .replace(/`/g, '``')
    .replace(/"/g, '`"')
    .replace(/\$/g, '`$')
    .replace(/\r/g, '')
    .replace(/\n/g, '`n');
  return `"${escaped}"`;
}

export type DwsSendExecShell = 'bash' | 'powershell';

function shellQuoteDwsSendTextForShell(text: string, execShell: DwsSendExecShell): string {
  return execShell === 'powershell'
    ? shellQuoteDwsSendTextForPowerShell(text)
    : shellQuoteDwsSendTextForBash(text);
}

/**
 * 把单个产物 URL 规范化到「恰好一次 percent-encoding」的稳定态。
 *
 * 背景：工作流产物的 `previewUrl`/`tempUrl` 由 OSS 后端返回，到模型手上时可能
 * **已是 percent-encoded**（`%E4%B8%AD`）。而 `encodeURI` 对已编码串**并非幂等**：
 * 它会把已存在的 `%` 再编成 `%25`（`%E4` → `%25E4`），即双重编码、链接失效。
 * 模型偶发地再 `encodeURIComponent` 一次也会造成同样后果。
 *
 * 本函数无论输入处于哪种状态——「原始中文 / 已编码 / 双重（多重）编码」——都收敛到
 * 单次编码稳定态，且对任意合法输入幂等、重复调用安全：
 *  1. 反复 `decodeURI` 到稳定：把多层冗余编码逐层剥掉——双重编码 `%25E4` 先塌成
 *     `%E4`（`%25`→`%`），再塌成原始中文；非法 `%XX` 串 `decodeURI` 抛错时即停止
 *     （保留已剥到的中间态，不再继续）；
 *  2. 最终 `encodeURI` 一次：把残留的原始非 ASCII 统一编码成 `%XX`，此时串里已无
 *     残余 `%`（全被上一步剥成原始字符），故不会再产生 `%25`。
 * 对不含 http(s) 的串是 no-op（仅作 URL 的探测后整体处理）。
 */
export function normalizeArtifactUrl(url: string): string {
  if (!url || !/https?:\/\//i.test(url)) return url;
  // 迭代 decodeURI 到稳定：逐层剥掉冗余 percent-encoding。decodeURI 对不含 `%` 的
  // 串是 no-op，故原始中文串一次即稳定；双重/多重编码串需多次才能剥净。
  let prev = url;
  let cur = url;
  let guard = 0;
  do {
    prev = cur;
    try {
      cur = decodeURI(prev);
    } catch {
      // 非法 `%XX` 序列（如不完整 UTF-8 `%E6`）：保留已剥到的 `prev`，停止继续解码。
      cur = prev;
      break;
    }
  } while (cur !== prev && ++guard < 8);
  try {
    return encodeURI(cur);
  } catch {
    return cur;
  }
}

const DWS_TEXT_URL_RE = /https?:\/\/[^\s"'<>`)\]]+/gi;

/**
 * 把正文里所有 http(s) URL 规范化到「恰好一次编码」。覆盖模型自发路径：在
 * `dws chat message send --text` 归一化时调用，确保无论模型是否多编码，发出
 * 去的链接都是单次编码的稳定态。
 */
export function normalizeUrlsInText(text: string): string {
  if (!text || !/https?:\/\//i.test(text)) return text;
  return text.replace(DWS_TEXT_URL_RE, (u) => normalizeArtifactUrl(u));
}

/** Parse shell/$' wrappers, unescape literals, normalize embedded URLs, then ensure `---` + 唯一代发说明底栏。 */
export function normalizeDwsChatMessageSendText(text: string): string {
  const parsed = parseDwsSendTextFlagSegment(text);
  if (!parsed) return ensureDingTalkAgentSendDisclaimerFormat('');
  return ensureDingTalkAgentSendDisclaimerFormat(normalizeUrlsInText(parsed));
}

const DWS_CHAT_MSG_SEND = /dws\s+chat\s+message\s+send\b/i;

const DWS_SEND_TEXT_FLAG_RE =
  /--text\s+([\s\S]*?)(?=\s+--(?:format|uuid|dry-run|media|msg-type|dentry-id|space-id|file-name|file-type|file-path|file-size|open-dingtalk-id)\b|$)/gi;

function tokenizeShellLikeCommand(command: string): string[] {
  const tokens: string[] = [];
  let current = '';
  let quote: '"' | "'" | null = null;

  for (let i = 0; i < command.length; i += 1) {
    const ch = command[i];

    if (quote) {
      if (ch === quote) {
        quote = null;
        continue;
      }
      if (quote === '"' && ch === '\\') {
        const next = command[i + 1];
        if (next === '"' || next === '\\') {
          current += next;
          i += 1;
        } else {
          current += ch;
        }
        continue;
      }
      current += ch;
      continue;
    }

    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }

    if (/\s/.test(ch)) {
      if (current) {
        tokens.push(current);
        current = '';
      }
      continue;
    }

    if (ch === ';') {
      if (current) {
        tokens.push(current);
        current = '';
      }
      break;
    }

    current += ch;
  }

  if (current) tokens.push(current);
  return tokens;
}

/** Parse a shell command containing `dws chat message send` into dws argv. */
export function parseDwsChatMessageSendShellCommandArgs(command: string): string[] | null {
  const match = command.match(DWS_CHAT_MSG_SEND);
  if (!match || match.index == null) return null;

  const dwsSegment = command.slice(match.index);
  const tokens = tokenizeShellLikeCommand(dwsSegment);
  if (tokens.length < 4) return null;
  if (!/^dws(?:\.exe)?$/i.test(tokens[0])) return null;
  if (tokens[1] !== 'chat' || tokens[2] !== 'message' || tokens[3] !== 'send') return null;
  return fixDwsChatMessageSendArgv(tokens.slice(1));
}

/** Fix `--text` payload for the target exec shell (Claude/bash vs OpenClaw/PowerShell). */
export function fixDwsChatMessageSendShellScript(
  script: string,
  options?: { execShell?: DwsSendExecShell },
): string {
  if (!DWS_CHAT_MSG_SEND.test(script) || !/--text\s+/i.test(script)) return script;
  const execShell = options?.execShell ?? 'bash';

  return script.replace(
    DWS_SEND_TEXT_FLAG_RE,
    (full, rawValue: string) => {
      const normalized = normalizeDwsChatMessageSendText(rawValue);
      if (!normalized) return full;
      return `--text ${shellQuoteDwsSendTextForShell(normalized, execShell)}`;
    },
  );
}

/** Normalize argv for `spawn('dws', ['chat', 'message', 'send', '--text', value])`. */
export function fixDwsChatMessageSendArgv(args: string[]): string[] {
  if (!Array.isArray(args)) return args;
  const textIdx = args.findIndex((arg) => arg === '--text');
  if (textIdx < 0 || textIdx + 1 >= args.length) return args;
  const next = args[textIdx + 1];
  if (typeof next !== 'string') return args;
  const fixed = normalizeDwsChatMessageSendText(next);
  if (fixed === next) return args;
  const copy = [...args];
  copy[textIdx + 1] = fixed;
  return copy;
}

const TOOL_COMMAND_PARAM_KEYS = [
  'command',
  'cmd',
  'script',
  'input',
  'bash_command',
] as const;

/**
 * Rewrite tool params for Claude/bash exec (default: bash `$'...'` on all platforms).
 */
export function fixDwsChatMessageSendToolParams(
  params: Record<string, unknown> | undefined,
  options?: { execShell?: DwsSendExecShell },
): Record<string, unknown> | undefined {
  if (!params) return undefined;
  const execShell = options?.execShell ?? 'bash';

  for (const key of TOOL_COMMAND_PARAM_KEYS) {
    const value = params[key];
    if (typeof value !== 'string') continue;
    if (!DWS_CHAT_MSG_SEND.test(value) || !/--text\s+/i.test(value)) continue;

    const fixed = fixDwsChatMessageSendShellScript(value, { execShell });
    if (fixed !== value) {
      return { ...params, [key]: fixed };
    }
  }
  return undefined;
}

/** Parse agent/exec command into normalized `dws` argv (real newlines in `--text`). */
export function extractNormalizedDwsSendArgv(rawCommand: string): string[] | null {
  if (!DWS_CHAT_MSG_SEND.test(rawCommand) || !/--text\s+/i.test(rawCommand)) return null;
  const rebuilt = rawCommand.replace(
    DWS_SEND_TEXT_FLAG_RE,
    (_full, rawValue: string) => {
      const normalized = normalizeDwsChatMessageSendText(rawValue);
      return `--text ${JSON.stringify(normalized)}`;
    },
  );
  return parseDwsChatMessageSendShellCommandArgs(rebuilt);
}

const WIN32_NODE_DWS_B64_RE = /Buffer\.from\('([^']+)','base64'\)/;

function parseWin32NodeDwsExecScript(script: string): string[] | null {
  if (!/execFileSync\('dws(?:\.exe)?'/i.test(script)) return null;
  const match = script.match(WIN32_NODE_DWS_B64_RE);
  if (!match) return null;
  try {
    const parsed = JSON.parse(Buffer.from(match[1], 'base64').toString('utf8')) as unknown;
    if (!Array.isArray(parsed) || parsed[0] !== 'chat') return null;
    return fixDwsChatMessageSendArgv(parsed as string[]);
  } catch {
    return null;
  }
}

/**
 * Windows OpenClaw exec wraps commands in PowerShell `-Command`, which breaks Markdown
 * newlines even with `n quoting. Encode argv as base64 and invoke via node execFileSync.
 */
export function buildWin32DirectDwsExecNodeCommand(rawCommand: string): string | null {
  const argv = extractNormalizedDwsSendArgv(rawCommand);
  if (!argv?.length) return null;
  const payload = Buffer.from(JSON.stringify(argv), 'utf8').toString('base64');
  if (payload.length > 24_000) return null;
  return `node -e "require('child_process').execFileSync('dws.exe',JSON.parse(Buffer.from('${payload}','base64').toString('utf8')),{stdio:'inherit',windowsHide:true})"`;
}

/** OpenClaw Gateway exec on Windows uses PowerShell `-Command`; elsewhere use bash. */
export function fixDwsChatMessageSendToolParamsForOpenClawExec(
  params: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (!params) return undefined;

  if (process.platform === 'win32') {
    for (const key of TOOL_COMMAND_PARAM_KEYS) {
      const value = params[key];
      if (typeof value !== 'string') continue;
      if (!DWS_CHAT_MSG_SEND.test(value) || !/--text\s+/i.test(value)) continue;

      const direct = buildWin32DirectDwsExecNodeCommand(value);
      if (direct && direct !== value) {
        return { ...params, [key]: direct };
      }
    }
  }

  const execShell: DwsSendExecShell =
    process.platform === 'win32' ? 'powershell' : 'bash';
  return fixDwsChatMessageSendToolParams(params, { execShell });
}

/**
 * Parse `dws chat message send` out of shell-wrapper spawn argv (bash -c / PowerShell -Command).
 * Returns normalized dws argv suitable for `spawn('dws', args)` — bypasses shell quoting.
 */
export function tryParseDwsSendExecInvocation(
  cmd: string,
  argsList: string[],
): string[] | null {
  const trimmedCmd = cmd.trim();
  if (/^dws(\.exe)?$/i.test(trimmedCmd)) {
    return fixDwsChatMessageSendArgv(argsList);
  }

  let script: string | undefined;
  let execShell: DwsSendExecShell = 'bash';

  if (/powershell|pwsh/i.test(trimmedCmd)) {
    execShell = 'powershell';
    const cmdIdx = argsList.findIndex((arg) => /^-command$/i.test(String(arg)));
    if (cmdIdx >= 0 && cmdIdx + 1 < argsList.length && typeof argsList[cmdIdx + 1] === 'string') {
      script = argsList[cmdIdx + 1];
    }
  } else if (/bash|sh|zsh|dash/i.test(trimmedCmd) || /\\bash$|\\sh$/.test(trimmedCmd)) {
    const cIdx = argsList.indexOf('-c') >= 0 ? argsList.indexOf('-c') : argsList.indexOf('/c');
    if (cIdx >= 0 && cIdx + 1 < argsList.length && typeof argsList[cIdx + 1] === 'string') {
      script = argsList[cIdx + 1];
    }
  }

  if (!script || !DWS_CHAT_MSG_SEND.test(script)) {
    const nodeArgv = script ? parseWin32NodeDwsExecScript(script) : null;
    if (nodeArgv) return nodeArgv;
    return null;
  }
  const fixedScript = fixDwsChatMessageSendShellScript(script, { execShell });
  return parseDwsChatMessageSendShellCommandArgs(fixedScript);
}

const SHELL_WRAPPER_CMD =
  /(?:^|[\\/])(?:powershell|pwsh|bash|sh|zsh|dash|node(?:\.exe)?)(?:\.exe)?$/i;

/** Rewrite shell-wrapper spawn to direct `dws` argv when parseable. */
export function rewriteDwsSendSpawnInvocation(
  cmd: string,
  argsList: string[],
  options?: { platform?: NodeJS.Platform },
): { cmd: string; args: string[] } | null {
  const platform = options?.platform ?? process.platform;
  const parsedArgs = tryParseDwsSendExecInvocation(cmd, argsList);
  if (!parsedArgs) return null;
  if (/^dws(\.exe)?$/i.test(cmd.trim())) {
    return { cmd: cmd.trim(), args: parsedArgs };
  }
  if (!SHELL_WRAPPER_CMD.test(cmd.trim())) return null;
  return {
    cmd: platform === 'win32' ? 'dws.exe' : 'dws',
    args: parsedArgs,
  };
}

/** Agent-facing `--text` value: JSON double-quoted string with `\n` escape sequences. */
export function formatDwsChatMessageSendTextForAgentCommand(text: string): string {
  return JSON.stringify(text);
}

export interface DwsChatMessageSendAgentCommandOptions {
  recipientKind: 'user' | 'group';
  recipientId: string;
  title?: string;
  text: string;
}

/**
 * Build a pre-normalization `dws chat message send` command for agent prompts.
 * Matches input accepted by fixDwsChatMessageSendShellScript / fixDwsChatMessageSendToolParams.
 */
export function buildDwsChatMessageSendAgentCommandExample(
  options: DwsChatMessageSendAgentCommandOptions,
): string {
  const flag = options.recipientKind === 'user' ? '--user' : '--group';
  const title = options.title ?? '消息';
  const textArg = formatDwsChatMessageSendTextForAgentCommand(options.text);
  return `dws chat message send ${flag} ${options.recipientId} --title ${JSON.stringify(title)} --text ${textArg} --format json`;
}

/**
 * Prompt rule: how agents compose `--text` and how StoClaw normalizes before execution.
 * Keep in sync with fixDwsChatMessageSendShellScript / fixDwsChatMessageSendToolParams.
 */
export const DWS_CHAT_MESSAGE_SEND_AGENT_FORMAT_RULE =
  '**--text 写法**（须与下方预填示例一致）：用普通双引号包裹正文，段落换行写 `\\n`（勿在 shell 命令里写真实换行、勿用 shell 变量如 `--text $text`、勿手写 Bash `$\\\'...\\\'`）。StoClaw 会在工具调用/执行前自动解析 `--text`、把 `\\n` 转为真实换行，并补全缺失的代发说明；按示例格式构造命令即可。';
