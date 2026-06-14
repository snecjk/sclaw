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
};

const pendingSkillUsageBySession = new Map<string, Map<string, PendingSkillUsage>>();
const DEFAULT_ALLOWED_SKILL_PATH_MARKERS = [
  "/.stoclaw/openclaw/skills/",
];

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

function normalizePath(value: string): string {
  return value.replace(/\\/g, "/");
}

function isAllowedSkillPath(value: string): boolean {
  const normalized = normalizePath(value).toLowerCase();
  return DEFAULT_ALLOWED_SKILL_PATH_MARKERS.some((marker) => normalized.includes(marker.toLowerCase()));
}

function extractSkillSlugsFromValue(value: unknown, found = new Set<string>()): Set<string> {
  if (typeof value === "string") {
    const normalized = normalizePath(value);
    if (!isAllowedSkillPath(normalized)) {
      return found;
    }
    const matches = normalized.matchAll(/\/skills\/([^/\s]+)\/skill\.md\b/gi);
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
  api: OpenClawPluginApi,
  sessionKey: string | undefined,
  sessionId: string | undefined,
  source: unknown,
): void {
  const pending = getOrCreateSessionUsage(sessionKey, sessionId);
  if (!pending) {
    api.logger.debug?.(
      `[${TAG}] detect-skill: skipped because no session cache key (sessionKey=${sessionKey ?? "-"} sessionId=${sessionId ?? "-"})`,
    );
    return;
  }

  const detected = Array.from(extractSkillSlugsFromValue(source));
  api.logger.info?.(
    `[${TAG}] detect-skill: sessionKey=${sessionKey ?? "-"} sessionId=${sessionId ?? "-"} detected=${detected.length > 0 ? detected.join(",") : "(none)"}`,
  );

  for (const slug of detected) {
    const current = pending.get(slug);
    if (current) {
      current.name = current.name || slug;
      api.logger.debug?.(
        `[${TAG}] detect-skill: already pending slug=${slug} sessionKey=${sessionKey ?? "-"} sessionId=${sessionId ?? "-"}`,
      );
      continue;
    }
    pending.set(slug, {
      slug,
      name: slug,
    });
    api.logger.info?.(
      `[${TAG}] detect-skill: queued slug=${slug} sessionKey=${sessionKey ?? "-"} sessionId=${sessionId ?? "-"}`,
    );
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

export default definePluginEntry({
  id: "sto-skill-call-monitor",
  name: "技能调用监控",
  description: "检测 Skill 使用并在会话结束时自动上报调用日志。",
  register(api: OpenClawPluginApi) {
    const pluginCfg = (api.pluginConfig ?? {}) as SkillCallMonitorConfig;
    const reportApiUrl = pluginCfg.reportApiUrl?.trim();
    const timeoutMs = pluginCfg.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const ssoAuthPath = pluginCfg.ssoAuthPath?.trim() || DEFAULT_SSO_AUTH_PATH;

    api.logger.info?.(
      `[${TAG}] plugin registering — reportApiUrl=${reportApiUrl ?? "(not set)"}, ssoAuthPath=${ssoAuthPath}`,
    );

    api.on("after_tool_call", (event, ctx) => {
      const record = event as Record<string, unknown>;
      const toolName = typeof record.toolName === "string" ? record.toolName : "(unknown)";
      api.logger.info?.(
        `[${TAG}] after_tool_call: toolName=${toolName} sessionKey=${ctx.sessionKey ?? "-"} sessionId=${ctx.sessionId ?? "-"} keys=${Object.keys(record).join(",")}`,
      );
      rememberDetectedSkills(api, ctx.sessionKey, ctx.sessionId, event);
    });

    api.on("agent_end", (event, ctx) => {
      void (async () => {
        const key = sessionCacheKey(ctx.sessionKey, event.sessionId ?? ctx.sessionId);
        api.logger.info?.(
          `[${TAG}] agent_end: sessionKey=${ctx.sessionKey ?? "-"} sessionId=${ctx.sessionId ?? "-"} eventSessionId=${event.sessionId ?? "-"} cacheKey=${key ?? "-"}`,
        );
        if (!key) {
          api.logger.warn?.(`[${TAG}] agent_end: missing cache key, skip auto-report`);
          return;
        }
        const pending = pendingSkillUsageBySession.get(key);
        pendingSkillUsageBySession.delete(key);
        api.logger.info?.(
          `[${TAG}] agent_end: pendingSkills=${pending ? Array.from(pending.keys()).join(",") || "(none)" : "(missing cache)"}`,
        );
        if (!pending || pending.size === 0) {
          api.logger.warn?.(`[${TAG}] agent_end: no detected skills to report for cacheKey=${key}`);
          return;
        }

        for (const item of pending.values()) {
          api.logger.info?.(
            `[${TAG}] agent_end: posting slug=${item.slug} skillName=${item.name || item.slug} cacheKey=${key}`,
          );
          await postSkillUsage(
            api,
            { reportApiUrl, ssoAuthPath, timeoutMs },
            {
              skill_slug: item.slug,
              skill_name: item.name || item.slug,
              result: "success",
              notes: `auto-report: detected skill usage (${item.slug})`,
            },
          );
        }
      })().catch((err) => {
        api.logger.warn?.(`[${TAG}] agent_end auto-report failed (${String(err)})`);
      });
    });

    api.logger.info?.(`[${TAG}] plugin registered — automatic skill usage reporting enabled`);
  },
});
