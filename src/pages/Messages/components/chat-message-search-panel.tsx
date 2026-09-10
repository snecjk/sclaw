import { Cloud, RotateCcw, Search, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { stoSearchFieldShellClass } from '@/lib/surfaces';
import { cn } from '@/lib/utils';
import type { IMMessage } from '../types';

type ChatHistoryTab = 'history' | 'files' | 'images' | 'links';

const TAB_ORDER: ChatHistoryTab[] = ['history', 'files', 'images', 'links'];

function HistoryAvatar({ message, youLabel }: { message: IMMessage; youLabel: string }) {
  const label = message.role === 'self'
    ? youLabel.slice(0, 1)
    : (message.senderName?.slice(0, 1) ?? '?');

  return (
    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--sto-surface-muted)] text-[12px] font-medium text-[var(--sto-text-secondary)]">
      {label}
    </div>
  );
}

function messagePreview(message: IMMessage, t: (key: string) => string): string {
  if (message.contentType === 'artifact' && message.artifact) {
    return `[${t('im.chatHistoryFileTag')}] ${message.artifact.title}`;
  }
  if (message.contentType === 'thinking') {
    return `[${t('im.thinking')}] ${message.content}`;
  }
  if (message.contentType === 'tool') {
    return `[${t('im.chatHistoryToolTag')}] ${message.toolName ?? message.content}`;
  }
  if (message.contentType === 'image') {
    return `[${t('im.chatHistoryTabImages')}] ${message.content}`;
  }
  if (message.contentType === 'rich') {
    return message.content || '[图文]';
  }
  if (message.contentType === 'file') {
    return `[${t('im.chatHistoryFileTag')}] ${message.fileName ?? message.content}`;
  }
  if (message.content.trim()) return message.content;
  return `[${t('im.chatHistoryEmptyMessage')}]`;
}

function HistoryMessageRow({
  message,
  youLabel,
  t,
}: {
  message: IMMessage;
  youLabel: string;
  t: (key: string) => string;
}) {
  const sender = message.role === 'self'
    ? youLabel
    : (message.senderName ?? t('im.other'));

  return (
    <button
      type="button"
      className="flex w-full items-start gap-3 border-b border-border/60 px-5 py-4 text-left transition-colors hover:bg-[var(--sto-content-hover-background)]"
    >
      <HistoryAvatar message={message} youLabel={youLabel} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-3">
          <span className="truncate text-[14px] font-medium text-foreground">{sender}</span>
          <span className="shrink-0 text-[12px] text-muted-foreground">
            {message.time ? `${t('im.chatHistoryToday')} ${message.time}` : t('im.chatHistoryToday')}
          </span>
        </div>
        <p className="mt-1 line-clamp-2 text-[13px] leading-5 text-muted-foreground">
          {messagePreview(message, t)}
        </p>
      </div>
      <Cloud className="mt-1 h-4 w-4 shrink-0 text-muted-foreground/50" strokeWidth={1.75} />
    </button>
  );
}

function FilterField({
  label,
  placeholder,
  value,
  onClick,
}: {
  label: string;
  placeholder: string;
  value?: string;
  onClick?: () => void;
}) {
  return (
    <div className="space-y-2">
      {label ? <div className="text-[13px] font-medium text-foreground">{label}</div> : null}
      <button
        type="button"
        onClick={onClick}
        className={cn(
          'flex min-h-[34px] w-full items-center rounded-lg border border-border bg-[var(--sto-panel-bg)] px-3 text-left text-[13px]',
          value ? 'text-foreground' : 'text-muted-foreground',
        )}
      >
        {value || placeholder}
      </button>
    </div>
  );
}

