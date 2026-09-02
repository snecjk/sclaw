/**
 * 推荐位卡片：标题 + 描述。
 * 整卡可点；技能需安装/更新时整卡 loading，完成后执行「使用技能」。
 * Hover 展示完整标题与描述的深色 Tooltip。
 */
import { useCallback, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { useChatStore } from '@/stores/chat';
import { installPlazaSkill } from '@/lib/skill-plaza-api';
import type { RecommendItem } from '@/lib/recommend-api';
import {
  Tooltip,
  TooltipArrow,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import {
  homeHubCardDescClass,
  homeHubCardTitleClass,
  homeHubInteractiveCardShellClass,
} from './home-hub-surface-styles';

const recommendCardTooltipClass = cn(
  // overflow-visible：避免箭头被 base TooltipContent 的 overflow-hidden 裁切
  'w-[300px] max-w-[300px] overflow-visible rounded-[6px] border-none bg-black/90 px-2.5 py-1.5 text-white shadow-none',
);

export interface RecommendCardProps {
  item: RecommendItem;
  onClick: () => void;
  onSkillInstalled?: () => void;
  /**
   * 覆盖默认「新会话 + ?skill=」行为。
   * MyTask 等场景传入后：安装/更新完成或已安装点击时走该回调，不再跳转对话。
   */
  onSkillUse?: () => void;
  /** 首页推荐位：点击技能只带入输入框，不触发安装/更新。 */
  skillClickMode?: 'install-then-use' | 'use-only';
  skillStatus?: {
    installed: boolean;
    enabled?: boolean;
    updateAvailable: boolean;
    cloudVersion?: string;
  };
  /** 技能状态对比数据加载中 */
  skillStatusLoading?: boolean;
}

export function RecommendCard({
  item,
  onClick,
  onSkillInstalled,
  onSkillUse,
  skillClickMode = 'install-then-use',
  skillStatus,
  skillStatusLoading = false,
}: RecommendCardProps) {
  const { t } = useTranslation('home');
  const navigate = useNavigate();
  const [isInstalling, setIsInstalling] = useState(false);

  const isSkill = item.item_type === 'skill';
  const skillSlug = item.skill_slug || item.item_ref_id;
  const isSkillInstalled = skillStatus?.installed ?? item.skill_installed ?? false;
  const isSkillDisabled = isSkillInstalled && skillStatus?.enabled === false;
  const isSkillUpdateAvailable =
    skillStatus?.updateAvailable ?? item.skill_update_available ?? false;

  /** 已安装技能：默认新会话 + ?skill=；可由 onSkillUse 覆盖 */
  const handleSkillUse = useCallback(() => {
    if (isSkillDisabled) return;
    if (onSkillUse) {
      onSkillUse();
      return;
    }
    useChatStore.getState().newSession();
    navigate(`/?skill=${encodeURIComponent(skillSlug)}`);
  }, [isSkillDisabled, navigate, onSkillUse, skillSlug]);

  /** 安装/更新后刷新状态并进入使用 */
  const handleSkillInstallThenUse = useCallback(() => {
    if (isInstalling || skillStatusLoading) return;

    setIsInstalling(true);
    installPlazaSkill(skillSlug, {
      version: skillStatus?.cloudVersion ?? item.skill_version,
      force: isSkillUpdateAvailable,
      title: item.title,
      description: item.description ?? undefined,
    })
      .then(() => {
        onSkillInstalled?.();
        handleSkillUse();
      })
      .catch((err) => {
        toast.error(
          isSkillUpdateAvailable
            ? t('plaza.toast.updateError', { defaultValue: '更新失败' })
            : t('plaza.toast.installError', { defaultValue: '安装失败' }),
          { description: String(err) },
        );
      })
      .finally(() => {
        setIsInstalling(false);
      });
  }, [
    skillSlug,
    isInstalling,
    skillStatusLoading,
    isSkillUpdateAvailable,
    skillStatus?.cloudVersion,
    item.skill_version,
    item.title,
    item.description,
    t,
    onSkillInstalled,
    handleSkillUse,
  ]);

  const handleCardClick = useCallback(() => {
    if (isSkill) {
      if (skillClickMode === 'use-only' && onSkillUse) {
        onSkillUse();
        return;
      }
      if (isSkillDisabled || skillStatusLoading || isInstalling) return;
      if (!isSkillInstalled || isSkillUpdateAvailable) {
        handleSkillInstallThenUse();
        return;
      }
      handleSkillUse();
      return;
    }
    onClick();
  }, [
    isSkill,
    isSkillDisabled,
    skillStatusLoading,
    isInstalling,
    isSkillInstalled,
    isSkillUpdateAvailable,
    skillClickMode,
    handleSkillInstallThenUse,
    handleSkillUse,
    onSkillUse,
    onClick,
  ]);

  const displayTitle =
    item.item_type === 'workflow_instance'
      ? item.title.replace(/\s+\d{1,2}:\d{2}$/, '')
      : item.title;

  const description = (item.description ?? '').trim();
  const busy = isSkill && skillClickMode !== 'use-only' && (isInstalling || skillStatusLoading);
  const disabled = isSkill && skillClickMode !== 'use-only' && (isSkillDisabled || busy);

  return (
    <Tooltip delayDuration={200}>
      <TooltipTrigger asChild>
        <button
          type="button"
          className={cn(
            homeHubInteractiveCardShellClass,
            disabled && 'cursor-not-allowed opacity-60',
          )}
          onClick={handleCardClick}
          disabled={disabled}
          aria-busy={busy || undefined}
        >
          <h3 className={cn(homeHubCardTitleClass, 'line-clamp-1')}>{displayTitle}</h3>
          <p className={cn(homeHubCardDescClass, 'line-clamp-2')}>{description}</p>

          {busy ? (
            <div
              className="sto-card-busy-overlay absolute inset-0 flex items-center justify-center rounded-[18px]"
              aria-hidden
            >
              <span className="sto-card-busy-spinner h-5 w-5 animate-spin rounded-full border-2" />
            </div>
          ) : null}
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom" sideOffset={8} className={recommendCardTooltipClass}>
        <div className="flex flex-col gap-2.5 self-stretch text-left text-xs font-normal leading-4 text-white">
          <p>{displayTitle}</p>
          {description ? (
            <p className="whitespace-pre-wrap">{description}</p>
          ) : null}
        </div>
        <TooltipArrow className="fill-black/90" width={10} height={5} />
      </TooltipContent>
    </Tooltip>
  );
}
