import { ChatEngineModelCascade } from '@/pages/Chat/ChatEngineModelSelectors';
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
      toolbarToolsLayout="dropdown"
      toolbarSelectors={(
        <ChatEngineModelCascade
          className="min-w-0 max-w-full"
          allowSessionSwitch
        />
      )}
    />
  );
}
