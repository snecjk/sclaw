import { getAuthState } from '../utils/auth-store';
import { logger } from '../utils/logger';

export interface AgentCurrentUserContext {
  userName: string;
  code?: string | null;
  realName?: string | null;
  companyCode?: string | null;
  companyName?: string | null;
  departmentCode?: string | null;
  departmentName?: string | null;
}

function trimmed(value: string | null | undefined): string {
  return value?.trim() ?? '';
}

/**
 * Format the allowlisted, non-secret part of the authenticated user for an agent prompt.
 * Authentication tokens, internal ids, roles, and administrator flags must never be added here.
 */
export function formatAgentCurrentUserContext(
  user: AgentCurrentUserContext,
): string | undefined {
  const userName = trimmed(user.userName);
  if (!userName) return undefined;

  const lines = [
    '当前登录用户信息（已认证）：',
    `- 用户名：${userName}`,
  ];
  const code = trimmed(user.code);
  const realName = trimmed(user.realName);
  const companyCode = trimmed(user.companyCode);
  const companyName = trimmed(user.companyName);
  const departmentCode = trimmed(user.departmentCode);
  const departmentName = trimmed(user.departmentName);

  if (code) lines.push(`- 用户工号（code）：${code}`);
  if (realName) lines.push(`- 真实姓名：${realName}`);
  if (companyCode) lines.push(`- 网点编码（companyCode）：${companyCode}`);
  if (companyName) lines.push(`- 网点名称（companyName）：${companyName}`);
  if (departmentCode) lines.push(`- 组织编码（departmentCode）：${departmentCode}`);
  if (departmentName) lines.push(`- 组织名称（departmentName）：${departmentName}`);
  lines.push('');
  lines.push('⚠️ 重要：当调用任何技能、工具或工作流时，如果参数要求提供网点编码（companyCode）或组织编码（departmentCode），而用户没有明确指定其他网点/组织，必须直接使用上述当前登录用户的网点编码和组织编码，禁止向用户询问。不要在对话中要求用户提供这些信息。');
  return lines.join('\n');
}

/** Read the latest login on every turn so account switches cannot reuse stale identity. */
export async function getAgentCurrentUserContextPrompt(): Promise<string | undefined> {
  try {
    const auth = await getAuthState();
    if (!auth.isAuthenticated || !auth.user) {
      logger.debug('[agent-user-context] no authenticated user; skipping prompt injection');
      return undefined;
    }
    const prompt = formatAgentCurrentUserContext(auth.user);
    logger.debug('[agent-user-context] prompt injection resolved', prompt);
    return prompt;
  } catch (error) {
    logger.warn('[agent-user-context] failed to read authenticated user; skipping prompt injection', {
      error: error instanceof Error ? error.message : String(error),
    });
    return undefined;
  }
}
