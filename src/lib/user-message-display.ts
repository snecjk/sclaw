/**
 * 归一化用户消息文案，用于展示与乐观↔服务端配对。
 * Gateway history 常含注入提示/元数据；UI 侧存剥离后的文本。
 *
 * Stage-6 gateway 占位符（`[文件:]` / `[技能:]`）与工作流执行句只属于模型载荷——
 * 切勿当作气泡/编辑 UI 文案。
 *
 * 展示侧保留换行；水平空白折叠为空格。配对请再用 {@link collapseWhitespaceForPairing}。
 */
import { stripCronTriggerTextForDisplay } from '@/lib/cron-session-display';
import { stripDingTalkMentionContextForDisplay } from '@/lib/dingtalk-mention-context';
import { stripSkillTranscriptMarker } from '@/lib/skill-transcript-marker';
import { stripWorkflowCompleteForDisplay, stripWorkflowContextForDisplay } from '@/lib/workflow-context';
import { stripSclawBrowserEmbedContextForDisplay } from '@/lib/sclaw-browser-embed-context';
import { stripWorkflowSessionHintForDisplay } from '@/lib/workflow-session-hint';

const GATEWAY_SYSTEM_EVENT_LINE =
  /^\s*System:\s*(?:\[[^\]]+\]\s*)?[^\n]*(?:\n|$)/gim;

/** Gateway 注入的时间戳前缀，如 `[Thu 2026-08-13 10:17 GMT+8]`。 */
const GATEWAY_TIMESTAMP_PREFIX_RE =
  /^\[(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)\s+\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}\s+[^\]]+\]\s*/i;

/** 烘焙进 gatewayText 的行内文件/技能占位符（Composer stage 6）。 */
const COMPOSER_FILE_PLACEHOLDER_RE = /\[文件:\s*[^\]]*\]/g;
const COMPOSER_SKILL_PLACEHOLDER_RE = /\[技能:\s*[^\]]*\]/g;

/** 替代工作流 chip 烘焙进去的执行指令句。 */
const WORKFLOW_EXEC_SENTENCE_RE =
  /帮我执行\s*id\s*为\s*[:：]?\s*[A-Za-z0-9_-]+\s*的工作流\s*(?:【[^】]*】)?/g;

/** 剥掉行首 Gateway 时间戳（可叠多层）。 */
export function stripGatewayTimestampPrefix(text: string): string {
  let result = text;
  for (let i = 0; i < 3; i += 1) {
    const next = result.replace(GATEWAY_TIMESTAMP_PREFIX_RE, '').trimStart();
    if (next === result) break;
    result = next;
  }
  return result;
}

function stripGatewayUserMetadata(text: string): string {
  return stripGatewayTimestampPrefix(
    text
      .replace(GATEWAY_SYSTEM_EVENT_LINE, '')
      .replace(/^Sender\s*\([^)]*\):\s*```[a-z]*\n[\s\S]*?```\s*/im, '')
      .replace(/\s*\[media attached:[^\]]*\]/gi, '')
      .replace(/\s*\[message_id:\s*[^\]]+\]/g, '')
      .replace(/^Conversation info\s*\([^)]*\):\s*```[a-z]*\n[\s\S]*?```\s*/i, '')
      .replace(/^Conversation info\s*\([^)]*\):\s*\{[\s\S]*?\}\s*/i, '')
      .replace(/\n*Current time:\s*[^\n]+/gi, '')
      .replace(/\n*Reference UTC:\s*[^\n]+/gi, ''),
  ).trim();
}

/** 仅剥离 Gateway `[media attached: …]`（气泡 / 编辑回填共用）。 */
export function stripGatewayMediaAttached(text: string): string {
  return text.replace(/\s*\[media attached:[^\]]*\]/gi, '');
}

/**
 * 剥离 gateway / 钉钉等噪声，但保留 stage-6 `[文件:]`/`[技能:]` 与工作流执行句。
 * 顺序：先抽 `用户消息：` 等外层块，再剥时间戳——否则 `[Thu …]` 嵌在用户段内时 `^` 匹配不到。
 */
export function stripUserNoiseKeepComposerBake(text: string): string {
  const withoutWrappers = stripSkillTranscriptMarker(
    stripCronTriggerTextForDisplay(
      stripWorkflowContextForDisplay(
        stripSclawBrowserEmbedContextForDisplay(
          stripWorkflowSessionHintForDisplay(
            stripWorkflowCompleteForDisplay(
              stripDingTalkMentionContextForDisplay(text),
            ),
          ),
        ),
      ),
    ),
  );
  return stripGatewayUserMetadata(withoutWrappers).trim();
}

/** 剥离 stage-6 `[文件:]` / `[技能:]` 占位符（仅 gateway 侧）。 */
export function stripComposerGatewayPlaceholders(text: string): string {
  return text
    .replace(COMPOSER_FILE_PLACEHOLDER_RE, '')
    .replace(COMPOSER_SKILL_PLACEHOLDER_RE, '');
}

/** 剥离工作流执行 bake 句；保留周围用户原文供配对/展示。 */
export function stripWorkflowExecSentenceForDisplay(text: string): string {
  return text.replace(WORKFLOW_EXEC_SENTENCE_RE, '');
}

/**
 * 在 UI / 配对前剥离模型侧 composer bake（占位符 + 工作流执行句）。
 * 可重复调用。
 */
export function stripComposerModelBakeForDisplay(text: string): string {
  return stripWorkflowExecSentenceForDisplay(stripComposerGatewayPlaceholders(text));
}

function stripAllUserDisplayNoise(text: string): string {
  return stripUserNoiseKeepComposerBake(text);
}

/** 配对用：把换行与连续空白统一压成单空格。 */
export function collapseWhitespaceForPairing(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/**
 * 剥离注入的 Gateway / 客户端元数据后整理空白。
 * 保留换行（气泡 `whitespace-pre-wrap`）；仅折叠行内水平空白。
 */
export function normalizeUserMessageForDisplay(text: string): string {
  const stripped = stripComposerModelBakeForDisplay(stripAllUserDisplayNoise(text));
  return stripped
    .replace(/[^\S\n]+/g, ' ')
    .replace(/ ?\n ?/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** 为技能 transcript 解析剥离 Gateway 元数据；保留换行以便区分 prompt/用户正文。 */
export function stripGatewayUserMetadataPreservingLines(text: string): string {
  return stripComposerModelBakeForDisplay(stripUserNoiseKeepComposerBake(text)).trim();
}
