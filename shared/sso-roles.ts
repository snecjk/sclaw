export const AI_MEMORY_CENTER_SYSTEM_ADMIN_ROLE = 'AI_MEMORY_CENTER_system_admin';

/** 将 SSO Roles 响应规范化为角色编码列表（支持 string 或带 Code/roleCode 的对象）。 */
export function normalizeSsoRoleCodes(roles: unknown): string[] {
  if (!Array.isArray(roles)) return [];

  const codes: string[] = [];
  for (const role of roles) {
    if (typeof role === 'string') {
      const trimmed = role.trim();
      if (trimmed) codes.push(trimmed);
      continue;
    }
    if (role && typeof role === 'object') {
      const record = role as Record<string, unknown>;
      const code = record.Code ?? record.roleCode ?? record.role_code ?? record.code ?? record.Name ?? record.name;
      if (typeof code === 'string') {
        const trimmed = code.trim();
        if (trimmed) codes.push(trimmed);
      }
    }
  }
  return codes;
}

export function hasSystemAdminRole(roles: string[] | null | undefined): boolean {
  return Array.isArray(roles) && roles.includes(AI_MEMORY_CENTER_SYSTEM_ADMIN_ROLE);
}
