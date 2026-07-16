/**
 * 无 CRM 周报策略权限时的首页：Hero + 能力卡片 + 底部输入（色板对齐 docs/sto-design.md）。
 */
import { useMemo } from 'react';
import { FileText, Rocket, Waypoints } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useAgentsStore } from '@/stores/agents';
import { useChatStore } from '@/stores/chat';
import { useGatewayStore } from '@/stores/gateway';
import { cn } from '@/lib/utils';
import { useSplitGridPassthroughClass } from '@/hooks/use-split-grid-passthrough-class';
import { HomeHero } from './HomeHero';
import { HomeMainConversation } from './HomeMainConversation';
import { useHomeChatEntrySend } from './use-home-chat-entry-send';
import { useHomeConversationActive } from './use-home-conversation-active';
import { DEFAULT_SESSION_KEY } from '@/stores/chat/types';
import { HomeComposer } from './HomeComposer';
import {
  homeHubCardDescClass,
  homeHubCardGridClass,
  homeHubCardShellClass,
  homeHubCardTagClass,
  homeHubCardTitleClass,
  homeHubFooterShellClass,
  homeHubMainScrollClass,
  homeHubMainScrollHostClass,
  homeHubTextSecondary,
} from './home-hub-surface-styles';

/** sto-design Grey-4 边框（状态胶囊 / 隐藏 footer 保留） */
const BORDER_DEFAULT = 'border-[#E5E6EB] dark:border-border';

/**
 * 2026-06 首页改版：按 MasterGo 总部首页设计稿隐藏中间胶囊，保留代码以便恢复。
 */
const SHOW_STATUS_CHIPS = false;

/** 2026-06 首页改版：按设计稿隐藏底部网关状态行 */
const SHOW_GATEWAY_LINE = false;

/** 2026-06 首页改版：按设计稿隐藏底部用量提示 */
const SHOW_USAGE_HINT = false;

/** MasterGo paint_2:27513 — 任务处理卡图标底 */
const CARD_ICON_WRAP_TASKS =
  'bg-[rgba(189,243,207,0.5)] text-[#1D2129] dark:text-foreground';
/** MasterGo paint_2:21494 — 持续执行卡图标底 */
const CARD_ICON_WRAP_EXEC =
  'bg-[rgba(214,200,199,0.25)] text-[#1D2129] dark:text-foreground';
/** MasterGo paint_2:27541 — 多智能体卡图标底 */
const CARD_ICON_WRAP_MULTI =
  'bg-[rgba(255,232,193,0.25)] text-[#1D2129] dark:text-foreground';

/** sto-design Green-6 就绪点 */
const DOT_SUCCESS = 'bg-[#00B54B]';
/** sto-design Brand-6 申通橙（状态胶囊隐藏后仍保留常量） */
const DOT_BRAND = 'bg-[#FF6F00] dark:bg-[#FF8D2A]';

const AGENT_HUB_CARDS: ReadonlyArray<{
  icon: LucideIcon;
  iconWrapClass: string;
  titleKey: 'agentHub.cardTasksTitle' | 'agentHub.cardExecTitle' | 'agentHub.cardMultiTitle';
  descKey: 'agentHub.cardTasksDesc' | 'agentHub.cardExecDesc' | 'agentHub.cardMultiDesc';
}> = [
  {
    icon: Rocket,
    iconWrapClass: CARD_ICON_WRAP_TASKS,
    titleKey: 'agentHub.cardTasksTitle',
    descKey: 'agentHub.cardTasksDesc',
  },
  {
    icon: FileText,
    iconWrapClass: CARD_ICON_WRAP_EXEC,
    titleKey: 'agentHub.cardExecTitle',
    descKey: 'agentHub.cardExecDesc',
  },
  {
    icon: Waypoints,
    iconWrapClass: CARD_ICON_WRAP_MULTI,
    titleKey: 'agentHub.cardMultiTitle',
    descKey: 'agentHub.cardMultiDesc',
  },
];

