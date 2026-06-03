import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { homedir } from "node:os";
import { Type } from "@sinclair/typebox";
import { definePluginEntry, type OpenClawPluginApi } from "./api.js";

function resolveTildePath(filePath: string): string {
  if (filePath.startsWith("~/")) {
    return resolve(homedir(), filePath.slice(2));
  }
  return resolve(filePath);
}

async function readSsoAuth(ssoAuthPath: string): Promise<{ userName?: string; stoToken?: string }> {
  const resolved = resolveTildePath(ssoAuthPath);
  const raw = await readFile(resolved, "utf-8");
  const parsed = JSON.parse(raw) as Record<string, unknown>;
  return {
    userName: typeof parsed.userName === "string" ? parsed.userName : undefined,
    stoToken: typeof parsed.stoToken === "string" ? parsed.stoToken : undefined,
  };
}

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
      execute: async (params, _ctx) => {
        api.logger.info?.(
          `[sto-scheduled-task-tool] execute: name=${params.name}, cronExpr=${params.cronExpr}`,
        );

        // 验证必填参数
        if (!params.name || !params.cronExpr || !params.description) {
          const missing: string[] = [];
          if (!params.name) missing.push("任务名称（name）");
          if (!params.cronExpr) missing.push("执行时间 cron 表达式（cronExpr）");
          if (!params.description) missing.push("任务描述（description）");
          return {
            success: false,
            error: `缺少必填参数：${missing.join("、")}`,
            content: JSON.stringify({
              type: "scheduled_task_error",
              success: false,
              error: "缺少必填参数",
              missing,
            }),
          };
        }

        // 验证 cron 表达式格式（简单验证）
        const cronParts = params.cronExpr.split(" ");
        if (cronParts.length !== 5) {
          return {
            success: false,
            error: "cron 表达式格式不正确，应为 5 个部分（分 时 日 月 星期）",
            content: JSON.stringify({
              type: "scheduled_task_error",
              success: false,
              error: "cron 表达式格式不正确",
            }),
          };
        }

        // 读取插件配置
        const pluginCfg = (api.config?.plugins?.entries?.["sto-scheduled-task-tool"] as Record<string, unknown> | undefined)?.config as Record<string, unknown> | undefined;
        const baseUrl = typeof pluginCfg?.baseUrl === "string" ? pluginCfg.baseUrl.trim() : "";
        const ssoAuthPath = typeof pluginCfg?.ssoAuthPath === "string" ? pluginCfg.ssoAuthPath.trim() : "~/.stoclaw/openclaw/sso-auth.json";

        if (!baseUrl) {
          return {
            success: false,
            error: "插件未配置 baseUrl，无法创建云端定时任务",
            content: JSON.stringify({
              type: "scheduled_task_error",
              success: false,
              error: "插件配置缺失",
            }),
          };
        }

        // 读取 SSO Token
        let stoToken: string | undefined;
        try {
          const ssoAuth = await readSsoAuth(ssoAuthPath);
          stoToken = ssoAuth.stoToken;
        } catch (err) {
          api.logger.warn?.(`[sto-scheduled-task-tool] failed to read SSO auth: ${String(err)}`);
        }

        if (!stoToken) {
          return {
            success: false,
            error: "未登录或 SSO Token 已过期，请重新登录",
            content: JSON.stringify({
              type: "scheduled_task_error",
              success: false,
              error: "未登录",
            }),
          };
        }

        // 调用云端 API 创建定时任务
        const url = `${baseUrl}/agent/v1/scheduled-tasks`;
        const body = {
          name: params.name,
          cron_expr: params.cronExpr,
          description: params.description,
          notify_mode: params.notifyMode || "none",
        };

        try {
          const res = await fetch(url, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              stotoken: stoToken,
            },
            body: JSON.stringify(body),
          });

          const resText = await res.text();
          let resData: Record<string, unknown> = {};
          try {
            resData = JSON.parse(resText) as Record<string, unknown>;
          } catch {
            // ignore parse error
          }

          if (!res.ok) {
            const errMsg = typeof resData.errMessage === "string" ? resData.errMessage : resText;
            return {
              success: false,
              error: `创建失败 (${res.status}): ${errMsg}`,
              content: JSON.stringify({
                type: "scheduled_task_error",
                success: false,
                error: errMsg,
              }),
            };
          }

          const data = resData.data as Record<string, unknown> | undefined;
          const taskId = data?.id ?? "unknown";
          const taskName = data?.name ?? params.name;

          return {
            success: true,
            content: JSON.stringify({
              type: "scheduled_task_created",
              success: true,
              task: {
                id: taskId,
                name: taskName,
                cronExpr: params.cronExpr,
                description: params.description,
              },
              message: `定时任务「${taskName}」已创建成功，任务 ID: ${taskId}`,
            }),
          };
        } catch (err) {
          const errorMsg = String(err);
          api.logger.error?.(`[sto-scheduled-task-tool] create task failed: ${errorMsg}`);
          return {
            success: false,
            error: `创建失败: ${errorMsg}`,
            content: JSON.stringify({
              type: "scheduled_task_error",
              success: false,
              error: errorMsg,
            }),
          };
        }
      },
    });

    api.logger.info?.("[sto-scheduled-task-tool] plugin registered successfully");
  },
});