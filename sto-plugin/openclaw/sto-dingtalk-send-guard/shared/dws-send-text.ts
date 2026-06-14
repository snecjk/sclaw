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
    if (ch === '\\' && (quote === '"' || bashDollarQuote)) {
      escaped = true;
      continue;
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

  if (trimmed.startsWith('"')) {
    const lastQuote = trimmed.lastIndexOf('"');
    if (lastQuote > 0) {
      return unescapeDoubleQuotedShell(trimmed.slice(1, lastQuote));
    }
  }

  if (trimmed.startsWith("'") && trimmed.endsWith("'")) {
    return trimmed.slice(1, -1);
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

/** Parse shell/$' wrappers, unescape literals, then ensure `---` + 唯一代发说明底栏。 */
export function normalizeDwsChatMessageSendText(text: string): string {
  const parsed = parseDwsSendTextFlagSegment(text);
  if (!parsed) return ensureDingTalkAgentSendDisclaimerFormat('');
  return ensureDingTalkAgentSendDisclaimerFormat(parsed);
}

const DWS_CHAT_MSG_SEND = /dws\s+chat\s+message\s+send\b/i;

/** Fix `--text` payload inside a shell `-c` script (always re-quote as bash `$'...'`). */
export function fixDwsChatMessageSendShellScript(script: string): string {
  if (!DWS_CHAT_MSG_SEND.test(script) || !/--text\s+/i.test(script)) return script;

  return script.replace(
    /--text\s+([\s\S]*?)(?=\s+--(?:format|uuid|dry-run|media|msg-type|dentry-id|space-id|file-name|file-type|file-path|file-size|open-dingtalk-id)\b|$)/gi,
    (full, rawValue: string) => {
      const normalized = normalizeDwsChatMessageSendText(rawValue);
      if (!normalized) return full;
      return `--text ${shellQuoteDwsSendTextForBash(normalized)}`;
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
