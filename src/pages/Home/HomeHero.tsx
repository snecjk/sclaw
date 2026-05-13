import { useTranslation } from 'react-i18next';
import logoSvg from '@/assets/logo.svg';
import { cn } from '@/lib/utils';

export function HomeHero({ className }: { className?: string }) {
  const { t } = useTranslation('home');
  return (
    <section className={cn('text-center', className)}>
      <div className="mx-auto flex h-[72px] w-[72px] items-center justify-center rounded-2xl bg-white shadow-[0_8px_32px_rgba(15,23,42,0.06)] ring-1 ring-[var(--sto-sidebar-border)] dark:bg-card dark:ring-border">
        <img src={logoSvg} alt="" className="h-11 w-11 object-contain" width={44} height={44} />
      </div>
      <h1 className="mt-5 text-[clamp(1.25rem,3vw,1.625rem)] font-bold leading-snug tracking-tight text-foreground">
        {t('hero.title')}
      </h1>
      <p className="mx-auto mt-2 max-w-2xl text-[15px] leading-relaxed text-muted-foreground">
        {t('hero.subtitle')}
      </p>
    </section>
  );
}
