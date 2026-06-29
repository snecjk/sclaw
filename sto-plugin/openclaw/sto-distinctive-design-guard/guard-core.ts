import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

export const DISTINCTIVE_DESIGN_SKILL_SLUG = "sto-distinctive-design";
export const CLI_REPORT_GENERATOR_SLUG = "cli-report-generator";

const SKILL_PATH_MARKERS = [
  `/.stoclaw/openclaw/skills/${DISTINCTIVE_DESIGN_SKILL_SLUG}/skill.md`,
  `/skills/${DISTINCTIVE_DESIGN_SKILL_SLUG}/skill.md`,
] as const;

const HTML_WRITE_TOOLS = new Set([
  "write",
  "edit",
  "apply_patch",
  "file_write",
  "writefile",
  "str_replace",
  "create",
]);

const COMMAND_PARAM_KEYS = [
  "command",
  "cmd",
  "script",
  "input",
  "argv",
  "args",
  "program",
  "line",
  "shellCommand",
  "shell_command",
  "arguments",
  "request",
] as const;

const PATH_PARAM_KEYS = [
  "path",
  "file_path",
  "filePath",
  "target",
  "target_path",
  "filename",
  "file",
] as const;

export const DISTINCTIVE_DESIGN_ROUTING_PROMPT = [
  "【HTML 产物默认规范 · P0】",
  "凡生成/汇总/可视化报告、看板、周报/月报、分析页、数据页面、HTML 幻灯片等可交付 HTML 产物：",
  "1. 必须先 read sto-distinctive-design 的 SKILL.md（及需要的 references/金标准 example-sto*.html）",
  "2. 再 write 到 ./.claw-output/<文件名>.html（路径与回复 file:/// 链接逐字一致）",
  "3. 写完后跑：python3 ~/.stoclaw/openclaw/skills/sto-distinctive-design/lint.py <file>，P0 必须修完再交付",
  "",
  "例外（不走 sto-distinctive-design）：",
  "- 用户点名非 HTML 交付物：.pptx / .docx / .xlsx / .pdf / .csv → 用对应技能",
  "- 用户明确纯文本/不要 HTML/简单回答",
  "- 用户明确要求 CLI+cron+generate_report.py 无人值守流水线（cli-report-generator）",
  "- 纯 Q&A、后端代码、非产物对话",
  "",
  "禁止：自造通用 AI 仪表盘 HTML、跳过技能直接 write .html。",
].join("\n");

export type GuardDecision =
  | { allowed: true }
  | { allowed: false; reason: string };

type SessionGuardState = {
  skillsRead: Set<string>;
};

const sessions = new Map<string, SessionGuardState>();

export function resetDistinctiveDesignGuardSessionsForTests(): void {
  sessions.clear();
}

export function normalizeToolName(toolName: string): string {
  const parts = toolName.split("__");
  return (parts[parts.length - 1] || toolName).trim().toLowerCase();
}

export function normalizePath(value: string): string {
  return value.replace(/\\/g, "/");
}

export function isHtmlPath(pathValue: string): boolean {
  const normalized = normalizePath(pathValue).toLowerCase();
  const withoutQuery = normalized.split("?")[0]?.split("#")[0] ?? normalized;
  return /\.html?$/.test(withoutQuery);
}

function expandTildePath(filePath: string): string {
  if (filePath.startsWith("~/") || filePath.startsWith("~\\")) {
    return resolve(homedir(), filePath.slice(2));
  }
  return resolve(filePath);
}

