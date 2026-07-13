import { useTranslation } from 'react-i18next';
import homeHeroMascot from '@/assets/logo.png';
import homeHeroBrandSvg from '@/assets/SClawlogo.svg';
import homeHeroBrandSvgDark from '@/assets/SClawlogo_black.svg';
import { cn } from '@/lib/utils';

/** MasterGo 8:51873 — 字标+笔触合成 SVG 展示尺寸（组 7137） */
const HOME_HERO_BRAND_W = 85;
const HOME_HERO_BRAND_H = 32;

const homeHeroBrandClass =
  'mt-[10px] h-[32px] w-[85px] shrink-0 object-contain object-left';

/** 首页 Hero 字标：浅色用 SClawlogo.svg，暗色用 SClawlogo_black.svg（白字） */
function HomeHeroBrandLogo() {
  return (
    <>
      <img
        src={homeHeroBrandSvg}
        alt=""
        width={HOME_HERO_BRAND_W}
        height={HOME_HERO_BRAND_H}
        className={cn(homeHeroBrandClass, 'dark:hidden')}
      />
      <img
        src={homeHeroBrandSvgDark}
        alt=""
        width={HOME_HERO_BRAND_W}
        height={HOME_HERO_BRAND_H}
        className={cn(homeHeroBrandClass, 'hidden dark:block')}
      />
    </>
  );
}

/**
 * 首页 Hero：左对齐吉祥物 + SClaw 字标（含橙色笔触）+ 主副标题。
 *
 * 布局来自 MasterGo `8:51873`（容器 7311）：纵向 gap 8；文案区 pl 4、gap 10；
 * 标题行 gap 0（字标与主标题紧贴），字标组 y 偏移 10px 与 24/36 主标题对齐。
 */
export function HomeHero({
  className,
  variant = 'default',
}: {
  className?: string;
  variant?: 'default' | 'site';
}) {
  const { t } = useTranslation('home');
  const titleKey = variant === 'site' ? 'site.hero.title' : 'hero.title';
  const subtitleKey = variant === 'site' ? 'site.hero.subtitle' : 'hero.subtitle';

  return (
    <section className={cn('flex flex-col items-start gap-2', className)}>
      <img
        src={homeHeroMascot}
        alt=""
        width={50}
        height={50}
        className="hero-mascot-idle block h-[50px] w-[50px] shrink-0 object-contain"
      />
      <div className="flex flex-col gap-2.5 pl-1">
        <div className="flex items-start gap-0">
          <HomeHeroBrandLogo />
          <h1 className="text-2xl font-semibold leading-9 tracking-normal text-foreground">
            {t(titleKey)}
          </h1>
        </div>
        <p className="text-[15px] leading-5 text-muted-foreground">{t(subtitleKey)}</p>
      </div>
    </section>
  );
}
