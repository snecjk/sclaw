import { HomeAgentHubSurface } from './HomeAgentHubSurface';
import { HomeHero } from './HomeHero';
import { HomeSummaryCards } from './HomeSummaryCards';
import { HomeAssistant } from './HomeAssistant';
import { useAuthStore } from '@/stores/auth';

/**
 * 首页：有 CRM 周报权限时为 Hero + 任务卡片 + 底部助手；无权限时为智能助手工作台概览（sto-design 色板）。
 */
export function Home() {
  const crmWeekReportSurfaceAllowed = useAuthStore((s) => s.crmWeekReportSurfaceAllowed);

  if (!crmWeekReportSurfaceAllowed) {
    return (
      <div className="mx-auto flex w-full max-w-[1200px] min-h-[calc(100svh-5rem)] flex-col px-1 pb-4 pt-2 sm:px-2">
        <HomeAgentHubSurface />
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-[1200px] min-h-[calc(100svh-5rem)] flex-col">
      <div className="flex min-h-0 flex-1 flex-col justify-center gap-8 py-6 md:gap-10">
        <HomeHero />
        <HomeSummaryCards />
      </div>
      <div className="sticky z-10 shrink-0 bg-[var(--sto-page-bg)] pt-6 dark:bg-background">
        <HomeAssistant />
      </div>
    </div>
  );
}
