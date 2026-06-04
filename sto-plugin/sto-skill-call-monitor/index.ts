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

type PendingSkillUsage = {
  slug: string;
  name: string;
  reported: boolean;
};

const RECENT_EXPLICIT_TTL_MS = 5 * 60 * 1000;

const pendingSkillUsageBySession = new Map<string, Map<string, PendingSkillUsage>>();
const recentExplicitSkillReports = new Map<string, number>();

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

function sessionCacheKey(sessionKey?: string, sessionId?: string): string | undefined {
  const key = sessionKey?.trim() || sessionId?.trim();
  return key || undefined;
}

function getOrCreateSessionUsage(sessionKey?: string, sessionId?: string) {
  const key = sessionCacheKey(sessionKey, sessionId);
  if (!key) return undefined;
  let pending = pendingSkillUsageBySession.get(key);
  if (!pending) {
    pending = new Map<string, PendingSkillUsage>();
    pendingSkillUsageBySession.set(key, pending);
  }
  return pending;
}

function rememberExplicitSkillReport(skillSlug: string): void {
  recentExplicitSkillReports.set(skillSlug, Date.now());
}

function hasRecentExplicitSkillReport(skillSlug: string): boolean {
  const at = recentExplicitSkillReports.get(skillSlug);
  if (!at) return false;
  if (Date.now() - at > RECENT_EXPLICIT_TTL_MS) {
    recentExplicitSkillReports.delete(skillSlug);
    return false;
  }
  return true;
}

function markSessionSkillReported(
  sessionKey: string | undefined,
  sessionId: string | undefined,
  skillSlug: string,
): void {
  rememberExplicitSkillReport(skillSlug);
  const pending = getOrCreateSessionUsage(sessionKey, sessionId);
  if (!pending) return;
  const current = pending.get(skillSlug);
  if (current) {
    current.reported = true;
    current.name = current.name || skillSlug;
  } else {
    pending.set(skillSlug, {
      slug: skillSlug,
      name: skillSlug,
      reported: true,
    });
  }
}

function extractSkillSlugsFromValue(value: unknown, found = new Set<string>()): Set<string> {
  if (typeof value === "string") {
    const normalized = value.replace(/\\/g, "/");
    const matches = normalized.matchAll(/\/([^/\s]+)\/SKILL\.md\b/g);
    for (const match of matches) {
      const slug = match[1]?.trim();
      if (slug) {
        found.add(slug);
      }
    }
    return found;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      extractSkillSlugsFromValue(item, found);
    }
    return found;
  }
  if (value && typeof value === "object") {
    for (const nested of Object.values(value as Record<string, unknown>)) {
      extractSkillSlugsFromValue(nested, found);
    }
  }
  return found;
}

function rememberDetectedSkills(
  sessionKey: string | undefined,
  sessionId: string | undefined,
  source: unknown,
): void {
  const pending = getOrCreateSessionUsage(sessionKey, sessionId);
  if (!pending) return;
  for (const slug of extractSkillSlugsFromValue(source)) {
    const current = pending.get(slug);
    if (current) {
      current.name = current.name || slug;
      continue;
    }
    pending.set(slug, {
      slug,
      name: slug,
      reported: hasRecentExplicitSkillReport(slug),
    });
  }
}

async function postSkillUsage(
  api: OpenClawPluginApi,
  options: {
    reportApiUrl?: string;
    ssoAuthPath: string;
    timeoutMs: number;
  },
  payload: {
    skill_slug: string;
    skill_name: string;
    result: string;
    notes?: string;
  },
): Promise<void> {
  const { reportApiUrl, ssoAuthPath, timeoutMs } = options;
  const { skill_slug, skill_name, result, notes } = payload;

  api.logger.info?.(
    `[${TAG}] skill_usage: slug=${skill_slug} name=${skill_name} result=${result} notes=${notes ?? "-"}`,
  );

  if (!reportApiUrl) {
    return;
  }

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
        rememberExplicitSkillReport(skill_slug);
        void postSkillUsage(
          api,
          { reportApiUrl, ssoAuthPath, timeoutMs },
          { skill_slug, skill_name, result, notes },
        );

        return {
          content: [],
        };
      },
    });

    api.on("before_prompt_build", () => ({
      appendSystemContext:
        "如果本轮读取并使用了任何 SKILL.md，完成该 Skill 后必须立即调用 log_skill_usage。若遗漏，系统会在本轮结束时自动补报 partial 记录。",
    }));

    api.on("after_tool_call", (event, ctx) => {
      const record = event as Record<string, unknown>;
      const skillSlug =
        typeof record.toolName === "string" && record.toolName === "log_skill_usage"
          ? typeof record.skill_slug === "string"
            ? record.skill_slug
            : typeof (record.params as Record<string, unknown> | undefined)?.skill_slug === "string"
              ? (record.params as Record<string, unknown>).skill_slug as string
              : undefined
          : undefined;

      if (skillSlug) {
        markSessionSkillReported(ctx.sessionKey, ctx.sessionId, skillSlug);
        return;
      }

      rememberDetectedSkills(ctx.sessionKey, ctx.sessionId, record);
    });

    api.on("agent_end", (event, ctx) => {
      void (async () => {
        const key = sessionCacheKey(ctx.sessionKey, event.sessionId ?? ctx.sessionId);
        if (!key) return;
        const pending = pendingSkillUsageBySession.get(key);
        pendingSkillUsageBySession.delete(key);
        if (!pending || pending.size === 0) return;

        for (const item of pending.values()) {
          if (item.reported || hasRecentExplicitSkillReport(item.slug)) {
            continue;
          }
          item.reported = true;
          await postSkillUsage(
            api,
            { reportApiUrl, ssoAuthPath, timeoutMs },
            {
              skill_slug: item.slug,
              skill_name: item.name || item.slug,
              result: "partial",
              notes: "auto-fallback: detected SKILL.md usage but agent did not call log_skill_usage",
            },
          );
        }
      })().catch((err) => {
        api.logger.warn?.(`[${TAG}] agent_end fallback reporting failed (${String(err)})`);
      });
    });

    api.logger.info?.(`[${TAG}] plugin registered — log_skill_usage tool available`);
  },
});
