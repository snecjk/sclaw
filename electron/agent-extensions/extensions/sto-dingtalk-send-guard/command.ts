import { appendDingTalkAgentSendDisclaimer } from '../../../../shared/dingtalk-prompts/dingtalk-disclaimer';
import { DINGTALK_LOCAL_ARTIFACT_IN_TEXT_BLOCK_REASON } from '../../../../shared/dingtalk-prompts/dingtalk-send-rules';
import {
  buildDwsChatMessageSendAgentCommandExample,
  dwsChatMessageSendTextContainsLocalArtifactPath,
  extractNormalizedDwsSendArgv,
  fixDwsChatMessageSendToolParams,
} from '../../../../shared/dingtalk-send/dws-send-text';
import type { DingTalkSendCategory } from './capability';

const DWS_SEND = /dws(?:\.exe)?\s+chat\s+message\s+send\b/i;
const DRY_RUN = /--dry-run\b/i;
const LOOP = /\b(?:for|while|until|seq|xargs)\b/i;
const MEDIA = /--msg-type\s+(?:image|file)\b|--media-id\b|\s--file\s/i;
const COMMAND_KEYS = ['command', 'cmd', 'script', 'input', 'bash_command'] as const;

export const DINGTALK_NO_BYPASS_HINT =
  '若被本策略拦截，请按 reason 中给出的格式直接用 Bash 重试 `dws chat message send`；禁止改用 Python / 其他语言脚本 / `subprocess` / 其他工具间接调用 dws 绕过。';

export function readDingTalkToolCommand(input: Record<string, unknown>): string {
  for (const key of COMMAND_KEYS) {
    const value = input[key];
    if (typeof value === 'string' && value.trim()) return value;
  }
  return '';
}

export function containsDingTalkSend(command: string): boolean {
  return DWS_SEND.test(command);
}

export function isDingTalkSendDryRun(command: string): boolean {
  return DRY_RUN.test(command);
}

export function classifyDingTalkSend(command: string): DingTalkSendCategory | null {
  if (!containsDingTalkSend(command) || isDingTalkSendDryRun(command)) return null;
  return MEDIA.test(command) ? 'image' : 'text';
}

export function resolveDingTalkSendStaticProblem(command: string): string | null {
  if (!containsDingTalkSend(command)) return null;
  const sendCount = command.match(/dws(?:\.exe)?\s+chat\s+message\s+send\b/gi)?.length ?? 0;
  if (sendCount > 1 || LOOP.test(command)) {
    return '[SClaw 安全策略] 禁止通过循环或批量命令多次调用 dws chat message send。请一次只发送一条消息。';
  }
  if (dwsChatMessageSendTextContainsLocalArtifactPath(command)) {
    return DINGTALK_LOCAL_ARTIFACT_IN_TEXT_BLOCK_REASON;
  }
  if (!/--text\s+/i.test(command)) return null;
  const example = buildDwsChatMessageSendAgentCommandExample({
    recipientKind: 'user',
    recipientId: '<userId>',
    text: appendDingTalkAgentSendDisclaimer('{正文}'),
  });
  if (/<\/?font\b/i.test(command)) {
    return `钉钉发送正文禁止使用 <font> HTML。请改用 Markdown 底栏，示例：\n${example}`;
  }
  if (
    /--text\s+\$'[\s\S]*'/i.test(command)
    || /--text\s+\$[A-Za-z_][A-Za-z0-9_]*/i.test(command)
    || /--text\s+(?:--format\b|$)/i.test(command)
  ) {
    return `钉钉发送正文不能使用 shell 变量、Bash ANSI-C 引号或空 \`--text\`。请直接使用示例格式：\n${example}`;
  }
  return null;
}

export function normalizeDingTalkSendInput(
  input: Record<string, unknown>,
  execShell: 'bash' | 'powershell',
): Record<string, unknown> {
  return fixDwsChatMessageSendToolParams(input, { execShell }) ?? input;
}

export function parseDingTalkSendFingerprint(command: string): {
  recipientKey?: string;
  normalizedText?: string;
} {
  const argv = extractNormalizedDwsSendArgv(command);
  if (!argv) return {};
  let recipientKey: string | undefined;
  let normalizedText: string | undefined;
  for (let index = 0; index < argv.length - 1; index += 1) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (flag === '--user') recipientKey = `user:${value}`;
    else if (flag === '--group' || flag === '--open-dingtalk-id') recipientKey = `group:${value}`;
    else if (flag === '--text') normalizedText = value;
  }
  return { recipientKey, normalizedText };
}
