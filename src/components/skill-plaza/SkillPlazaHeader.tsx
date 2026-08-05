import { useEffect, useRef, useState } from 'react';
import { Search, Wrench, Unplug, Plus, RefreshCw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { invokeIpc } from '@/lib/api-client';
import { cn } from '@/lib/utils';
import { useSkillPlazaStore } from '@/stores/skill-plaza';
import { useConnectorsStore } from '@/stores/connectors';
import folderIcon from '@/assets/icons/folder.svg';
import { SkillUploadModal } from './SkillUploadModal';

export type SkillPlazaSection = 'skills' | 'connectors';

interface SkillPlazaHeaderProps {
  section: SkillPlazaSection;
  onSectionChange: (section: SkillPlazaSection) => void;
  onUploadSuccess?: () => void;
}

/**
 * WorkBuddy 式顶栏 + 保留「技能广场 | 我的技能」页签。
 */
export function SkillPlazaHeader({
  section,
  onSectionChange,
  onUploadSuccess,
}: SkillPlazaHeaderProps) {
  const { t } = useTranslation('skills');
  const [uploadOpen, setUploadOpen] = useState(false);
  const isSkills = section === 'skills';

  const activeTab = useSkillPlazaStore((s) => s.activeTab);
  const searchQuery = useSkillPlazaStore((s) => s.searchQuery);
  const setActiveTab = useSkillPlazaStore((s) => s.setActiveTab);
  const setSearchQuery = useSkillPlazaStore((s) => s.setSearchQuery);

  const connectorsLoading = useConnectorsStore((s) => s.loading);
  const connectorsFetchList = useConnectorsStore((s) => s.fetchList);

  const [inputValue, setInputValue] = useState(searchQuery);
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    debounceTimer.current = setTimeout(() => {
      if (inputValue !== searchQuery) setSearchQuery(inputValue);
    }, 300);
    return () => {
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
    };
  }, [inputValue, searchQuery, setSearchQuery]);

  useEffect(() => {
    setInputValue(searchQuery);
  }, [searchQuery]);

  const handleOpenFolder = async () => {
    try {
      await invokeIpc('open-skill-folder');
    } catch {
      // ignore
    }
  };

  const sections: Array<{
    key: SkillPlazaSection;
    label: string;
    icon: typeof Wrench;
  }> = [
    {
      key: 'skills',
      label: t('plaza.section.skills', { defaultValue: '技能' }),
      icon: Wrench,
    },
    {
      key: 'connectors',
      label: t('plaza.section.connectors', { defaultValue: '连接器' }),
      icon: Unplug,
    },
  ];

  const skillTabs = [
    { key: 'all' as const, label: t('plaza.tab.all', { defaultValue: '技能广场' }) },
    { key: 'mine' as const, label: t('plaza.tab.mine', { defaultValue: '我的技能' }) },
  ];

  return (
    <div className="mb-2">
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <div
          className="inline-flex h-9 w-fit flex-shrink-0 items-center gap-0.5 rounded-[12px] bg-[#F2F3F5] p-0.5"
          role="tablist"
          aria-label={t('plaza.sectionAria', { defaultValue: '技能广场分区' })}
        >
          {sections.map((item) => {
            const Icon = item.icon;
            const active = section === item.key;
            return (
              <button
                key={item.key}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => onSectionChange(item.key)}
                className={cn(
                  "inline-flex h-full items-center gap-1.5 rounded-[10px] px-3.5 font-['PingFang_SC'] text-[14px] font-medium leading-none transition-colors duration-150",
                  active
                    ? 'bg-[#4E5969] text-white'
                    : 'bg-transparent text-[#4E5969] hover:bg-[#E5E6EB] hover:text-[#1D2129]',
                )}
              >
                <Icon className="h-3.5 w-3.5 flex-shrink-0" strokeWidth={1.75} aria-hidden />
                {item.label}
              </button>
            );
          })}
        </div>

        {isSkills ? (
          <div className="ml-auto flex min-w-0 flex-1 flex-wrap items-center justify-end gap-2">
            <label className="flex h-9 min-w-[200px] max-w-[320px] flex-1 items-center gap-2 rounded-[12px] border border-border bg-white px-3">
              <Search className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground" />
              <input
                type="search"
                placeholder={t('plaza.searchPlaceholderShort', { defaultValue: '搜索技能' })}
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                className="h-full min-w-0 flex-1 border-none bg-transparent p-0 text-[13px] font-medium leading-none text-foreground placeholder:text-muted-foreground focus:outline-none"
              />
            </label>

            <button
              type="button"
              onClick={handleOpenFolder}
              className="inline-flex h-9 items-center gap-1.5 rounded-[12px] border border-border bg-white px-3 font-['PingFang_SC'] text-[13px] font-medium leading-none text-[#1D2129] transition-colors duration-150 hover:bg-[#F2F3F5]"
              title={t('openFolder', { defaultValue: '打开技能文件夹' })}
            >
              <img src={folderIcon} alt="" aria-hidden className="h-3.5 w-3.5 flex-shrink-0 object-contain" />
              <span className="hidden sm:inline">{t('openFolderShort', { defaultValue: '文件夹' })}</span>
            </button>

            <button
              type="button"
              onClick={() => setUploadOpen(true)}
              className="inline-flex h-9 items-center gap-1.5 rounded-[12px] border border-border bg-white px-3 font-['PingFang_SC'] text-[13px] font-medium leading-none text-[#1D2129] transition-colors duration-150 hover:bg-[#F2F3F5]"
            >
              <Plus className="h-3.5 w-3.5" strokeWidth={1.75} aria-hidden />
              {t('plaza.upload.button', { defaultValue: '上传技能' })}
            </button>
          </div>
        ) : (
          <div className="ml-auto flex items-center gap-2">
            <button
              type="button"
              onClick={() => void connectorsFetchList(true)}
              disabled={connectorsLoading}
              className="inline-flex h-9 items-center gap-1.5 rounded-[12px] border border-border bg-white px-3 font-['PingFang_SC'] text-[13px] font-medium leading-none text-[#1D2129] transition-colors duration-150 hover:bg-[#F2F3F5]"
            >
              <RefreshCw className={cn('h-3.5 w-3.5', connectorsLoading && 'animate-spin')} />
              {t('plaza.connectors.refresh', { defaultValue: '刷新' })}
            </button>
          </div>
        )}
      </div>

      {isSkills ? (
        <div
          className="flex items-center gap-5"
          role="tablist"
          aria-label={t('plaza.skillTabsAria', { defaultValue: '技能列表切换' })}
        >
          {skillTabs.map((tab) => {
            const active = activeTab === tab.key;
            return (
              <button
                key={tab.key}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setActiveTab(tab.key)}
                className={cn(
                  "m-0 border-none bg-transparent pb-2 font-['PingFang_SC'] text-[16px] font-medium cursor-pointer transition-colors",
                  active
                    ? 'border-b-2 border-[#1D2129] font-bold text-foreground'
                    : 'border-b-2 border-transparent text-muted-foreground hover:text-foreground',
                )}
              >
                {tab.label}
              </button>
            );
          })}
        </div>
      ) : null}

      <SkillUploadModal
        open={uploadOpen}
        onClose={() => setUploadOpen(false)}
        onUploadSuccess={onUploadSuccess}
      />
    </div>
  );
}
