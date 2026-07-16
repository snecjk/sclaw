/**
 * Shared agent workspace path conventions.
 *
 * Default agent workspaces live directly under ~/.stoclaw/ (engine-agnostic).
 * OpenClaw/Claude engine config remains under ~/.stoclaw/openclaw and ~/.stoclaw/.claude.
 */

export const DEFAULT_WORKSPACE_TILDE = '~/.stoclaw/workspace';
export const LEGACY_OPENCLAW_MAIN_WORKSPACE_TILDE = '~/.stoclaw/openclaw/workspace';
/** Canonical relative dir for local skill/agent artifacts under a workspace. */
export const WORKSPACE_ARTIFACT_OUTPUT_DIRNAME = '.claw-output';
const LEGACY_OPENCLAW_AGENT_WORKSPACE_PREFIX = '~/.stoclaw/openclaw/workspace-';
const MANAGED_AGENT_WORKSPACE_PREFIX = '~/.stoclaw/workspace-';

/** Tilde path for an agent's managed workspace directory. */
export function getAgentWorkspaceTildePath(agentId: string): string {
  const id = (agentId ?? '').trim().toLowerCase();
  if (!id || id === 'main') return DEFAULT_WORKSPACE_TILDE;
  return `${MANAGED_AGENT_WORKSPACE_PREFIX}${id}`;
}

/** Previous default layout before workspace was lifted out of openclaw/. */
export function getLegacyAgentWorkspaceTildePath(agentId: string): string {
  const id = (agentId ?? '').trim().toLowerCase();
  if (!id || id === 'main') return LEGACY_OPENCLAW_MAIN_WORKSPACE_TILDE;
  return `${LEGACY_OPENCLAW_AGENT_WORKSPACE_PREFIX}${id}`;
}

/**
 * Rewrite legacy default workspace tilde paths to the shared layout.
 * Custom/user paths are returned unchanged.
 */
export function migrateWorkspaceTildePath(workspace: string | undefined | null): string | null {
  const trimmed = (workspace ?? '').trim();
  if (!trimmed) return null;
  if (trimmed === LEGACY_OPENCLAW_MAIN_WORKSPACE_TILDE) return DEFAULT_WORKSPACE_TILDE;
  if (trimmed.startsWith(LEGACY_OPENCLAW_AGENT_WORKSPACE_PREFIX)) {
    const suffix = trimmed.slice(LEGACY_OPENCLAW_AGENT_WORKSPACE_PREFIX.length);
    if (suffix) return `${MANAGED_AGENT_WORKSPACE_PREFIX}${suffix}`;
  }
  return trimmed;
}

/** Join workspace root with `.claw-output` (POSIX `/` separators for prompts / URLs). */
export function getWorkspaceArtifactOutputRelPath(
  workspacePath: string,
  fileName?: string,
): string {
  const root = workspacePath.replace(/[/\\]+$/, '').replace(/\\/g, '/');
  const base = `${root}/${WORKSPACE_ARTIFACT_OUTPUT_DIRNAME}`;
  if (!fileName?.trim()) return base;
  return `${base}/${fileName.trim().replace(/^[/\\]+/, '')}`;
}

/** System-prompt line for local artifact output rules. */
export function buildWorkspaceArtifactOutputRule(
  defaultWorkspaceTilde: string = DEFAULT_WORKSPACE_TILDE,
): string {
  return [
    `- 写入：本地产物必须 save 到当前 workspace 的 \`./${WORKSPACE_ARTIFACT_OUTPUT_DIRNAME}/<文件名>\`（目录通常已存在；若不存在先创建再写）；⛔ 禁止写到工作区根目录、\`outputs/\`、\`output/\`、项目源码目录、skill 目录；⛔ 禁止 \`~/.openclaw/workspace\` 与 \`~/.stoclaw/openclaw/workspace\`（旧路径）。`,
    `- 默认工作区产物目录为 \`${defaultWorkspaceTilde}/${WORKSPACE_ARTIFACT_OUTPUT_DIRNAME}/\`；项目会话以当前项目目录下的 \`${WORKSPACE_ARTIFACT_OUTPUT_DIRNAME}/\` 为准。`,
    '- 路径一致：回复里的 file:/// 绝对路径必须与 write/save 实际路径逐字相同（含文件名）；⛔ 禁止写 A 名、链 B 名。',
    '- 当回复中引用用户可查看或下载的本地产物文件（HTML 报告、PDF、表格、文档等）时，必须输出绝对路径，并优先使用 file:// URL 的 Markdown 链接格式：[文件名](file:///绝对路径)。',
    `- 严禁输出相对路径链接（如 [report.md](report.md)、outputs/...、./${WORKSPACE_ARTIFACT_OUTPUT_DIRNAME}/...、./...）；必须写成绝对路径。`,
    '- Windows：write 时可用正斜杠路径（如 `C:/Users/.../workspace/.claw-output/report.html`）；回复链接必须规范为 `file:///C:/...`（正斜杠），不要输出 `file://C:\\\\...` 或反斜杠版本。',
    '- 如果执行结果仅提供 http(s) 可访问地址（如 OSS 链接）且没有本地绝对路径，则使用该 http(s) 链接；不要伪造 file:// 路径。',
    '- 严禁向用户输出运行环境内部且用户不可访问的伪本地路径（如 /runtime/、/tmp/）作为 file:// 链接。',
  ].join('\n');
}
