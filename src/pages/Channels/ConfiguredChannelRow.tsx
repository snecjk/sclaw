import type { ReactNode } from 'react';
import { Trash2, Pencil } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { stoSettingsSectionCardClass } from '@/lib/surfaces';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import type { AgentEngineType } from '../../../shared/agent-engine';
import { ChannelInlineSelect } from './ChannelInlineSelect';
import { ChannelIconBubble, ChannelLogo } from './ChannelLogo';
import {
  accountDisplayName,
  agentsForEngine,
  channelStatusDotClass,
  channelTitle,
  configuredChannelSubtitle,
  normalizeLogoType,
  parseStoredEngineType,
  pickSelectedAgentId,
  resolveNextAgentForEngine,
  toBindingEngine,
} from './helpers';
import {
  channelBindOutlineBtnClass,
  channelDeleteIconBtnClass,
  channelIconBtnClass,
} from './styles';
import type {
  AgentItem,
  BindingChangeHandler,
  ChannelAccountItem,
  ChannelGroupItem,
  DingTalkBindingState,
  InlineSelectOption,
} from './types';

function ChannelEditOrBindButton({
  isBound,
  onEdit,
  onBind,
  editLabel,
  bindLabel,
}: {
  isBound: boolean;
  onEdit: () => void;
  onBind: () => void;
  editLabel: string;
  bindLabel: string;
}) {
  if (isBound) {
    return (
      <Button
        size="icon"
        variant="ghost"
        className={channelIconBtnClass}
        onClick={onEdit}
        title={editLabel}
        aria-label={editLabel}
      >
        <Pencil className="h-4 w-4" />
      </Button>
    );
  }

  return (
    <Button
      size="sm"
      variant="outline"
      className={channelBindOutlineBtnClass}
      onClick={onBind}
    >
      {bindLabel}
    </Button>
  );
}

function EngineAgentSelects({
  engine,
  selectedAgentId,
  agentOptions,
  channelEngineOptions,
  engineAriaLabel,
  agentAriaLabel,
  noAgentsMessage,
  preferredAgentId,
  agents,
  onBindingChange,
}: {
  engine: AgentEngineType;
  selectedAgentId: string | undefined;
  agentOptions: AgentItem[];
  channelEngineOptions: InlineSelectOption[];
  engineAriaLabel: string;
  agentAriaLabel: string;
  noAgentsMessage: string;
  preferredAgentId: string | null | undefined;
  agents: AgentItem[];
  onBindingChange: BindingChangeHandler;
}) {
  return (
    <>
      <ChannelInlineSelect
        className="w-[120px]"
        value={engine}
        ariaLabel={engineAriaLabel}
        options={channelEngineOptions}
        onChange={(nextValue) => {
          const nextEngine = nextValue as AgentEngineType;
          const nextAgentId = resolveNextAgentForEngine(agents, nextEngine, preferredAgentId);
          if (!nextAgentId) {
            toast.error(noAgentsMessage);
            return;
          }
          void onBindingChange({
            engineType: nextEngine,
            agentId: nextAgentId,
          });
        }}
      />
      <ChannelInlineSelect
        className="w-[140px]"
        value={selectedAgentId || ''}
        ariaLabel={agentAriaLabel}
        options={agentOptions.map((agent) => ({
          value: agent.id,
          label: agent.name,
        }))}
        onChange={(nextAgentId) => {
          if (!nextAgentId) return;
          void onBindingChange({
            engineType: engine,
            agentId: nextAgentId,
          });
        }}
      />
    </>
  );
}