export function ChatMessageSearchPanel({
  open,
  conversationName,
  messages,
  onOpenChange,
  onSearchMessages,
}: {
  open: boolean;
  conversationName: string;
  messages: IMMessage[];
  onOpenChange: (open: boolean) => void;
  onSearchMessages?: (keyword: string) => Promise<IMMessage[]>;
}) {
  const { t } = useTranslation('common');
  const [activeTab, setActiveTab] = useState<ChatHistoryTab>('history');
  const [keyword, setKeyword] = useState('');
  const [remoteMessages, setRemoteMessages] = useState<IMMessage[]>([]);
  const [searching, setSearching] = useState(false);
  const [senderFilter, setSenderFilter] = useState('');
  const [startTimeFilter, setStartTimeFilter] = useState('');
  const [endTimeFilter, setEndTimeFilter] = useState('');
  const [mentionFilter, setMentionFilter] = useState('');

  useEffect(() => {
    if (!onSearchMessages) {
      setRemoteMessages([]);
      return;
    }

    const trimmed = keyword.trim();
    if (!trimmed) {
      setRemoteMessages([]);
      setSearching(false);
      return;
    }

    setSearching(true);
    const timer = window.setTimeout(() => {
      void onSearchMessages(trimmed)
        .then((items) => setRemoteMessages(items))
        .catch(() => setRemoteMessages([]))
        .finally(() => setSearching(false));
    }, 250);

    return () => window.clearTimeout(timer);
  }, [keyword, onSearchMessages]);

  const sourceMessages = onSearchMessages && keyword.trim()
    ? remoteMessages
    : messages;

  const historyMessages = useMemo(
    () => sourceMessages.filter((message) => message.role !== 'system'),
    [sourceMessages],
  );

  const filteredMessages = useMemo(() => {
    return historyMessages.filter((message) => {
      if (senderFilter) {
        const sender = message.role === 'self'
          ? t('im.you')
          : (message.senderName ?? t('im.other'));
        if (sender !== senderFilter) return false;
      }
      if (mentionFilter && !message.content.includes('@')) return false;
      return true;
    });
  }, [historyMessages, mentionFilter, senderFilter, t]);

  const tabLabel = (tab: ChatHistoryTab) => {
    switch (tab) {
      case 'history':
        return t('im.chatHistoryTabHistory');
      case 'files':
        return t('im.chatFilesTabFiles');
      case 'images':
        return t('im.chatHistoryTabImages');
      case 'links':
        return t('im.chatFilesTabLinks');
      default:
        return tab;
    }
  };

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) {
      setActiveTab('history');
      setKeyword('');
      setRemoteMessages([]);
      setSenderFilter('');
      setStartTimeFilter('');
      setEndTimeFilter('');
      setMentionFilter('');
    }
    onOpenChange(nextOpen);
  };

  const resetFilters = () => {
    setSenderFilter('');
    setStartTimeFilter('');
    setEndTimeFilter('');
    setMentionFilter('');
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="flex h-[min(680px,85vh)] max-h-[85vh] w-[min(920px,calc(100vw-2rem))] max-w-[920px] flex-col gap-0 overflow-hidden p-0">
        <div className="relative border-b border-border px-5 py-4">
          <DialogTitle className="text-center text-[15px] font-semibold text-foreground">
            {conversationName}
          </DialogTitle>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="absolute right-3 top-3 h-8 w-8"
            onClick={() => handleOpenChange(false)}
            aria-label={t('actions.close')}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div className="border-b border-border px-5 py-3">
          <div className={stoSearchFieldShellClass}>
            <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            <Input
              value={keyword}
              onChange={(event) => setKeyword(event.target.value)}
              placeholder={t('im.searchChatContentPlaceholder')}
              className="h-8 border-0 bg-transparent px-0 text-[13px] shadow-none focus-visible:ring-0"
            />
          </div>
        </div>

        <div className="flex items-center gap-6 border-b border-border px-5">
          {TAB_ORDER.map((tab) => (
            <button
              key={tab}
              type="button"
              onClick={() => setActiveTab(tab)}
              className={cn(
                'relative py-3 text-[14px] font-medium transition-colors',
                activeTab === tab
                  ? 'text-foreground'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {tabLabel(tab)}
              {activeTab === tab ? (
                <span className="absolute inset-x-0 bottom-0 h-0.5 rounded-full bg-foreground" />
              ) : null}
            </button>
          ))}
        </div>

        <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_248px]">
          <div className="min-h-0 overflow-y-auto bg-[var(--sto-main-card-bg)]">
            {activeTab === 'history' ? (
              searching ? (
                <div className="px-5 py-16 text-center text-[13px] text-muted-foreground">
                  {t('im.loadingHistory')}
                </div>
              ) : filteredMessages.length > 0 ? (
                filteredMessages.map((message) => (
                  <HistoryMessageRow
                    key={message.id}
                    message={message}
                    youLabel={t('im.you')}
                    t={t}
                  />
                ))
              ) : (
                <div className="px-5 py-16 text-center text-[13px] text-muted-foreground">
                  {t('im.searchNoResults')}
                </div>
              )
            ) : (
              <div className="px-5 py-16 text-center text-[13px] text-muted-foreground">
                {t('im.chatHistoryTabEmpty')}
              </div>
            )}
          </div>

          <aside className="flex min-h-0 flex-col border-l border-border bg-[var(--sto-surface-elevated)] p-4">
            <div className="mb-4 flex items-center justify-between">
              <span className="text-[14px] font-semibold text-foreground">{t('im.chatHistoryFilter')}</span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-8 gap-1 px-2 text-[12px] text-muted-foreground"
                onClick={resetFilters}
              >
                <RotateCcw className="h-3.5 w-3.5" />
                {t('im.chatHistoryReset')}
              </Button>
            </div>

            <div className="space-y-4">
              <FilterField
                label={t('im.chatHistorySender')}
                placeholder={t('im.chatHistoryClickToSelect')}
                value={senderFilter}
                onClick={() => setSenderFilter(senderFilter ? '' : t('im.you'))}
              />
              <FilterField
                label={t('im.chatHistoryTime')}
                placeholder={t('im.chatHistoryStartTime')}
                value={startTimeFilter}
                onClick={() => setStartTimeFilter(startTimeFilter ? '' : '2026/03/07 00:00')}
              />
              <FilterField
                label=""
                placeholder={t('im.chatHistoryEndTime')}
                value={endTimeFilter}
                onClick={() => setEndTimeFilter(endTimeFilter ? '' : '2026/03/07 23:59')}
              />
              <FilterField
                label={t('im.chatHistoryMention')}
                placeholder={t('im.chatHistoryClickToSelect')}
                value={mentionFilter}
                onClick={() => setMentionFilter(mentionFilter ? '' : '@我')}
              />
            </div>
          </aside>
        </div>
      </DialogContent>
    </Dialog>
  );
}
