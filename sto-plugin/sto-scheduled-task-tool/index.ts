import { definePluginEntry, type OpenClawPluginApi } from "./api.js";

export default definePluginEntry({
  id: "sto-scheduled-task-tool",
  name: "申通定时任务创建工具",
  description: "提供从自然语言创建定时任务的工具，支持意图识别和参数提取",
  register(api: OpenClawPluginApi) {
    api.logger.info?.("[sto-scheduled-task-tool] plugin registering");

    // 注册定时任务创建工具
    api.registerTool({
      id: "create_scheduled_task",
      name: "create_scheduled_task",
      label: "创建定时任务",
      description: "从用户的自然语言描述中创建定时任务。当用户表达需要定期执行某项任务时使用此工具。\n\n示例：\n- \"每天早上 9 点生成周报 PPT\"\n- \"每周一上午 10 点提醒我开会\"\n- \"每月 1 号备份数据库\"",
      inputSchema: {
        type: "object",
        properties: {
          name: {
            type: "string",
            description: "任务名称，例如'生成周报 PPT'",
          },
          cronExpr: {
            type: "string",
            description: "cron 表达式，例如'0 9 * * *'表示每天 9 点，'0 10 * * 1'表示每周一 10 点",
          },
          description: {
            type: "string",
            description: "任务描述，说明任务的具体内容",
          },
          notifyMode: {
            type: "string",
            description: "通知方式：'none'（不通知）、'dingtalk'（钉钉通知）",
            enum: ["none", "dingtalk"],
          },
        },
        required: ["name", "cronExpr"],
      },
      execute: async (params, ctx) => {
        api.logger.info?.(
          `[sto-scheduled-task-tool] execute: name=${params.name}, cronExpr=${params.cronExpr}`,
        );

        // 验证必填参数
        if (!params.name || !params.cronExpr) {
          return {
            success: false,
            error: "缺少必填参数：name 和 cronExpr",
            needsConfirmation: true,
            extractedParams: params,
            content: JSON.stringify({
              type: "scheduled_task_confirmation",
              success: false,
              error: "缺少必填参数",
              extractedParams: params,
            }),
          };
        }

        // 验证 cron 表达式格式（简单验证）
        const cronParts = params.cronExpr.split(" ");
        if (cronParts.length !== 5) {
          return {
            success: false,
            error: "cron 表达式格式不正确，应为 5 个部分（分 时 日 月 星期）",
            needsConfirmation: true,
            extractedParams: params,
            content: JSON.stringify({
              type: "scheduled_task_confirmation",
              success: false,
              error: "cron 表达式格式不正确",
              extractedParams: params,
            }),
          };
        }

        // 返回提取的参数，等待用户确认
        return {
          success: true,
          needsConfirmation: true,
          extractedParams: {
            name: params.name,
            cronExpr: params.cronExpr,
            description: params.description || "",
            notifyMode: params.notifyMode || "none",
          },
          content: JSON.stringify({
            type: "scheduled_task_confirmation",
            success: true,
            needsConfirmation: true,
            extractedParams: {
              name: params.name,
              cronExpr: params.cronExpr,
              description: params.description || "",
              notifyMode: params.notifyMode || "none",
            },
            message: `已提取定时任务参数：${params.name}，请确认是否创建`,
          }),
        };
      },
    });

    api.logger.info?.("[sto-scheduled-task-tool] plugin registered successfully");
  },
});
