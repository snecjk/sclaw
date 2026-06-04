import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { definePluginEntry, type OpenClawPluginApi } from "./api.js";

const TAG = "sto-skill-call-monitor";
const DEFAULT_TIMEOUT_MS = 5000;
const DEFAULT_SSO_AUTH_PATH = "~/.stoclaw/openclaw/sso-auth.json";

type SkillCallMonitorConfig = {
  reportApiUrl?: string;
  ssoAuthPath?: string;
  timeoutMs?: number;
};

type SsoAuthInfo = {
  userName?: string;
  stoToken?: string;
};

function resolveTildePath(filePath: string): string {
  if (filePath.startsWith("~/") || filePath.startsWith("~\\")) {
    return resolve(homedir(), filePath.slice(2));
  }
  return resolve(filePath);
}

async function readSsoAuth(ssoAuthPath: string): Promise<SsoAuthInfo> {
  const resolved = resolveTildePath(ssoAuthPath);
  const raw = await readFile(resolved, "utf-8");
  const parsed = JSON.parse(raw) as Record<string, unknown>;
  return {
    userName: typeof parsed.userName === "string" ? parsed.userName : undefined,
    stoToken: typeof parsed.stoToken === "string" ? parsed.stoToken : undefined,
  };
}

const logSkillUsageParameters = {
  type: "object" as const,
  properties: {
    skill_slug: {
      type: "string" as const,
      description: "使用的 skill 标识（即 SKILL.md 所在目录名）",
    },
    skill_name: {
      type: "string" as const,
      description: "skill 的显示名称",
    },
    result: {
      type: "string" as const,
      enum: ["success", "failed", "partial"],
      description: "执行结果：success / failed / partial",
    },
    notes: {
      type: "string" as const,
      description: "备注：简要说明本次 skill 执行了什么操作",
    },
  },
  required: ["skill_slug", "skill_name", "result"],
};

export default definePluginEntry({
  id: "sto-skill-call-monitor",
  name: "技能调用监控",
  description: "注册 log_skill_usage 工具，让 agent 在使用 skill 后主动上报调用日志。",
  register(api: OpenClawPluginApi) {
    const pluginCfg = (api.pluginConfig ?? {}) as SkillCallMonitorConfig;
    const reportApiUrl = pluginCfg.reportApiUrl?.trim();
    const timeoutMs = pluginCfg.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const ssoAuthPath = pluginCfg.ssoAuthPath?.trim() || DEFAULT_SSO_AUTH_PATH;

    api.logger.info?.(
      `[${TAG}] plugin registering — reportApiUrl=${reportApiUrl ?? "(not set)"}, ssoAuthPath=${ssoAuthPath}`,
    );

    api.registerTool({
      name: "log_skill_usage",
      description:
        "记录一次 skill 的使用结果。每次使用完一个 skill 后，必须调用此工具上报日志，包括 skill 标识、名称、执行结果和备注。",
      parameters: logSkillUsageParameters,
      async execute(_id: string, params: Record<string, unknown>) {
        const { skill_slug, skill_name, result, notes } = params as {
          skill_slug: string;
          skill_name: string;
          result: string;
          notes?: string;
        };

        api.logger.info?.(
          `[${TAG}] skill_usage: slug=${skill_slug} name=${skill_name} result=${result} notes=${notes ?? "-"}`,
        );

        // Fire-and-forget HTTP POST to backend (non-blocking, failures are silently logged)
        if (reportApiUrl) {
          (async () => {
            const headers: Record<string, string> = { "Content-Type": "application/json" };
            try {
              const ssoAuth = await readSsoAuth(ssoAuthPath);
              if (ssoAuth.stoToken) headers["stotoken"] = ssoAuth.stoToken;
            } catch (err) {
              api.logger.warn?.(
                `[${TAG}] failed to read SSO auth from ${resolveTildePath(ssoAuthPath)} (${String(err)}), sending without SSO headers`,
              );
            }

            try {
              const resp = await fetch(reportApiUrl, {
                method: "POST",
                headers,
                body: JSON.stringify({ skill_slug, skill_name, result, notes: notes ?? "" }),
                signal: AbortSignal.timeout(timeoutMs),
              });
              api.logger.info?.(
                `[${TAG}] usage-report: POST ${reportApiUrl} status=${resp.status}`,
              );
            } catch (err) {
              api.logger.warn?.(
                `[${TAG}] usage-report: POST ${reportApiUrl} failed (${String(err)})`,
              );
            }
          })();
        }

        return {
          content: [
            {
              type: "text" as const,
              text: `✓ 已记录 skill 使用日志: ${skill_name} (${result})`,
            },
          ],
        };
      },
    });

    api.logger.info?.(`[${TAG}] plugin registered — log_skill_usage tool available`);
  },
});
