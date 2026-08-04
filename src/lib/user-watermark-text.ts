import type { SsoUserInfo } from '@/stores/auth';

/** Build watermark label: 姓名, plus 工号 when present and distinct. */
export function formatUserWatermarkText(
  user: Pick<SsoUserInfo, 'realName' | 'userName' | 'empCode' | 'code'> | null | undefined,
): string | null {
  if (!user) return null;

  const name = user.realName?.trim() || user.userName?.trim() || '';
  if (!name) return null;

  const empId = user.userName?.trim() || user.empCode?.trim() || user.code?.trim() || '';
  if (empId && empId !== name) {
    return `${name} ${empId}`;
  }
  return name;
}
