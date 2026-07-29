/**
 * 推荐位卡片：标题 + 标签 + 描述 + 头像底栏。
 * 技能类型支持安装/更新/使用；工作流类型走 onClick 回调。
 */
import { useMemo, useCallback, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { useChatStore } from '@/stores/chat';
import { installPlazaSkill } from '@/lib/skill-plaza-api';
import type { RecommendItem } from '@/lib/recommend-api';
import { pickThreeAvatars, AvatarStack } from './agent-hub-static-cards';
import {
  homeHubCardDescClass,
  homeHubCardTagClass,
  homeHubCardTitleClass,
  homeHubInteractiveCardShellClass,
  homeHubCardBodyRegionClass,
  homeHubCardFooterRegionClass,
} from './home-hub-surface-styles';

export interface RecommendCardProps {
  item: RecommendItem;
  onClick: () => void;
  onSkillInstalled?: () => void;
  skillStatus?: { installed: boolean; enabled?: boolean; updateAvailable: boolean; cloudVersion?: string };
  /** 技能状态对比数据加载中，按钮显示 loading 避免状态突变 */
  skillStatusLoading?: boolean;
}

export function RecommendCard({
  item,
  onClick,
  onSkillInstalled,
  skillStatus,
  skillStatusLoading = false,
}: RecommendCardProps) {
  const { t } = useTranslation('home');
  const navigate = useNavigate();
  const avatarUrls = useMemo(() => pickThreeAvatars(item.item_ref_id), [item.item_ref_id]);
  const [isInstalling, setIsInstalling] = useState(false);

  // 技能状态判断
  const isSkill = item.item_type === 'skill';
  const skillSlug = item.skill_slug || item.item_ref_id;
  const isSkillInstalled = skillStatus?.installed ?? item.skill_installed ?? false;
  const isSkillDisabled = isSkillInstalled && skillStatus?.enabled === false;
  const isSkillUpdateAvailable = skillStatus?.updateAvailable ?? item.skill_update_available ?? false;

  const footerHintText = item.item_type === 'workflow_template'
    ? t('homeWorkflowCard.footerTemplateHint', '配置工作流')
    : item.item_type === 'workflow_instance'
      ? t('homeWorkflowCard.footerInstanceHint', '启动工作流')
      : isSkill
        ? t('homeWorkflowCard.footerSkillHint', '安装技能')
        : t('homeWorkflowCard.footerHint');

  /** 技能安装/更新处理 */
  const handleSkillInstall = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    if (isInstalling) return;

    setIsInstalling(true);
    installPlazaSkill(skillSlug, {
      version: skillStatus?.cloudVersion ?? item.skill_version,
      force: isSkillUpdateAvailable,
      title: item.title,
      description: item.description ?? undefined,
    })
      .then(() => {
        onSkillInstalled?.();
        toast.success(
          isSkillUpdateAvailable
            ? t('plaza.toast.updateSuccess', { defaultValue: '更新成功，正在生效' })
            : t('plaza.toast.installSuccess', { defaultValue: '安装成功，正在生效' }),
        );
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
  }, [skillSlug, isInstalling, isSkillUpdateAvailable, skillStatus?.cloudVersion, item.skill_version, item.title, item.description, t, onSkillInstalled]);

  /** 技能使用处理（已安装技能）：与 Skills 页面「使用技能」一致，预填黄色技能 chip */
  const handleSkillUse = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    if (isSkillDisabled) return;
    // Start a new session so the Gateway picks up any newly installed skills
    useChatStore.getState().newSession();
    // 走 ?skill= 深链在输入框预填黄色技能 chip，由用户确认后发送；
    // 不用 ?q= 直接发送纯文本（那样不会出现技能标签）。
    navigate(`/?skill=${encodeURIComponent(skillSlug)}`);
  }, [isSkillDisabled, navigate, skillSlug]);

  return (
    <div className={cn(homeHubInteractiveCardShellClass, 'text-left')}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className={cn(homeHubCardTitleClass, 'truncate')}>{item.title}</h3>
            {item.category ? (
              <span className={cn('shrink-0', homeHubCardTagClass)}>
                {item.category}
              </span>
            ) : null}
          </div>
        </div>
      </div>

      <div className={homeHubCardBodyRegionClass}>
        <p className={cn(homeHubCardDescClass, 'line-clamp-3 overflow-hidden')}>{item.description ?? ''}</p>
      </div>

      <div className={homeHubCardFooterRegionClass}>
        <AvatarStack urls={avatarUrls} />
        {isSkill ? (
          <button
            type="button"
            className="flex flex-1 justify-end shrink-0 items-center gap-0.5 text-[13px] font-medium text-[#4760FE] dark:text-blue-400 hover:underline disabled:opacity-50"
            onClick={isSkillUpdateAvailable ? handleSkillInstall : isSkillInstalled ? handleSkillUse : handleSkillInstall}
            disabled={isInstalling || skillStatusLoading || (!isSkillUpdateAvailable && isSkillDisabled)}
          >
            {isInstalling || skillStatusLoading ? (
              <span className="animate-spin h-3.5 w-3.5 border-2 border-[#4760FE]/30 border-t-[#4760FE] rounded-full dark:border-blue-400/30 dark:border-t-blue-400" />
            ) : isSkillUpdateAvailable ? (
              t('plaza.action.updateSkill', { defaultValue: '更新技能' })
            ) : isSkillInstalled ? (
              t('plaza.action.useSkill', { defaultValue: '使用技能' })
            ) : (
              t('plaza.action.installSkill', { defaultValue: '安装技能' })
            )}
            <ChevronRight className="h-3.5 w-3.5 shrink-0 opacity-80" aria-hidden />
          </button>
        ) : (
          <button
            type="button"
            className="flex flex-1 justify-end shrink-0 items-center gap-0.5 text-[13px] font-medium text-[#4760FE] dark:text-blue-400 hover:underline"
            onClick={onClick}
          >
            {footerHintText}
            <ChevronRight className="h-3.5 w-3.5 shrink-0 opacity-80" aria-hidden />
          </button>
        )}
      </div>
    </div>
  );
}