export function ConfiguredChannelRow({
  group,
  recommended,
  agents,
  dingTalkBinding,
  channelEngineOptions,
  onDingTalkBindingChange,
  onWeChatBindingChange,
  onBindAgent,
  onOpenDingTalkHub,
  onRequestDelete,
  onOpenAccountEdit,
}: {
  group: ChannelGroupItem;
  recommended?: boolean;
  agents: AgentItem[];
  dingTalkBinding: DingTalkBindingState;
  channelEngineOptions: InlineSelectOption[];
  onDingTalkBindingChange: BindingChangeHandler;
  onWeChatBindingChange: BindingChangeHandler;
  onBindAgent: (channelType: string, accountId: string, agentId: string) => void | Promise<void>;
  onOpenDingTalkHub: () => void;
  onRequestDelete: (channelType: string) => void;
  onOpenAccountEdit: (channelType: string, account?: ChannelAccountItem) => void;
}) {
  const { t } = useTranslation(['channels', 'common']);
  const isDingTalk = group.channelType === 'dingtalk';
  const isWeChat = group.channelType === 'openclaw-weixin' || group.channelType === 'wechat';
  const primaryAccount =
    group.accounts.find((account) => account.isDefault) || group.accounts[0];
  const weChatAccount = isWeChat ? primaryAccount : undefined;
  const pluginAccount = !isDingTalk && !isWeChat ? primaryAccount : undefined;

  const boundAgentId =
    (isDingTalk ? dingTalkBinding?.agentId : null) ||
    (isWeChat ? weChatAccount?.agentId : null) ||
    pluginAccount?.agentId ||
    group.accounts.find((account) => account.agentId)?.agentId;
  const boundAgent = boundAgentId
    ? agents.find((agent) => agent.id === boundAgentId)
    : undefined;

  let boundEngineType: string | null | undefined;
  if (isWeChat) {
    boundEngineType = parseStoredEngineType(weChatAccount?.engineType, 'pi');
  } else {
    boundEngineType =
      (isDingTalk ? dingTalkBinding?.engineType : null) ||
      boundAgent?.engineType ||
      null;
  }

  const channelEngine = toBindingEngine(boundEngineType);
  const channelAgentOptions = agentsForEngine(agents, channelEngine);
  const selectedAgentId = pickSelectedAgentId(channelAgentOptions, boundAgentId);
  const mainAccountLabel = t('account.mainAccount');
  const weChatDisplayName = accountDisplayName(weChatAccount, mainAccountLabel);
  const pluginDisplayName = accountDisplayName(pluginAccount, mainAccountLabel);
  const channelSubtitle = configuredChannelSubtitle({
    isDingTalk,
    isWeChat,
    dingTalkBinding,
    weChatAccount,
    pluginAccount,
    weChatDisplayName,
    pluginDisplayName,
    t,
  });
  const logoType = normalizeLogoType(group.channelType);

  let channelActive = Boolean(pluginAccount);
  if (isDingTalk) {
    channelActive = dingTalkBinding?.bindStatus === 'bound';
  } else if (isWeChat) {
    channelActive = Boolean(weChatAccount);
  }

  const dingTalkNoAgentsMessage = t('hub.dingtalk.noAgentsForEngine', {
    defaultValue: '该引擎下暂无 Agent，请先创建后再切换',
  });
  const weChatNoAgentsMessage = t('hub.wechat.noAgentsForEngine', {
    defaultValue: '该引擎下暂无 Agent，请先创建后再切换',
  });
  const editLabel = t('account.edit');
  const bindLabel = t('account.bind', { defaultValue: '绑定' });

  let bindingControls: ReactNode = (
    <ChannelInlineSelect
      className="w-[140px]"
      value={pluginAccount?.agentId || ''}
      ariaLabel={t('account.bindAgentLabel')}
      options={[
        { value: '', label: t('account.unassigned') },
        ...agents.map((agent) => ({
          value: agent.id,
          label: agent.name,
        })),
      ]}
      onChange={(nextAgentId) => {
        if (!pluginAccount) return;
        void onBindAgent(group.channelType, pluginAccount.accountId, nextAgentId);
      }}
    />
  );

  if (isDingTalk) {
    bindingControls = (
      <EngineAgentSelects
        engine={channelEngine}
        selectedAgentId={selectedAgentId}
        agentOptions={channelAgentOptions}
        channelEngineOptions={channelEngineOptions}
        engineAriaLabel={t('hub.dingtalk.engineLabel')}
        agentAriaLabel={t('hub.dingtalk.agentLabel')}
        noAgentsMessage={dingTalkNoAgentsMessage}
        preferredAgentId={boundAgentId}
        agents={agents}
        onBindingChange={onDingTalkBindingChange}
      />
    );
  } else if (isWeChat) {
    bindingControls = (
      <EngineAgentSelects
        engine={channelEngine}
        selectedAgentId={selectedAgentId}
        agentOptions={channelAgentOptions}
        channelEngineOptions={channelEngineOptions}
        engineAriaLabel={t('hub.wechat.engineLabel')}
        agentAriaLabel={t('account.bindAgentLabel')}
        noAgentsMessage={weChatNoAgentsMessage}
        preferredAgentId={boundAgentId}
        agents={agents}
        onBindingChange={onWeChatBindingChange}
      />
    );
  }

  let editOrBindButton: ReactNode;
  if (isDingTalk) {
    editOrBindButton = (
      <ChannelEditOrBindButton
        isBound={dingTalkBinding?.bindStatus === 'bound'}
        onEdit={onOpenDingTalkHub}
        onBind={onOpenDingTalkHub}
        editLabel={editLabel}
        bindLabel={bindLabel}
      />
    );
  } else if (isWeChat) {
    editOrBindButton = (
      <ChannelEditOrBindButton
        isBound={Boolean(weChatAccount)}
        onEdit={() => onOpenAccountEdit(group.channelType, weChatAccount)}
        onBind={() => onOpenAccountEdit(group.channelType, undefined)}
        editLabel={editLabel}
        bindLabel={bindLabel}
      />
    );
  } else {
    editOrBindButton = (
      <ChannelEditOrBindButton
        isBound={Boolean(pluginAccount)}
        onEdit={() => onOpenAccountEdit(group.channelType, pluginAccount)}
        onBind={() => onOpenAccountEdit(group.channelType, undefined)}
        editLabel={editLabel}
        bindLabel={bindLabel}
      />
    );
  }

  return (
    <section className={stoSettingsSectionCardClass}>
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <ChannelIconBubble type={logoType} active={channelActive}>
            <ChannelLogo type={logoType} active={channelActive} />
          </ChannelIconBubble>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h3 className="truncate text-[15px] font-semibold text-[#1D2129] dark:text-foreground">
                {channelTitle(group.channelType)}
              </h3>
              {recommended ? (
                <Badge
                  variant="secondary"
                  className="rounded px-1.5 py-0 text-[10px] font-medium border-0 bg-[#FFF7E8] text-[#FF7D00] shadow-none dark:bg-orange-500/15 dark:text-orange-300"
                >
                  {t('recommendedBadge', { defaultValue: '推荐' })}
                </Badge>
              ) : null}
              <div className={channelStatusDotClass(group.status)} />
            </div>
            <p className="mt-0.5 truncate text-[12px] text-[#86909C] dark:text-muted-foreground">
              {channelSubtitle}
            </p>
            {isWeChat && weChatAccount?.lastError ? (
              <p className="mt-1 text-[12px] text-destructive">{weChatAccount.lastError}</p>
            ) : null}
            {pluginAccount?.lastError ? (
              <p className="mt-1 text-[12px] text-destructive">{pluginAccount.lastError}</p>
            ) : null}
          </div>
        </div>

        <div className="flex shrink-0 flex-nowrap items-center gap-1.5">
          {bindingControls}
          <div className="flex items-center gap-0.5">
            {editOrBindButton}
            <Button
              size="icon"
              variant="ghost"
              className={channelDeleteIconBtnClass}
              onClick={() => onRequestDelete(group.channelType)}
              title={t('account.deleteChannel')}
              aria-label={t('account.deleteChannel')}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>
    </section>
  );
}
