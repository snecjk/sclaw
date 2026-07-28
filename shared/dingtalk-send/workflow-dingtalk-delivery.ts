/**
 * 工作流终态钉钉程序发送：正文格式化 + dws 参数拼装（纯函数，Main / 测试共用）。
 *
 * 触发链：`WorkflowExecutionTracker` 在工作流 completed / failed / timeout 后调用
 * `electron/services/workflow-dingtalk-delivery.ts`。
 *
 * TODO(workflow-dingtalk-guard): 若 Agent 自发 dws send 与程序发送双发，可在此模块旁
 * 增加「工作流 run 期间禁止 Agent dws send」的 send-guard / 提示词（见 tracker 注释）。
 */
import { appendDingTalkAgentSendDisclaimer } from '../dingtalk-prompts/dingtalk-disclaimer';
import {
  resolveWorkflowArtifactUrl,
  type WorkflowExecutionState,
} from '../workflow-run-status';
import { normalizeArtifactUrl } from './dws-send-text';
import { type DingTalkMention } from './dingtalk-mention';

export function isHttpArtifactUrl(url: string | undefined | null): boolean {
  const trimmed = url?.trim();
  return Boolean(trimmed && /^https?:\/\//i.test(trimmed));
}

/** 钉钉 IM Markdown 标题（`###`，与模块 A 发送格式规则 2 一致）。 */
function formatWorkflowDingTalkHeading(title: string | undefined, suffix?: string): string {
  const label = title || '工作流';
  return suffix ? `### ${label}${suffix}` : `### ${label}`;
}

/**
 * 工作流产物单行：程序发送路径下 URL 经 normalize，可安全使用 Markdown 链接
 * （与对话分享 `buildConversationShareHttpFileLinks` 口径一致）。
 */
function formatWorkflowDingTalkArtifactLine(name: string, url: string): string {
  const label = name.trim() || '文件';
  const normalizedUrl = normalizeArtifactUrl(url.trim());
  return `- [${label}](${normalizedUrl})`;
}

/** 从工作流终态拼钉钉 `--text` 正文（含代发说明底栏）。无可发内容时返回 null。 */
export function formatWorkflowDingTalkBody(options: {
  state: Pick<WorkflowExecutionState, 'status' | 'result' | 'error'>;
  workflowTitle?: string | null;
}): string | null {
  const { state } = options;
  const title = options.workflowTitle?.trim() || undefined;
  const status = state.status;

  if (status === 'failed' || status === 'timeout') {
    const err = state.error?.trim() || (status === 'timeout' ? '工作流执行超时' : '工作流执行失败');
    const head = formatWorkflowDingTalkHeading(title, ' · 执行失败');
    return appendDingTalkAgentSendDisclaimer(`${head}\n\n${err}`);
  }

  if (status !== 'completed') return null;

  const lines: string[] = [formatWorkflowDingTalkHeading(title)];

  const summary = state.result?.summary?.trim();
  if (summary) {
    lines.push('');
    lines.push(summary);
  }

  const artifactLines: string[] = [];
  for (const artifact of state.result?.artifacts ?? []) {
    const url = resolveWorkflowArtifactUrl(artifact);
    if (!isHttpArtifactUrl(url)) continue;
    artifactLines.push(formatWorkflowDingTalkArtifactLine(artifact.name, url));
  }

  if (artifactLines.length > 0) {
    lines.push('');
    lines.push(...artifactLines);
  }

  const body = lines.join('\n').trim();
  if (!summary && artifactLines.length === 0) {
    if (title) {
      return appendDingTalkAgentSendDisclaimer(
        `${formatWorkflowDingTalkHeading(title)}\n\n工作流已执行完成。`,
      );
    }
    return null;
  }

  return appendDingTalkAgentSendDisclaimer(body);
}

export function buildWorkflowDingTalkDwsArgs(
  recipient: DingTalkMention,
  options: { title: string; body: string },
): string[] | null {
  const text = options.body;
  const title = options.title.trim() || '消息';

  if (recipient.type === 'user' && recipient.userId?.trim()) {
    return [
      'chat',
      'message',
      'send',
      '--user',
      recipient.userId.trim(),
      '--title',
      title,
      '--text',
      text,
      '--format',
      'json',
    ];
  }

  if (recipient.type === 'group' && recipient.openConversationId?.trim()) {
    return [
      'chat',
      'message',
      'send',
      '--group',
      recipient.openConversationId.trim(),
      '--title',
      title,
      '--text',
      text,
      '--format',
      'json',
    ];
  }

  return null;
}

export function dedupeDingTalkRecipients(recipients: DingTalkMention[]): DingTalkMention[] {
  const seen = new Set<string>();
  const out: DingTalkMention[] = [];
  for (const recipient of recipients) {
    const key =
      recipient.type === 'group'
        ? `group:${recipient.openConversationId ?? recipient.displayName}`
        : `user:${recipient.userId ?? recipient.displayName}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(recipient);
  }
  return out;
}
