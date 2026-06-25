/**
 * ChromeEnvBadge — 窗口顶栏环境角标（如 [DEV]），供 TitleBar / AppChrome 共用。
 */
import { getCurrentEnvConfig } from '../../../shared/env-config';

const envConfig = getCurrentEnvConfig();

export function ChromeEnvBadge() {
  if (!envConfig.displaySuffix) return null;

  return (
    <span
      className="inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-bold leading-none text-white"
      style={{ backgroundColor: envConfig.badgeColor }}
    >
      {envConfig.displaySuffix}
    </span>
  );
}
