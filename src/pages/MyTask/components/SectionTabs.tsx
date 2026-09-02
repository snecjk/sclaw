/**
 * SectionTabs：我的任务一级 Tab（定时任务 / 工作流）
 * 样式与技能·连接器分区 Tab 共用 surfaces token；切换由父级同步到 URL ?tab=
 */

import { Clock, Workflow } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { StoSegmentTabs } from '@/components/ui/sto-neutral-controls';
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
    <StoSegmentTabs
      value={activeSection}
      items={SECTION_TABS.map((tab) => ({
        value: tab.value,
        label: t(tab.i18nKey),
        icon: tab.icon,
      }))}
      onValueChange={onSectionChange}
      ariaLabel={t('myTask.sectionTabs.aria')}
      className={className}
    />
  );
}
