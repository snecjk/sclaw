import { useCallback, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Paperclip, LayoutGrid, BarChart3, Workflow, ArrowUp } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { useChatStore } from '@/stores/chat';
import { useGatewayStore } from '@/stores/gateway';
import { cn } from '@/lib/utils';

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
    <section className={cn('rounded-[16px] bg-white p-4 shadow-[0_4px_24px_rgba(15,23,42,0.06)] ring-1 ring-[var(--sto-sidebar-border)] dark:bg-card dark:ring-border', className)} aria-label={t('assistant.placeholder')}>
      <label htmlFor="home-assistant-input" className="sr-only">
        {t('assistant.placeholder')}
      </label>
      <textarea
        id="home-assistant-input"
        rows={2}
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={t('assistant.placeholder')}
        className="w-full resize-none border-0 bg-transparent text-[15px] leading-relaxed text-foreground outline-none ring-0 placeholder:text-muted-foreground"
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            void handleSend();
          }
        }}
      />
      <div className="mt-3 flex flex-wrap items-center justify-between gap-3 border-t border-[var(--sto-sidebar-border)] pt-3 dark:border-border">
        <div className="flex flex-wrap gap-2">
          <button type="button" className="sto-tool-btn" title={t('assistant.uploadFile')}>
            <Paperclip className="h-[18px] w-[18px] shrink-0" strokeWidth={1.75} aria-hidden />
            <span className="hidden sm:inline">{t('assistant.uploadFile')}</span>
          </button>
          <button type="button" className="sto-tool-btn" title={t('assistant.skillCall')}>
            <LayoutGrid className="h-[18px] w-[18px] shrink-0" strokeWidth={1.75} aria-hidden />
            <span className="hidden sm:inline">{t('assistant.skillCall')}</span>
          </button>
          <button type="button" className="sto-tool-btn" title={t('assistant.dataAnalysis')}>
            <BarChart3 className="h-[18px] w-[18px] shrink-0" strokeWidth={1.75} aria-hidden />
            <span className="hidden sm:inline">{t('assistant.dataAnalysis')}</span>
          </button>
          <button type="button" className="sto-tool-btn" title={t('assistant.workflow')}>
            <Workflow className="h-[18px] w-[18px] shrink-0" strokeWidth={1.75} aria-hidden />
            <span className="hidden sm:inline">{t('assistant.workflow')}</span>
          </button>
        </div>
        <button
          type="button"
          disabled={!canSend}
          aria-label={t('assistant.send')}
          title={t('assistant.send')}
          onClick={() => void handleSend()}
          className={cn(
            'flex h-10 w-10 shrink-0 items-center justify-center rounded-full transition-colors',
            canSend
              ? 'bg-[var(--sto-accent)] text-white shadow-sm hover:opacity-95'
              : 'cursor-not-allowed bg-muted text-muted-foreground',
          )}
        >
          <ArrowUp className="h-[18px] w-[18px]" strokeWidth={2.25} aria-hidden />
        </button>
      </div>
      {error ? <p className="mt-2 text-sm text-destructive">{error}</p> : null}
    </section>
  );
}