export function resolveHtmlFilePath(pathArg: string): string {
  const expanded = expandTildePath(pathArg);
  if (existsSync(expanded)) {
    return expanded;
  }

  const workspaceRoot = join(homedir(), ".stoclaw", "openclaw", "workspace");
  const relative = pathArg.replace(/^\.\//, "");
  const underWorkspace = join(workspaceRoot, relative);
  if (existsSync(underWorkspace)) {
    return underWorkspace;
  }

  const underClawOutput = join(workspaceRoot, ".claw-output", relative.replace(/^\.claw-output\//, ""));
  if (existsSync(underClawOutput)) {
    return underClawOutput;
  }

  return expanded;
}

export function collectStrings(value: unknown, out: string[] = []): string[] {
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed) out.push(trimmed);
    return out;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectStrings(item, out);
    return out;
  }
  if (!value || typeof value !== "object") {
    return out;
  }

  for (const nested of Object.values(value as Record<string, unknown>)) {
    collectStrings(nested, out);
  }
  return out;
}

export function extractPathFromParams(params: Record<string, unknown> | undefined): string | null {
  if (!params) return null;

  for (const key of PATH_PARAM_KEYS) {
    const value = params[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }

  return null;
}

export function isAllowedSkillPath(value: string): boolean {
  const normalized = normalizePath(value).toLowerCase();
  return normalized.includes("/.stoclaw/openclaw/skills/") || normalized.includes("/skills/");
}

export function extractSkillSlugsFromValue(value: unknown, found = new Set<string>()): Set<string> {
  if (typeof value === "string") {
    const normalized = normalizePath(value);
    if (!isAllowedSkillPath(normalized)) {
      return found;
    }
    const matches = normalized.matchAll(/\/skills\/([^/\s]+)\/skill\.md\b/gi);
    for (const match of matches) {
      const slug = match[1]?.trim();
      if (slug) {
        found.add(slug.toLowerCase());
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

function sessionCacheKey(sessionKey?: string, sessionId?: string): string | undefined {
  const key = sessionKey?.trim() || sessionId?.trim();
  return key || undefined;
}

export function getSessionState(sessionKey?: string, sessionId?: string): SessionGuardState | undefined {
  const key = sessionCacheKey(sessionKey, sessionId);
  if (!key) return undefined;

  let state = sessions.get(key);
  if (!state) {
    state = { skillsRead: new Set<string>() };
    sessions.set(key, state);
  }
  return state;
}

export function noteSkillUsageFromToolPayload(
  sessionKey: string | undefined,
  sessionId: string | undefined,
  payload: unknown,
): string[] {
  const state = getSessionState(sessionKey, sessionId);
  if (!state) return [];

  const detected = Array.from(extractSkillSlugsFromValue(payload));
  for (const slug of detected) {
    state.skillsRead.add(slug);
  }
  return detected;
}

export function hasReadDistinctiveDesignSkill(sessionKey?: string, sessionId?: string): boolean {
  const state = getSessionState(sessionKey, sessionId);
  return state?.skillsRead.has(DISTINCTIVE_DESIGN_SKILL_SLUG) ?? false;
}

export function isCliReportGeneratorPipeline(toolName: string, params?: Record<string, unknown>): boolean {
  const name = normalizeToolName(toolName);
  if (name !== "bash" && name !== "exec" && name !== "shell") {
    return false;
  }

  const chunks: string[] = [];
  if (params) {
    for (const key of COMMAND_PARAM_KEYS) {
      const nested = params[key];
      if (nested != null) collectStrings(nested, chunks);
    }
  }

  const commandText = chunks.join("\n");
  return /generate_report\.py/i.test(commandText);
}

export function evaluateBeforeHtmlWrite(input: {
  toolName: string;
  params?: Record<string, unknown>;
  sessionKey?: string;
  sessionId?: string;
}): GuardDecision {
  const toolName = normalizeToolName(input.toolName);
  if (!HTML_WRITE_TOOLS.has(toolName)) {
    return { allowed: true };
  }

  const targetPath = extractPathFromParams(input.params);
  if (!targetPath || !isHtmlPath(targetPath)) {
    return { allowed: true };
  }

  if (isCliReportGeneratorPipeline(input.toolName, input.params)) {
    return { allowed: true };
  }

  if (hasReadDistinctiveDesignSkill(input.sessionKey, input.sessionId)) {
    return { allowed: true };
  }

  return {
    allowed: false,
    reason: [
      "生成 HTML 报告/看板/页面前，必须先读取 sto-distinctive-design 技能。",
      "请 read：~/.stoclaw/openclaw/skills/sto-distinctive-design/SKILL.md",
      "（按需 read references/ 与 example-sto*.html），再 write 到 ./.claw-output/<文件名>.html。",
      "写完后运行 lint.py 校验 P0 项。",
      "例外：用户明确要求 CLI+cron+generate_report.py 无人值守流水线（cli-report-generator）。",
    ].join("\n"),
  };
}

export function resolveDistinctiveDesignSkillDir(): string | null {
  const candidates = [
    process.env.STO_DISTINCTIVE_DESIGN_SKILL_DIR?.trim(),
    join(homedir(), ".stoclaw", "openclaw", "skills", DISTINCTIVE_DESIGN_SKILL_SLUG),
  ].filter((value): value is string => Boolean(value));

  for (const candidate of candidates) {
    const lintPath = join(candidate, "lint.py");
    if (existsSync(lintPath)) {
      return candidate;
    }
  }

  return null;
}

export function runDistinctiveDesignLint(htmlPath: string): {
  ok: boolean;
  exitCode: number;
  output: string;
  skipped: boolean;
} {
  const skillDir = resolveDistinctiveDesignSkillDir();
  if (!skillDir) {
    return { ok: true, exitCode: 0, output: "", skipped: true };
  }

  const resolvedPath = resolveHtmlFilePath(htmlPath);
  if (!existsSync(resolvedPath)) {
    return {
      ok: true,
      exitCode: 0,
      output: `lint skipped: file not found (${resolvedPath})`,
      skipped: true,
    };
  }

  const lintScript = join(skillDir, "lint.py");
  const result = spawnSync("python3", [lintScript, resolvedPath], {
    encoding: "utf-8",
    timeout: 30_000,
  });

  const output = [result.stdout, result.stderr].filter(Boolean).join("\n").trim();
  const exitCode = typeof result.status === "number" ? result.status : 1;
  return {
    ok: exitCode === 0,
    exitCode,
    output,
    skipped: false,
  };
}

export function formatLintFailureMessage(lintOutput: string, htmlPath: string): string {
  return [
    "⚠️ sto-distinctive-design lint 检测到 P0 违规，必须修复后重新 write 再交付：",
    `文件：${htmlPath}`,
    "",
    lintOutput || "(lint 无输出，退出码非 0)",
    "",
    "请 read SKILL.md / references 对照修复，修完后再次 write 并重新跑 lint.py。",
  ].join("\n");
}

export function shouldLintAfterHtmlWrite(input: {
  toolName: string;
  params?: Record<string, unknown>;
  hasError?: boolean;
}): string | null {
  if (input.hasError) return null;

  const toolName = normalizeToolName(input.toolName);
  if (!HTML_WRITE_TOOLS.has(toolName)) return null;

  const targetPath = extractPathFromParams(input.params);
  if (!targetPath || !isHtmlPath(targetPath)) return null;

  return targetPath;
}

export function pathReferencesDistinctiveDesignSkill(value: unknown): boolean {
  if (typeof value !== "string") return false;
  const normalized = normalizePath(value).toLowerCase();
  return SKILL_PATH_MARKERS.some((marker) => normalized.includes(marker));
}
