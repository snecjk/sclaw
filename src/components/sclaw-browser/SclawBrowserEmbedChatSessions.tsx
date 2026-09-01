/**
 * New chat + history picker for embed-browser AI assistant header.
 */
import { useRef, useState } from 'react';
import { Check, ChevronDown, History, Plus, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { useSclawBrowserOverlayStore } from '@/stores/sclaw-browser-overlay';
import type { EmbedChatIndexItem } from '@/lib/sclaw-browser-chat-index';

function formatSessionTime(ts: number): string {
  if (!ts) return '';
  try {
    return new Intl.DateTimeFormat(undefined, {
      month: 'numeric',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(ts));
  } catch {
    return '';
  }
}

export interface SclawBrowserEmbedChatSessionsProps {
  chatSessionKey?: string | null;
  chatSessions?: EmbedChatIndexItem[];
  createChatSession?: () => void;
  switchChatSession?: (sessionKey: string) => void;
  deleteChatSession?: (sessionKey: string) => void | Promise<void>;
  refreshChatSessions?: () => void;
}

export function SclawBrowserEmbedChatSessions(props: SclawBrowserEmbedChatSessionsProps = {}) {
  const { t } = useTranslation('common');
  const overlayChatSessionKey = useSclawBrowserOverlayStore((s) => s.chatSessionKey);
  const overlayChatSessions = useSclawBrowserOverlayStore((s) => s.chatSessions);
  const overlayCreate = useSclawBrowserOverlayStore((s) => s.createChatSession);
  const overlaySwitch = useSclawBrowserOverlayStore((s) => s.switchChatSession);
  const overlayDelete = useSclawBrowserOverlayStore((s) => s.deleteChatSession);
  const overlayRefresh = useSclawBrowserOverlayStore((s) => s.refreshChatSessions);

  const chatSessionKey = props.chatSessionKey !== undefined ? props.chatSessionKey : overlayChatSessionKey;
  const chatSessions = props.chatSessions ?? overlayChatSessions;
  const createChatSession = props.createChatSession ?? overlayCreate;
  const switchChatSession = props.switchChatSession ?? overlaySwitch;
  const deleteChatSession = props.deleteChatSession ?? overlayDelete;
  const refreshChatSessions = props.refreshChatSessions ?? overlayRefresh;
  const [open, setOpen] = useState(false);
  const keepOpenOnDeleteRef = useRef(false);
  const keepOpenTimerRef = useRef<number | null>(null);

  function markKeepOpenOnDelete() {
    keepOpenOnDeleteRef.current = true;
    if (keepOpenTimerRef.current != null) window.clearTimeout(keepOpenTimerRef.current);
    keepOpenTimerRef.current = window.setTimeout(() => {
      keepOpenOnDeleteRef.current = false;
      keepOpenTimerRef.current = null;
    }, 400);
  }

  return (
    <div className="sclaw-browser-embed-chat__sessions">
      <button
        type="button"
        className="sclaw-browser-embed-chat__session-btn"
        onClick={() => createChatSession()}
        title={t('moreApps.embedChat.newSession', { defaultValue: '新建对话' })}
        aria-label={t('moreApps.embedChat.newSession', { defaultValue: '新建对话' })}
      >
        <Plus className="h-3.5 w-3.5" aria-hidden />
      </button>

      <DropdownMenu
        open={open}
        onOpenChange={(next) => {
          if (!next && keepOpenOnDeleteRef.current) return;
          setOpen(next);
          if (next) refreshChatSessions();
        }}
      >
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="sclaw-browser-embed-chat__session-picker"
            title={t('moreApps.embedChat.history', { defaultValue: '历史对话' })}
            aria-label={t('moreApps.embedChat.history', { defaultValue: '历史对话' })}
          >
            <History className="h-3.5 w-3.5" aria-hidden />
            <ChevronDown className="h-3 w-3 opacity-60" aria-hidden />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          sideOffset={6}
          className="z-[100001] w-56"
        >
          <DropdownMenuLabel>
            {t('moreApps.embedChat.history', { defaultValue: '历史对话' })}
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          {chatSessions.length === 0 ? (
            <div className="px-2 py-3 text-xs text-muted-foreground">
              {t('moreApps.embedChat.emptyHistory', { defaultValue: '暂无历史对话' })}
            </div>
          ) : (
            chatSessions.map((item) => {
              const active = item.key === chatSessionKey;
              return (
                <DropdownMenuItem
                  key={item.key}
                  aria-selected={active}
                  className="group flex items-start gap-2 pr-1"
                  onSelect={(event) => {
                    event.preventDefault();
                    if (keepOpenOnDeleteRef.current) return;
                    switchChatSession(item.key);
                    setOpen(false);
                  }}
                >
                  <Check
                    className={cn('mt-0.5 h-3.5 w-3.5 shrink-0', active ? 'opacity-100' : 'opacity-0')}
                    aria-hidden
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm">{item.title}</span>
                    <span className="block text-[11px] text-muted-foreground">
                      {formatSessionTime(item.updatedAt)}
                    </span>
                  </span>
                  <button
                    type="button"
                    data-embed-session-delete
                    className="mt-0.5 shrink-0 rounded p-1 text-muted-foreground opacity-70 hover:bg-destructive/10 hover:text-destructive group-hover:opacity-100"
                    title={t('moreApps.embedChat.deleteSession', { defaultValue: '删除对话' })}
                    aria-label={t('moreApps.embedChat.deleteSession', { defaultValue: '删除对话' })}
                    onPointerDown={(event) => {
                      markKeepOpenOnDelete();
                      event.preventDefault();
                      event.stopPropagation();
                    }}
                    onClick={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      markKeepOpenOnDelete();
                      void deleteChatSession(item.key);
                    }}
                  >
                    <Trash2 className="h-3.5 w-3.5" aria-hidden />
                  </button>
                </DropdownMenuItem>
              );
            })
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
