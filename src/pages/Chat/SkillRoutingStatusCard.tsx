import { Brain, ListChecks, Sparkles } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { extractText } from './message-utils';
import type { RawMessage } from '@/stores/chat';
import { ChatProcessBlock, chatProcessBlockBodyClass } from '@/components/chat/chat-process-block';
import {
  getAgentPreparationMemories,
  getAgentPreparationStatus,
  type AgentPreparationStage,
} from '@/lib/agent-preparation-progress';

function AgentPreparationStatusRow({
  message,
  stage,
}: {
  message: RawMessage;
  stage: AgentPreparationStage;
}) {
  const { t } = useTranslation('chat');
  const text = extractText(message).trim();
  const isComplete = getAgentPreparationStatus(message) === 'completed';
  const memories = stage === 'memory' ? getAgentPreparationMemories(message) : [];
  const Icon = stage === 'skill' ? Sparkles : Brain;

  return (
    <div
      data-agent-preparation-status={stage}
      role="status"
      aria-live="polite"
    >
      <ChatProcessBlock
        title={t(stage === 'skill' ? 'streaming.skillMatchingLabel' : 'streaming.memoryRetrievalLabel')}
        icon={Icon}
        isRunning={!isComplete}
        collapsible={isComplete}
        isComplete={isComplete}
        autoExpand={!isComplete}
        isActive={!isComplete}
      >
        <div className="space-y-1.5">
          <p className={chatProcessBlockBodyClass}>
            {text || t(stage === 'skill' ? 'streaming.skillMatchingNow' : 'streaming.memoryRetrievalNow')}
          </p>
          {memories.length > 0 ? (
            <ul className="space-y-1.5" aria-label={t('streaming.memoryResultsLabel')}>
              {memories.map((item, index) => (
                <li
                  key={`${item.kind}-${index}`}
                  className="flex min-w-0 items-start gap-2 text-[13px] leading-5 text-muted-foreground"
                >
                  <span className="mt-0.5 shrink-0 rounded bg-muted px-1.5 py-px text-[10px] leading-4 text-muted-foreground">
                    {t(item.kind === 'preference'
                      ? 'streaming.preferenceMemoryLabel'
                      : 'streaming.executionMemoryLabel')}
                  </span>
                  <span className="min-w-0 whitespace-pre-wrap break-words">{item.memory}</span>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      </ChatProcessBlock>
    </div>
  );
}

export function AgentPreparationStatusList({
  skillMessage,
  memoryMessage,
}: {
  skillMessage?: RawMessage | null;
  memoryMessage?: RawMessage | null;
}) {
  const { t } = useTranslation('chat');
  if (!skillMessage && !memoryMessage) return null;
  return (
    <section
      className="w-full rounded-lg bg-muted/25 px-3 py-2.5"
      aria-label={t('streaming.preparationStageTitle')}
      data-agent-preparation-group
    >
      <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        <ListChecks className="h-3.5 w-3.5 shrink-0 opacity-70" aria-hidden />
        <span>{t('streaming.preparationStageTitle')}</span>
      </div>
      <div className="mt-2 space-y-3">
      {memoryMessage ? <AgentPreparationStatusRow message={memoryMessage} stage="memory" /> : null}
        {skillMessage ? <AgentPreparationStatusRow message={skillMessage} stage="skill" /> : null}
      </div>
    </section>
  );
}

/** @deprecated Use AgentPreparationStatusList for both preparation stages. */
export function SkillRoutingStatusCard({ message }: { message: RawMessage }) {
  return <AgentPreparationStatusList skillMessage={message} />;
}
