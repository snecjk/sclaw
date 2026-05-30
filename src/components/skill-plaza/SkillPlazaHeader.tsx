import { useSkillPlazaStore } from '@/stores/skill-plaza';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';

export function SkillPlazaHeader() {
  const { t } = useTranslation('skills');
  const { activeTab, setActiveTab } = useSkillPlazaStore();

  return (
    <div className="mb-6">
      <div className="mb-4">
        <h1 className="text-2xl font-semibold text-foreground">
          {t('plaza.title', { defaultValue: '技能广场' })}
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          {t('plaza.subtitle', { defaultValue: '管理你可以安装的技能，快速查看与使用' })}
        </p>
      </div>

      <div className="inline-flex rounded-lg border border-border bg-muted/40 p-1">
        {(
          [
            { key: 'all' as const, label: t('plaza.tab.all', { defaultValue: '技能广场' }) },
            { key: 'mine' as const, label: t('plaza.tab.mine', { defaultValue: '我的技能' }) },
          ] as const
        ).map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            aria-selected={activeTab === tab.key}
            className={cn(
              'px-4 py-1.5 text-sm font-medium rounded-md transition-all',
              activeTab === tab.key
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>
    </div>
  );
}
