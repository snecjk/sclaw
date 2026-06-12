import { useState } from 'react';
import { Loader2, Send } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import type { ChatMessage } from '@/pages/Workflow/types';

interface AiAssistantPanelProps {
  messages: ChatMessage[];
  onReset: () => void;
  onCollapse: () => void;
}

export function AiAssistantPanel({ messages, onReset, onCollapse }: AiAssistantPanelProps) {
  const { t } = useTranslation('workflow');
  const [draft, setDraft] = useState('');

  return (
    <aside className="absolute bottom-4 left-4 top-4 z-20 flex w-[372px] max-w-[calc(100%-2rem)] flex-col overflow-hidden rounded-[18px] border border-border bg-card shadow-modal">
      <header className="flex items-center gap-2 border-b border-border px-4 py-3">
        <div className="flex h-6 w-6 items-center justify-center rounded-md bg-primary text-xs font-semibold text-primary-foreground" aria-hidden>
          C
        </div>
        <span className="text-sm font-semibold text-foreground">{t('assistant.title')}</span>
        <div className="ml-auto flex gap-1.5">
          <Button type="button" variant="outline" size="sm" className="h-8 text-xs" onClick={onReset}>
            {t('assistant.reset')}
          </Button>
          <Button type="button" variant="outline" size="sm" className="h-8 text-xs" onClick={onCollapse}>
            {t('assistant.collapse')}
          </Button>
        </div>
      </header>

      <div className="flex flex-1 flex-col gap-3.5 overflow-auto px-4 py-[18px]">
        {messages.map((msg) => (
          <MessageBubble key={msg.id} message={msg} />
        ))}
      </div>

      <div className="border-t border-border p-3">
        <div className="rounded-[13px] border-2 border-primary/30 bg-card p-3">
          <Textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={t('assistant.placeholder')}
            className="min-h-[38px] resize-none border-0 bg-transparent p-0 text-[13.5px] shadow-none focus-visible:ring-0"
          />
          <div className="mt-1.5 flex justify-end">
            <Button type="button" size="icon" className="h-8 w-8 rounded-full shadow-soft" aria-label={t('assistant.placeholder')}>
              <Send className="h-4 w-4" aria-hidden />
            </Button>
          </div>
        </div>
      </div>
    </aside>
  );
}

function MessageBubble({ message }: { message: ChatMessage }) {
  const { t } = useTranslation('workflow');

  if (message.role === 'user') {
    return (
      <div className="max-w-[90%] self-end rounded-2xl rounded-br-sm bg-muted px-3.5 py-2.5 text-[13.5px] leading-relaxed text-foreground">
        {message.content}
      </div>
    );
  }

  if (message.role === 'step') {
    return (
      <div className="max-w-[90%] self-start">
        <div
          className={cn(
            'flex items-center gap-2.5 rounded-[11px] border border-border px-[13px] py-[11px] text-[13px] text-foreground/80',
            message.stepDone && 'border-success/30',
          )}
        >
          <span
            className={cn(
              'flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-xs',
              message.stepDone ? 'bg-success/10 text-success' : 'bg-primary/10 text-primary',
            )}
          >
            {message.stepDone ? '✓' : <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />}
          </span>
          <span>{message.stepText}</span>
        </div>
      </div>
    );
  }

  if (message.role === 'plan' && message.planSteps) {
    return (
      <div className="max-w-[95%] self-start overflow-hidden rounded-[13px] border border-border">
        <div className="border-b border-border bg-muted/30 px-[13px] py-2.5 text-xs font-semibold text-foreground/80">
          {t('assistant.planTitle')}
        </div>
        {message.planSteps.map((step, i) => (
          <div key={step.title} className="flex gap-[11px] border-b border-border px-[13px] py-[11px] last:border-b-0">
            <span className="flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
              {i + 1}
            </span>
            <div>
              <b className="text-[13px] font-semibold text-foreground">{step.title}</b>
              <p className="mt-0.5 text-xs text-muted-foreground">{step.description}</p>
            </div>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="max-w-[90%] self-start text-[13.5px] leading-relaxed text-foreground">
      <div className="mb-1 text-[11.5px] font-semibold text-muted-foreground">{t('assistant.title')}</div>
      {message.content?.includes('正在理解') ? (
        <div className="inline-flex items-center gap-1.5 text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" aria-hidden />
          {message.content}
        </div>
      ) : (
        <p>{message.content}</p>
      )}
    </div>
  );
}
