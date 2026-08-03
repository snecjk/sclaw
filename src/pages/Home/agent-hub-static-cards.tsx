/**
 * 首页 Agent Hub 静态降级卡片（无推荐位数据时展示）。
 */
import { useTranslation } from 'react-i18next';
import {
  homeHubCardShellClass,
  homeHubCardTitleClass,
  homeHubCardDescClass,
} from './home-hub-surface-styles';

export const AGENT_HUB_CARDS: ReadonlyArray<{
  titleKey: 'agentHub.cardTasksTitle' | 'agentHub.cardExecTitle' | 'agentHub.cardMultiTitle';
  descKey: 'agentHub.cardTasksDesc' | 'agentHub.cardExecDesc' | 'agentHub.cardMultiDesc';
}> = [
  {
    titleKey: 'agentHub.cardTasksTitle',
    descKey: 'agentHub.cardTasksDesc',
  },
  {
    titleKey: 'agentHub.cardExecTitle',
    descKey: 'agentHub.cardExecDesc',
  },
  {
    titleKey: 'agentHub.cardMultiTitle',
    descKey: 'agentHub.cardMultiDesc',
  },
];

/** 静态降级卡片组：无推荐位数据时展示 */
export function StaticFallbackCards() {
  const { t } = useTranslation('home');
  return AGENT_HUB_CARDS.map(({ titleKey, descKey }) => (
    <div key={titleKey} className={homeHubCardShellClass}>
      <h3 className={homeHubCardTitleClass}>{t(titleKey)}</h3>
      <p className={homeHubCardDescClass}>{t(descKey)}</p>
    </div>
  ));
}
