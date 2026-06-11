import { useTranslation } from 'react-i18next';
import logoSvg from '@/assets/logo.svg';
import { cn } from '@/lib/utils';

/**
 * 首页 Hero：左对齐 Logo + 主副标题（默认经营管理向；site 为网点运营向）。
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
    <section className={cn('flex flex-col items-start', className)}>
      <img
        src={logoSvg}
        alt=""
        className="hero-mascot-idle block h-[58px] w-[58px] shrink-0 object-contain"
        width={58}
        height={58}
      />
      <h1 className="mt-4 max-w-3xl text-left text-[22px] font-bold leading-snug tracking-tight text-[#1D2129] sm:text-[26px] sm:leading-tight dark:text-foreground">
        {t(titleKey)}
      </h1>
      <p className="mt-2 max-w-3xl text-left text-[15px] leading-relaxed text-[#86909C] dark:text-muted-foreground">
        {t(subtitleKey)}
      </p>
    </section>
  );
}
