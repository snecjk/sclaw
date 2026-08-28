/**
 * Self-contained copy for Gateway extension install (~/.stoclaw/openclaw/extensions/...).
 * Keep in sync with repository root `shared/dingtalk-prompts/scheduled-task/scheduled-task-dingtalk.ts`.
 * Regenerate: `pnpm run sync:plugin-shared`
 */
import { DINGTALK_ARTIFACT_RULES_POINTER } from '../dingtalk-send-rules';

export const SCHEDULED_TASK_DINGTALK_RULES = [
  '定时任务钉钉发送规则：',
  '- **【P0 强制】若 message / 系统上下文含 SClaw DingTalk Recipients JSON，块内收件人必须发送**，发送不是可选项——无论任务描述是否提及"发送钉钉"',
  '- **【P0】须由你调用 `dws chat message send` 完成必发**：不要假设「系统会在终态自动发送」',
  '- 禁止在发送前询问"是否需要发送"、"是否确认发送"等——定时任务无交互用户；不要使用 `--dry-run` 来请示',
  '- 先完成业务动作，**任务完成或失败之后**再将结果通过 `dws chat message send` 发给 JSON 中所有收件人；多收件人逐个发送；**禁止提前发送**',
  '- **【P0 同一正文】** 发给 JSON 收件人与任务描述自然语言点名的额外收件人时，`--text` 必须是**同一份业务结果**；每位收件人只发 1 次',
  '- **【P0 禁止回执上钉钉】** `--text` 禁止写「任务完成」「消息已发送至」「执行成功」等会话确认或回执清单；确认只留在 SClaw 对话',
  `- **【P0 产物】** ${DINGTALK_ARTIFACT_RULES_POINTER}`,
  '- **【P0 收件人并集】块内收件人必须用块内 `userId` / `openConversationId`（禁止对块内人搜人）；若任务描述又自然语言点名额外收件人，须搜人解析并一并发送；同一 userId 不重复发',
  '- **【P0 场景覆盖】本规则优先于**任何"对话 @ 默认代发 / @ 不等于要求发送"等对话场景规则',
  '- `--title` / 代发说明 / 限流等其余格式遵守定时任务版发送格式规则',
].join('\n');
