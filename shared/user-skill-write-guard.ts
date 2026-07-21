/**
 * Guard: block filesystem / shell tools from writing skill packages directly.
 * Agents must use save_user_skill so packages land in skills-store.
 */

export const SAVE_USER_SKILL_BLOCK_REASON = [
  '禁止直接向技能目录写入文件。',
  '创建或更新用户技能时，必须调用工具 save_user_skill，传入完整 skillMd（含 YAML frontmatter 的 name + description）与 slug。',
  '直接 write/edit 到 openclaw/skills、workspace/skills 或 skills-store 不会可靠进入「我的技能」。',
  '请改用 save_user_skill；不要用 Bash/Python/其它工具绕过。',
].join(' ');

const FILE_WRITE_TOOL_NAMES = new Set([
  'write',
  'edit',
  'apply_patch',
  'create_file',
  'str_replace',
  'strreplace',
  'search_replace',
  'notebook_edit',
  'edit_notebook',
]);

const SHELL_TOOL_NAMES = new Set([
  'bash',
  'shell',
  'exec',
  'shell.exec',
  'system.exec',
  'system.run',
  'process.exec',
]);

/** Path segments / absolute patterns that indicate a skill package write. */
const SKILL_PATH_RE =
  /(?:^|[/\\])(?:\.?openclaw[/\\])?skills(?:-store)?(?:[/\\]|$)|(?:^|[/\\])skills-store(?:[/\\]|$)|(?:^|[/\\])workspace[/\\]skills(?:[/\\]|$)|(?:^|[/\\])\.claude[/\\]skills(?:[/\\]|$)|~\/\.stoclaw\/(?:openclaw\/)?skills|~\/\.stoclaw\/skills-store/i;

const SHELL_SKILL_WRITE_RE =
  /(?:\b(?:mkdir|touch|cp|mv|install|tee|cat|echo|printf|dd|install)\b[\s\S]{0,200}?(?:[/\\]skills(?:-store)?(?:[/\\"']|$)|skills-store|openclaw\/skills|workspace\/skills))|(?:(?:>>?|tee)\s+[^\n]*skills(?:-store)?[/\\])/i;

export function normalizeToolName(toolName: string): string {
  const trimmed = toolName.trim();
  if (!trimmed) return '';
  const parts = trimmed.split(/__|\//);
  return (parts[parts.length - 1] || trimmed).toLowerCase();
}

export function isSkillPackagePath(raw: string): boolean {
  const path = raw.trim();
  if (!path) return false;
  // Ignore .claw-output and other non-skill paths that merely mention "skills"
  if (/[/\\]\.claw-output[/\\]/i.test(path)) return false;
  return SKILL_PATH_RE.test(path.replace(/\\/g, '/'));
}

function collectPathCandidates(params: Record<string, unknown> | undefined): string[] {
  if (!params) return [];
  const out: string[] = [];
  const keys = [
    'path',
    'file_path',
    'filePath',
    'filepath',
    'target',
    'target_path',
    'targetPath',
    'filename',
    'file',
    'dir',
    'directory',
    'destination',
    'dest',
  ];
  for (const key of keys) {
    const value = params[key];
    if (typeof value === 'string' && value.trim()) out.push(value);
  }
  // apply_patch / multi-file payloads
  if (typeof params.patch === 'string') out.push(params.patch);
  if (typeof params.diff === 'string') out.push(params.diff);
  if (Array.isArray(params.files)) {
    for (const item of params.files) {
      if (typeof item === 'string') out.push(item);
      else if (item && typeof item === 'object') {
        const rec = item as Record<string, unknown>;
        for (const key of ['path', 'file_path', 'filePath']) {
          if (typeof rec[key] === 'string') out.push(String(rec[key]));
        }
      }
    }
  }
  return out;
}

function readShellCommand(params: Record<string, unknown> | undefined): string {
  if (!params) return '';
  for (const key of ['command', 'cmd', 'script', 'bash_command', 'input']) {
    const value = params[key];
    if (typeof value === 'string' && value.trim()) return value;
  }
  return '';
}

export type UserSkillWriteGuardDecision =
  | { blocked: false }
  | { blocked: true; reason: string; matchedPath?: string };

/**
 * Decide whether a tool call should be blocked because it writes into skill dirs.
 */
export function evaluateUserSkillWriteGuard(input: {
  toolName: string;
  params?: Record<string, unknown>;
}): UserSkillWriteGuardDecision {
  const toolName = normalizeToolName(input.toolName);
  if (!toolName) return { blocked: false };

  // Never block the dedicated save tool itself.
  if (toolName === 'save_user_skill' || toolName === 'create_user_skill') {
    return { blocked: false };
  }

  if (FILE_WRITE_TOOL_NAMES.has(toolName)) {
    for (const candidate of collectPathCandidates(input.params)) {
      if (isSkillPackagePath(candidate)) {
        return {
          blocked: true,
          reason: SAVE_USER_SKILL_BLOCK_REASON,
          matchedPath: candidate,
        };
      }
    }
    // Some editors put the path only in a free-form "content" header — also scan stringified params lightly.
    const blob = JSON.stringify(input.params ?? {});
    if (isSkillPackagePath(blob) && /SKILL\.md|skills[/\\]/i.test(blob)) {
      return { blocked: true, reason: SAVE_USER_SKILL_BLOCK_REASON };
    }
    return { blocked: false };
  }

  if (SHELL_TOOL_NAMES.has(toolName)) {
    const command = readShellCommand(input.params);
    if (!command) return { blocked: false };
    if (SHELL_SKILL_WRITE_RE.test(command) || isSkillPackagePath(command)) {
      // Avoid blocking pure reads like `ls ~/.stoclaw/openclaw/skills`
      if (/^\s*(ls|find|tree|cat|head|tail|less|rg|grep)\b/i.test(command.trim())
        && !/\b(mkdir|touch|cp|mv|tee|rm|echo|printf|cat\s*>)\b/i.test(command)) {
        return { blocked: false };
      }
      if (/\b(mkdir|touch|cp|mv|tee|rm|echo|printf|install|dd)\b|(?:>>?)/i.test(command)
        && /skills(?:-store)?/i.test(command)) {
        return {
          blocked: true,
          reason: SAVE_USER_SKILL_BLOCK_REASON,
          matchedPath: command.slice(0, 200),
        };
      }
    }
  }

  return { blocked: false };
}

/**
 * Soft signal: after a tool call, should we schedule orphan skill import?
 * True when the call touched skill paths (even if not blocked — belt and suspenders).
 */
export function shouldScheduleOrphanImportAfterTool(input: {
  toolName: string;
  params?: Record<string, unknown>;
}): boolean {
  const toolName = normalizeToolName(input.toolName);
  if (toolName === 'save_user_skill' || toolName === 'create_user_skill') return false;

  for (const candidate of collectPathCandidates(input.params)) {
    if (isSkillPackagePath(candidate)) return true;
  }
  const command = readShellCommand(input.params);
  if (command && /skills(?:-store)?/i.test(command) && isSkillPackagePath(command)) {
    return true;
  }
  return false;
}
