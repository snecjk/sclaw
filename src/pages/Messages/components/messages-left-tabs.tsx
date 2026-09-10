import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import {
  messagesSubheaderBorderClass,
  messagesSubheaderHeightClass,
} from '../lib/messages-subheader-metrics';
import type { MessagesLeftTab } from '../types';

const TAB_ITEMS: MessagesLeftTab[] = ['conversations', 'contacts'];

export function MessagesLeftTabs({
  activeTab,
  onChange,
}: {
  activeTab: MessagesLeftTab;
  onChange: (tab: MessagesLeftTab) => void;
}) {
  const { t } = useTranslation('common');

  const tabLabel = (tab: MessagesLeftTab) => {
    switch (tab) {
      case 'conversations':
        return t('im.conversations');
      case 'contacts':
        return t('im.contacts');
      default:
        return tab;
    }
  };

  return (
    <div
      className={cn(
        'flex shrink-0 items-center bg-[var(--sto-surface-elevated)] px-5',
        messagesSubheaderHeightClass,
        messagesSubheaderBorderClass,
      )}
    >
      <div className="flex h-full items-center gap-6">
        {TAB_ITEMS.map((tab) => {
          const active = activeTab === tab;
          return (
            <button
              key={tab}
              type="button"
              onClick={() => onChange(tab)}
              className={cn(
                'relative flex h-full items-center text-[14px] font-medium transition-colors',
                active
                  ? 'text-foreground'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              <span>{tabLabel(tab)}</span>
              {active ? (
                <span className="absolute inset-x-0 bottom-0 h-0.5 rounded-full bg-[var(--sto-brand-6)]" />
              ) : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}
