import { Type } from "@sinclair/typebox";
import { definePluginEntry, type OpenClawPluginApi } from "./api.js";

export default definePluginEntry({
  id: "sto-scheduled-task-tool",
  name: "申通定时任务创建工具",
  description: "提供从自然语言创建定时任务的工具，支持意图识别和参数提取",
  register(api: OpenClawPluginApi) {
    api.logger.info?.("[sto-scheduled-task-tool] plugin registering");

    api.registerTool({
      id: "create_scheduled_task",
      name: "create_scheduled_task",
      label: "创建定时任务",
      description: `当用户想要创建定时任务、定时提醒、周期性自动任务时使用此工具。用户可能会说"每天 X 点做某事"、"每周 X 做某事"、"每月 X 号做某事"等。

你需要从用户的描述中提取：
- name: 任务名称（简短描述任务内容）
- cronExpr: cron 表达式（5 个部分：分 时 日 月 星期）
- description: 任务详细描述

示例：
- "每天早上 9 点生成周报 PPT" → name: "生成周报 PPT", cronExpr: "0 9 * * *"
- "每周一上午 10 点开会" → name: "开会", cronExpr: "0 10 * * 1"
- "每月 1 号备份数据" → name: "备份数据", cronExpr: "0 0 1 * *"

如果用户没有提供完整信息，请返回缺少的参数，不要猜测。`,
      parameters: Type.Object({
        name: Type.String({ description: "任务名称，例如'生成周报 PPT'" }),
        cronExpr: Type.String({ description: "cron 表达式，例如'0 9 * * *'表示每天 9 点，'0 10 * * 1'表示每周一 10 点" }),
        description: Type.String({ description: "任务描述，说明任务的具体内容" }),
        notifyMode: Type.Optional(Type.String({ description: "通知方式：'none'（不通知）、'dingtalk'（钉钉通知）" })),
      }),
      execute: async (_toolCallId, params) => {
        api.logger.info?.(
          `[sto-scheduled-task-tool] execute: name=${params.name}, cronExpr=${params.cronExpr}`,
        );

        // 验证必填参数
        if (!params.name || !params.cronExpr || !params.description) {
          const missing: string[] = [];
          if (!params.name) missing.push("任务名称（name）");
          if (!params.cronExpr) missing.push("执行时间 cron 表达式（cronExpr）");
          if (!params.description) missing.push("任务描述（description）");
          const payload = {
            type: "scheduled_task_confirmation",
            success: false,
            error: "缺少必填参数",
            missing,
            extractedParams: {
              name: params.name || undefined,
              cronExpr: params.cronExpr || undefined,
              description: params.description || undefined,
              notifyMode: params.notifyMode || undefined,
            },
          };
          return {
            content: [{ type: "text" as const, text: JSON.stringify(payload) }],
            details: payload,
          };
        }

        // 验证 cron 表达式格式（简单验证）
        const cronParts = params.cronExpr.split(" ");
        if (cronParts.length !== 5) {
          const payload = {
            type: "scheduled_task_confirmation",
            success: false,
            error: "cron 表达式格式不正确",
            extractedParams: {
              name: params.name,
              cronExpr: params.cronExpr,
              description: params.description,
              notifyMode: params.notifyMode || undefined,
            },
          };
          return {
            content: [{ type: "text" as const, text: JSON.stringify(payload) }],
            details: payload,
          };
        }

        // 返回提取的参数供前端确认，不直接创建任务
        // 前端弹窗确认后，由前端调用云端 API 创建
        const payload = {
          type: "scheduled_task_confirmation",
          success: true,
          extractedParams: {
            name: params.name,
            cronExpr: params.cronExpr,
            description: params.description,
            notifyMode: params.notifyMode || "none",
          },
          message: `已提取定时任务参数：「${params.name}」，执行时间 ${params.cronExpr}，请确认`,
        };
        return {
          content: [{ type: "text" as const, text: JSON.stringify(payload) }],
          details: payload,
        };
      },
    });

    api.logger.info?.("[sto-scheduled-task-tool] plugin registered successfully");
  },
});