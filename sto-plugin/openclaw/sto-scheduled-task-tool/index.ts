import { definePluginEntry, type OpenClawPluginApi } from "./api.js";
import {
  evaluateScheduledTaskCreationBlock,
  isScheduledTaskExecutionSessionKey,
  SCHEDULED_TASK_EXECUTION_SYSTEM_PROMPT,
} from "./shared/scheduled-task-instruction.js";

export default definePluginEntry({
  id: "sto-scheduled-task-tool",
  name: "申通定时任务创建工具",
  description: "提供从自然语言创建定时任务的工具，支持意图识别和参数提取",
  register(api: OpenClawPluginApi) {
    api.logger.info?.("[sto-scheduled-task-tool] plugin registering");

    api.on('before_prompt_build', async (_event, ctx) => {
      if (!isScheduledTaskExecutionSessionKey(ctx.sessionKey)) {
        return;
      }
      return { appendSystemContext: SCHEDULED_TASK_EXECUTION_SYSTEM_PROMPT };
    });

    api.on(
      'before_tool_call',
      (event, ctx) => {
        const decision = evaluateScheduledTaskCreationBlock({
          sessionKey: ctx.sessionKey ?? ctx.sessionId,
          toolName: event.toolName,
        });
        if (decision.blocked) {
          api.logger.warn?.(
            `[sto-scheduled-task-tool] blocked tool=${event.toolName}: ${decision.reason}`,
          );
          return {
            block: true,
            blockReason: decision.reason,
          };
        }
      },
      { priority: 110 },
    );

    api.logger.info?.("[sto-scheduled-task-tool] plugin registered successfully");
  },
});
