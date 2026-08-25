/**
 * SectionTabs：我的任务一级 Tab（定时任务 / 工作流）
 * 样式与技能·连接器分区 Tab 共用 surfaces token；切换由父级同步到 URL ?tab=
 */

import { Clock, Workflow } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { myTaskSectionTabClass, myTaskSectionTabsTrackClass } from '@/lib/surfaces';
import type { MyTaskSection } from '../types';

interface SectionTabsProps {
  activeSection: MyTaskSection;
  onSectionChange: (section: MyTaskSection) => void;
  className?: string;
}

const SECTION_TABS: {
  value: MyTaskSection;
  i18nKey: string;
  icon: typeof Clock;
}[] = [
  { value: 'tasks', i18nKey: 'myTask.sectionTabs.tasks', icon: Clock },
  { value: 'workflow', i18nKey: 'myTask.sectionTabs.workflow', icon: Workflow },
];

export function SectionTabs({ activeSection, onSectionChange, className }: SectionTabsProps) {
  const { t } = useTranslation('tasks');

  return (
    <div
      className={className}
      role="tablist"
      aria-label={t('myTask.sectionTabs.aria')}
    >
      <div className={myTaskSectionTabsTrackClass}>
        {SECTION_TABS.map((tab) => {
          const isActive = activeSection === tab.value;
          const Icon = tab.icon;
          return (
            <button
              key={tab.value}
              type="button"
              role="tab"
              aria-selected={isActive}
              onClick={() => onSectionChange(tab.value)}
              className={myTaskSectionTabClass(isActive)}
            >
              <Icon className="h-3.5 w-3.5 flex-shrink-0" strokeWidth={1.75} aria-hidden />
              {t(tab.i18nKey)}
            </button>
          );
        })}
      </div>
    </div>
  );
}
