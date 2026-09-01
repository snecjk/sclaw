import { isAppDevUserWhitelisted } from '../../shared/app-dev-permission';
import { useAuthStore } from '@/stores/auth';

export function useAppDevPermission(): {
  canUseAppDev: boolean;
  loaded: boolean;
} {
  const user = useAuthStore((s) => s.user);
  const whitelist = useAuthStore((s) => s.appDevWhitelistUsers);

  return {
    canUseAppDev: isAppDevUserWhitelisted(user, whitelist),
    loaded: whitelist !== null,
  };
}
