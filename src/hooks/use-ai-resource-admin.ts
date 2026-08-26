import { useAuthStore } from '@/stores/auth';
import { hasSystemAdminRole } from '../../shared/sso-roles';

/** 按当前 AI 资源账号（演示切网点时用 impersonationOrigin）判断是否超级管理员。 */
export function useAiResourceAdmin(): boolean {
  const user = useAuthStore((s) => s.user);
  const impersonationOrigin = useAuthStore((s) => s.impersonationOrigin);
  const aiUser = impersonationOrigin ?? user;
  return hasSystemAdminRole(aiUser?.roles);
}