export function HomeAgentHubSurface({ seedText, seedSkillSlug }: { seedText?: string; seedSkillSlug?: string }) {
  const { t } = useTranslation('home');
  const showConversation = useHomeConversationActive();
  const { isSplitGridPassthrough, splitGridPassthroughClass } =
    useSplitGridPassthroughClass(showConversation);

  const currentAgentId = useChatStore((s) => s.currentAgentId);
  const currentSessionKey = useChatStore((s) => s.currentSessionKey);
  const sessions = useChatStore((s) => s.sessions);
  const agents = useAgentsStore((s) => s.agents);
  const gatewayStatus = useGatewayStore((s) => s.status);
  const isGatewayRunning = gatewayStatus.state === 'running';
  const currentAgent = useMemo(
    () => agents.find((agent) => agent.id === currentAgentId),
    [agents, currentAgentId],
  );
  const currentSession = useMemo(
    () => sessions.find((session) => session.key === currentSessionKey),
    [sessions, currentSessionKey],
  );
  const currentEngineType = currentSessionKey === DEFAULT_SESSION_KEY
    ? currentAgent?.engineType
    : currentSession?.engineType ?? currentAgent?.engineType;

  const { handleHubSend, handleHubQueue } = useHomeChatEntrySend();

  return (
    <div
      className={cn(
        isSplitGridPassthrough ? splitGridPassthroughClass : 'flex min-h-0 flex-1 flex-col',
      )}
    >
      <div
        className={cn(
          isSplitGridPassthrough
            ? splitGridPassthroughClass
            : 'flex min-h-0 flex-1 flex-col overflow-hidden px-4 sm:px-6',
        )}
      >
        {showConversation ? (
          <HomeMainConversation
            className="min-h-0 flex-1"
            seedText={seedText}
            seedSkillSlug={seedSkillSlug}
            onSend={handleHubSend}
          />
        ) : (
          <div className={homeHubMainScrollHostClass}>
            <div className={homeHubMainScrollClass}>
              <HomeHero />

              <div className={homeHubCardGridClass}>
              {AGENT_HUB_CARDS.map(({ icon: Icon, iconWrapClass, titleKey, descKey }) => (
                <div key={titleKey} className={homeHubCardShellClass}>
                  <div className="flex items-start gap-3">
                    <div
                      className={cn(
                        'flex h-9 w-9 shrink-0 items-center justify-center rounded-xl',
                        iconWrapClass,
                      )}
                    >
                      <Icon className="h-5 w-5" strokeWidth={1.75} aria-hidden />
                    </div>
                    <div className="min-w-0 flex-1 text-left">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className={homeHubCardTitleClass}>{t(titleKey)}</h3>
                        <span className={homeHubCardTagClass}>{t('agentHub.functionTag')}</span>
                      </div>
                      <p className={cn('mt-1.5', homeHubCardDescClass)}>{t(descKey)}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {SHOW_STATUS_CHIPS ? (
              <div className="flex flex-wrap justify-center gap-3">
                {(
                  [
                    { dot: DOT_SUCCESS, label: t('agentHub.statusLabel'), value: t('agentHub.statusReady') },
                    { dot: DOT_BRAND, label: t('agentHub.collabLabel'), value: t('agentHub.collabValue') },
                    { dot: DOT_BRAND, label: t('agentHub.toolsLabel'), value: t('agentHub.toolsValue') },
                  ] as const
                ).map((row) => (
                  <div
                    key={row.label}
                    className={cn(
                      'flex items-center gap-2 rounded-xl border bg-[#F5F6F7] px-4 py-2.5 text-xs dark:bg-muted/60',
                      BORDER_DEFAULT,
                    )}
                  >
                    <span className={cn('font-medium text-[#4E5969] dark:text-muted-foreground')}>
                      {row.label}
                    </span>
                    <span className="flex items-center gap-1.5 font-semibold text-[#1D2129] dark:text-foreground">
                      <span className={cn('h-2 w-2 shrink-0 rounded-full', row.dot)} aria-hidden />
                      {row.value}
                    </span>
                  </div>
                ))}
              </div>
            ) : null}
            </div>
          </div>
        )}
      </div>

      {!showConversation ? (
        <div className={homeHubFooterShellClass}>
          <HomeComposer
            seedText={seedText}
            seedSkillSlug={seedSkillSlug}
            onSend={handleHubSend}
            onQueue={handleHubQueue}
            engineType={currentEngineType}
          />
          {SHOW_GATEWAY_LINE || SHOW_USAGE_HINT ? (
          <div
            className={cn(
              'mx-auto mt-4 grid w-full max-w-[var(--sto-hero-input-max-w)] grid-cols-[1fr_auto_1fr] items-center gap-3 border-t pt-4 text-xs',
              BORDER_DEFAULT,
              homeHubTextSecondary,
            )}
          >
            {SHOW_GATEWAY_LINE ? (
              currentEngineType === 'openclaw' ? (
                <span className="flex items-center gap-2">
                  <span
                    className={cn(
                      'h-2 w-2 shrink-0 rounded-full',
                      isGatewayRunning ? DOT_SUCCESS : 'bg-[#FAAD14]',
                    )}
                    aria-hidden
                  />
                  {gatewayStatus.state === 'running'
                    ? t('agentHub.gatewayLineConnected', {
                        port: gatewayStatus.port ?? 18789,
                        pid: gatewayStatus.pid ?? '—',
                      })
                    : gatewayStatus.state === 'starting' || gatewayStatus.state === 'reconnecting'
                      ? t('agentHub.gatewayLineConnecting', { port: gatewayStatus.port ?? 18789 })
                      : t('agentHub.gatewayLineDisconnected', { port: gatewayStatus.port ?? 18789 })}
                </span>
              ) : currentEngineType === 'claude' ? (
                <span className="flex items-center gap-2">
                  <span className={cn('h-2 w-2 shrink-0 rounded-full', DOT_SUCCESS)} aria-hidden />
                  {t('agentHub.claudeLineConnected')}
                </span>
              ) : (
                <span />
              )
            ) : (
              <span />
            )}
            <span />
            {SHOW_USAGE_HINT ? (
              <span className="justify-self-end tabular-nums text-right text-[#4E5969] dark:text-muted-foreground">
                {t('agentHub.usageHint')}
              </span>
            ) : (
              <span />
            )}
          </div>
        ) : null}
        </div>
      ) : null}
    </div>
  );
}
