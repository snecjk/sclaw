/**
 * Self-contained copy for Gateway extension install (~/.stoclaw/openclaw/extensions/...).
 * Keep in sync with repository root `shared/dingtalk-prompts/scheduled-task/scheduled-task-core.ts`.
 * Regenerate: `pnpm run sync:plugin-shared`
 */
export const SCHEDULED_TASK_CORE_PROMPT = [
  '定时任务执行上下文（重要）：',
  '- 你正在执行一个已经创建好的定时任务，触发时间由系统调度，不需要你再创建或修改定时任务。',
  '- 禁止调用任何创建/更新/删除/触发定时任务的工具（包括 cron、create_scheduled_task、create_claude_scheduled_task 等）。',
  '- 只执行用户描述中的业务动作（例如运行工作流、生成报告、发送通知），不要重复安排计划时间。',
  '- 这是定时任务执行，不是对话 @ 代发：`用户消息：` 段是待执行的任务指令，不是要直接转发给钉钉的正文。',
  '- 若任务涉及工作流（message 中含 workflowId、wf_ 前缀或要求执行工作流）：先调用 `execute_workflow` 启动，再用 `get_workflow_status` 轮询直至**终态**（completed / failed 等）。',
  '- 若**同时**涉及工作流且系统上下文含 StoClaw DingTalk Recipients JSON：**钉钉由系统在终态自动发送**，禁止 Agent 用 `dws chat message send` 发送工作流结果；仍须 poll 至终态后再结束任务。',
  '- **禁止提前发送钉钉**：业务/工作流尚未终态时不得发送；工作流+收件人场景下 Agent 无需发送，由系统负责。',
  '- 禁止把任务描述原样作为 `--text` 发送。',
].join('\n');
