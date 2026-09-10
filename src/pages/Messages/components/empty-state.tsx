import { MessageSquare, UserPlus, Users } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';

export function MessagesEmptyState({
  onStartChat,
  onCreateGroup,
  onFindDigitalEmployee,
}: {
  onStartChat: () => void;
  onCreateGroup: () => void;
  onFindDigitalEmployee: () => void;
}) {
  const { t } = useTranslation('common');

  return (
    <div className="flex h-full w-full min-h-0 flex-col items-center justify-center px-8 py-10 text-center">
      <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-[var(--sto-surface-muted)] text-[var(--sto-text-secondary)]">
        <MessageSquare className="h-8 w-8" strokeWidth={1.5} />
      </div>
      <h2 className="max-w-md text-[18px] font-medium leading-snug text-[var(--sto-text-primary)]">
        {t('im.emptyStateTitle')}
      </h2>
      <p className="mt-2 max-w-md text-[13px] leading-relaxed text-[var(--sto-text-tertiary)]">
        {t('im.emptyStateDescription')}
      </p>
      <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
        <Button type="button" variant="outline" onClick={onStartChat}>
          <UserPlus className="mr-2 h-4 w-4" />
          {t('im.startChat')}
        </Button>
        <Button type="button" variant="outline" onClick={onCreateGroup}>
          <Users className="mr-2 h-4 w-4" />
          {t('im.createGroup')}
        </Button>
        <Button type="button" onClick={onFindDigitalEmployee}>
          {t('im.findDigitalEmployee')}
        </Button>
      </div>
    </div>
  );
}
