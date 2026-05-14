import { useCallback, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Paperclip, ArrowUp } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { useChatStore } from '@/stores/chat';
import { useGatewayStore } from '@/stores/gateway';
import { cn } from '@/lib/utils';

/**
 * 首页底部助手区：大圆角输入框 + 上传 / 发送 + 免责说明（对齐设计稿）。
 */
export function HomeAssistant({ className }: { className?: string }) {
  const { t } = useTranslation('home');
  const navigate = useNavigate();
  const [text, setText] = useState('');

  const gatewayStatus = useGatewayStore((s) => s.status);
  const isGatewayRunning = gatewayStatus.state === 'running';
  const sendMessage = useChatStore((s) => s.sendMessage);
  const newSession = useChatStore((s) => s.newSession);
  const sending = useChatStore((s) => s.sending);
  const error = useChatStore((s) => s.error);

  const trimmed = text.trim();
  const canSend = trimmed.length > 0 && !sending && isGatewayRunning;

  const handleSend = useCallback(async () => {
    if (!trimmed) return;
    if (!isGatewayRunning) {
      toast.error(t('assistant.gatewayRequired'));
      return;
    }

    const { sessions } = useChatStore.getState();
    if (sessions.length === 0) {
      newSession();
    }

    try {
      await sendMessage(trimmed);
      setText('');
      navigate('/chat');
    } catch {
      toast.error(t('assistant.sendFailed'));
    }
  }, [isGatewayRunning, navigate, newSession, sendMessage, t, trimmed]);

  return (
    <div className={cn('flex flex-col', className)}>
      <section
        className={cn(
          'flex flex-col rounded-[20px] bg-white p-4 shadow-[0_4px_20px_rgba(29,33,41,0.07)]',
          'ring-1 ring-[rgba(255,183,140,0.55)] dark:bg-card dark:ring-[rgba(255,160,100,0.25)]',
        )}
        aria-label={t('assistant.placeholder')}
      >
        <label htmlFor="home-assistant-input" className="sr-only">
          {t('assistant.placeholder')}
        </label>
        <textarea
          id="home-assistant-input"
          rows={3}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={t('assistant.placeholder')}
          className="min-h-[4.5rem] w-full resize-none border-0 bg-transparent text-[15px] leading-relaxed text-foreground outline-none ring-0 placeholder:text-[#86909C] dark:placeholder:text-muted-foreground"
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              void handleSend();
            }
          }}
        />

        {error ? <p className="mt-1 text-sm text-destructive">{error}</p> : null}

        <div className="mt-3 flex items-center justify-between gap-3">
          <button
            type="button"
            className="flex items-center gap-1.5 rounded-lg py-1.5 text-left text-sm text-[#86909C] transition-colors hover:bg-black/[0.03] hover:text-foreground dark:text-muted-foreground dark:hover:bg-white/[0.05] dark:hover:text-foreground"
            title={t('assistant.uploadFile')}
          >
            <Paperclip className="h-[18px] w-[18px] shrink-0" strokeWidth={1.75} aria-hidden />
            <span>{t('assistant.uploadFile')}</span>
          </button>
          <button
            type="button"
            disabled={!canSend}
            aria-label={t('assistant.send')}
            title={t('assistant.send')}
            onClick={() => void handleSend()}
            className={cn(
              'flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition-colors',
              canSend
                ? 'bg-[#1D2129] text-white shadow-sm hover:bg-black dark:bg-neutral-950 dark:hover:bg-neutral-900'
                : 'cursor-not-allowed bg-[#E5E6EB] text-[#AEB4BD] dark:bg-muted dark:text-muted-foreground',
            )}
          >
            <ArrowUp className="h-[18px] w-[18px]" strokeWidth={2.25} aria-hidden />
          </button>
        </div>
      </section>
      <p className="mt-3 text-center text-xs leading-relaxed text-[#86909C] dark:text-muted-foreground">
        {t('assistant.footerDisclaimer')}
      </p>
    </div>
  );
}
