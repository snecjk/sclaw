import { HomeHero } from './HomeHero';
import { HomeSummaryCards } from './HomeSummaryCards';
import { HomeAssistant } from './HomeAssistant';

/**
 * STO Claw 首页：Hero、概览卡、助手输入区（对齐归档设计稿结构）。
 */
export function Home() {
  return (
    <div className="mx-auto w-full max-w-[var(--sto-main-inner-max)] pb-10">
      <HomeHero />
      <HomeSummaryCards className="mt-10" />
      <HomeAssistant className="mt-10" />
    </div>
  );
}
