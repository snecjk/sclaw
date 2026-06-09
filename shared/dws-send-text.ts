import { ensureDingTalkAgentSendDisclaimerFormat } from './dingtalk-disclaimer';

/**
 * Normalize `dws chat message send --text` payloads.
 * Models often copy JSON.stringify output into shell commands; bash does not
 * expand `\n` inside double quotes, so DingTalk receives literal backslash-n.
 */

import { ensureDingTalkAgentSendDisclaimerFormat } from './dingtalk-disclaimer';

/** Turn literal `\n` / `\t` / `\r` sequences into real whitespace. */
export function unescapeLiteralDwsSendText(text: string): string {
  if (!text || !/[\\][ntr]/.test(text)) return text;
  return text
    .replace(/\\n/g, '\n')
    .replace(/\\t/g, '\t')
    .replace(/\\r/g, '\r');
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

/** Unescape literals, then ensure `---` + 代发说明底栏（与对话框发送一致）。 */
export function normalizeDwsChatMessageSendText(text: string): string {
  return ensureDingTalkAgentSendDisclaimerFormat(unescapeLiteralDwsSendText(text));
}

const DWS_CHAT_MSG_SEND = /dws\s+chat\s+message\s+send\b/i;

function parseQuotedShellSegment(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return '';
  const quote = trimmed[0];
  if (quote !== '"' && quote !== "'") return trimmed;
  let escaped = false;
  let out = '';
  for (let i = 1; i < trimmed.length; i += 1) {
    const ch = trimmed[i];
    if (escaped) {
      if (ch === 'n') out += '\n';
      else if (ch === 't') out += '\t';
      else if (ch === 'r') out += '\r';
      else out += ch;
      escaped = false;
      continue;
    }
    if (ch === '\\') {
      escaped = true;
      continue;
    }
    if (ch === quote) return out;
    out += ch;
  }
  return out;
}

/** Fix `--text "a\\n\\nb"` → `--text $'a\n\nb'` inside a shell -c script. */
export function fixDwsChatMessageSendShellScript(script: string): string {
  if (!DWS_CHAT_MSG_SEND.test(script) || !/--text\s+/i.test(script)) return script;

  return script.replace(
    /--text\s+("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\S+)/gi,
    (full, quoted) => {
      if (!quoted || typeof quoted !== 'string') return full;
      const parsed = parseQuotedShellSegment(quoted);
      if (!parsed) return full;
      const normalized = normalizeDwsChatMessageSendText(parsed);
      if (normalized === parsed) return full;
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
