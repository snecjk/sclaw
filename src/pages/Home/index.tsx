import { HomeHero } from './HomeHero';
import { HomeSummaryCards } from './HomeSummaryCards';
import { HomeAssistant } from './HomeAssistant';
import { useAuthStore } from '@/stores/auth';

/**
 * 首页：上部（Logo / 欢迎语 / 卡片）在剩余区域内垂直居中；底部输入区 sticky 贴底并留出 34px。
 */
export function Home() {
  const crmWeekReportSurfaceAllowed = useAuthStore((s) => s.crmWeekReportSurfaceAllowed);

  return (
    <div className="mx-auto flex w-full max-w-[1200px] min-h-[calc(100svh-5rem)] flex-col">
      <div className="flex min-h-0 flex-1 flex-col justify-center gap-8 py-6 md:gap-10">
        <HomeHero />
        {crmWeekReportSurfaceAllowed ? <HomeSummaryCards /> : null}
      </div>
      <div className="sticky z-10 shrink-0 bg-[var(--sto-page-bg)] pt-6 dark:bg-background">
        <HomeAssistant />
      </div>
    </div>
  );
}
