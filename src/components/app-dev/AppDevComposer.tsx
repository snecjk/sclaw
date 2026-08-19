import { ChatEngineSelector, ChatModelSelector } from '@/pages/Chat/ChatEngineModelSelectors';
import { HomeComposer } from '@/pages/Home/HomeComposer';

export interface AppDevComposerProps {
  seedText?: string;
  onBeforeSend?: (text: string) => boolean;
}

export function AppDevComposer({
  seedText,
  onBeforeSend,
}: AppDevComposerProps) {
  return (
    <HomeComposer
      seedText={seedText}
      onBeforeSend={onBeforeSend}
      showDisclaimer={false}
      footerAlign="center"
      hideDingTalkMention
      showInterfaceCatalog
      toolbarSelectors={(
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <ChatEngineSelector variant="inline" className="min-w-0 flex-1" allowSessionSwitch />
          <ChatModelSelector variant="inline" className="min-w-max shrink-0" />
        </div>
      )}
    />
  );
}
