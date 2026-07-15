import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { RefreshCw, SquareArrowOutUpRight, Plus, ArrowDownToLine, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { useSkillPlazaStore } from '@/stores/skill-plaza';
import { useChatStore } from '@/stores/chat';
import { Switch } from '@/components/ui/switch';
import { Tooltip, TooltipArrow, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import type { SkillSummary } from '@/types/skill-plaza';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import fileIcon from '@/assets/icons/file.svg';

interface SkillCardProps {
  skill: SkillSummary;
  onOpenDetail?: (skill: SkillSummary) => void;
  onDelete?: (skill: SkillSummary) => void;
  isMineTab?: boolean;
}

const actionIconBtnClass =
  'inline-flex items-center justify-center w-7 h-7 p-0 border-none rounded-lg bg-transparent text-[#1D2129] cursor-pointer transition-colors hover:bg-[#F2F3F5] disabled:opacity-50 disabled:cursor-not-allowed dark:text-foreground dark:hover:bg-muted';

const actionTooltipClass =
  'overflow-visible border-none bg-[#1D2129] px-2.5 py-1.5 text-xs font-medium text-white shadow-none';

export function SkillCard({ skill, onOpenDetail, onDelete, isMineTab }: SkillCardProps) {
  const { t } = useTranslation('skills');
  const navigate = useNavigate();
  const { installing } = useSkillPlazaStore();
  const [isHovered, setIsHovered] = useState(false);
  const [localEnabled, setLocalEnabled] = useState(skill.enabled ?? false);
  useEffect(() => {
    setLocalEnabled(skill.enabled ?? false);
  }, [skill.enabled]);
  const isInstalling = installing[skill.slug];
  const isDisabled = skill.enabled === false;

  const handleUse = (e: React.MouseEvent) => {
    e.stopPropagation();
    // Start a new session so the Gateway picks up any newly installed skills
    useChatStore.getState().newSession();
    navigate(`/?skill=${encodeURIComponent(skill.slug)}`);
    useSkillPlazaStore.getState().useSkill(skill.slug).catch(() => {});
  };

  const handleInstall = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (isInstalling) return;
    const isUpdate = skill.updateAvailable;
    const { installSkill, fetchPlazaSkills } = useSkillPlazaStore.getState();
    installSkill(skill.slug, {
      version: skill.version,
      force: skill.updateAvailable,
      title: skill.title,
      description: skill.description,
    })
      .then(() => {
        fetchPlazaSkills({ reset: true });
        toast.success(
          isUpdate
            ? t('plaza.toast.updateSuccess', { defaultValue: '更新成功，正在生效' })
            : t('plaza.toast.installSuccess', { defaultValue: '安装成功，正在生效' }),
        );
      })
      .catch((err) => {
        toast.error(
          isUpdate
            ? t('plaza.toast.updateError', { defaultValue: '更新失败' })
            : t('plaza.toast.installError', { defaultValue: '安装失败' }),
          { description: String(err) },
        );
      });
  };

  const renderIcon = () => {
    if (skill.icon) {
      return (
        <span
          className="relative w-9 h-9 rounded-lg flex items-center justify-center bg-white text-foreground flex-shrink-0 border border-border"
          style={{ boxShadow: '0 1px 4px rgba(15,23,42,0.05), 0 4px 12px rgba(15,23,42,0.04)' }}
        >
          <span dangerouslySetInnerHTML={{ __html: skill.icon.replace(/width="[^"]*"/, 'width="16"').replace(/height="[^"]*"/, 'height="16"') }} />
        </span>
      );
    }
    return (
      <span
        className="relative w-9 h-9 rounded-lg flex items-center justify-center bg-white text-foreground flex-shrink-0 border border-border"
        style={{ boxShadow: '0 1px 4px rgba(15,23,42,0.05), 0 4px 12px rgba(15,23,42,0.04)' }}
      >
        <img src={fileIcon} alt="" aria-hidden className="h-4 w-4 object-contain" />
      </span>
    );
  };

  const canUse = isMineTab
    ? (skill.installed || skill.source === 'mine')
    : skill.installed;

  const tag = !isMineTab
    ? (skill.installed
      ? { label: t('plaza.tag.installed', { defaultValue: '已安装' }), bg: 'rgba(34,197,94,0.12)', text: '#15803d' }
      : null)
    : skill.source === 'mine'
      ? { label: t('plaza.tag.mine', { defaultValue: '自建' }), bg: 'rgba(249,115,22,0.12)', text: '#ff6700' }
      : null;

  const renderPlazaAction = () => {
    if (skill.updateAvailable) {
      return (
        <Tooltip delayDuration={200}>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={handleInstall}
              disabled={isInstalling}
              className={actionIconBtnClass}
            >
              {isInstalling ? (
                <RefreshCw className="h-3.5 w-3.5 animate-spin text-[#00B42A]" />
              ) : (
                <RefreshCw className="h-3.5 w-3.5" />
              )}
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom" sideOffset={6} className={actionTooltipClass}>
            {t('plaza.action.updateSkill', { defaultValue: '更新技能' })}
            <TooltipArrow className="fill-[#1D2129]" width={10} height={5} />
          </TooltipContent>
        </Tooltip>
      );
    }
    if (canUse) {
      return (
        <Tooltip delayDuration={200}>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={handleUse}
              className={actionIconBtnClass}
            >
              <SquareArrowOutUpRight className="h-3.5 w-3.5" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom" sideOffset={6} className={actionTooltipClass}>
            {t('plaza.action.use', { defaultValue: '使用' })}
            <TooltipArrow className="fill-[#1D2129]" width={10} height={5} />
          </TooltipContent>
        </Tooltip>
      );
    }
    return (
      <Tooltip delayDuration={200}>
        <TooltipTrigger asChild>
          <button
            type="button"
            onClick={handleInstall}
            disabled={isInstalling}
            className={actionIconBtnClass}
          >
            {isInstalling ? (
              <RefreshCw className="h-3.5 w-3.5 animate-spin text-[#00B42A]" />
            ) : (
              <Plus className="h-3.5 w-3.5" strokeWidth={2.25} />
            )}
          </button>
        </TooltipTrigger>
        <TooltipContent side="bottom" sideOffset={6} className={actionTooltipClass}>
          {t('plaza.action.install', { defaultValue: '安装' })}
          <TooltipArrow className="fill-[#1D2129]" width={10} height={5} />
        </TooltipContent>
      </Tooltip>
    );
  };

  return (
    <article
      className="relative flex flex-col min-w-0 p-4 border border-border rounded-2xl bg-white cursor-pointer overflow-visible transition-[border-color,box-shadow] duration-150 hover:border-border hover:shadow-sm dark:bg-background"
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      onClick={() => onOpenDetail?.(skill)}
      data-skill-installed={canUse}
    >
      <div className={cn('flex flex-col flex-1 min-h-0 no-underline text-inherit', isDisabled && 'opacity-50')}>
        {/* Top: icon + title + actions */}
        <div className="flex items-start gap-2.5 mb-3">
          {renderIcon()}
          <div className="flex flex-col items-start gap-1 min-w-0 flex-1">
            <h2 className="m-0 w-full max-w-full text-sm font-bold tracking-tight text-[#1D2129] whitespace-nowrap overflow-hidden text-ellipsis dark:text-foreground">
              {skill.title}
            </h2>
            <div className="flex flex-wrap items-center gap-1.5 min-w-0">
              {typeof skill.installCount === 'number' && skill.installCount >= 0 && (
                <span className="inline-flex items-center gap-1 text-xs text-[#86909C] font-medium">
                  <ArrowDownToLine className="h-3.5 w-3.5 opacity-55 flex-shrink-0" />
                  {skill.installCount >= 1000 ? `${(skill.installCount / 1000).toFixed(1)}k` : skill.installCount}
                </span>
              )}
              {tag && (
                <span
                  className="text-[11px] font-semibold px-1.5 py-[2px] rounded flex-shrink-0 leading-[1.4]"
                  style={{ backgroundColor: tag.bg, color: tag.text }}
                >
                  {tag.label}
                </span>
              )}
            </div>
            {/* 暂时隐藏使用人数 */}
          </div>

          {isMineTab ? (
            <div className="flex items-center gap-1.5 flex-shrink-0">
              {onDelete && (
                <button
                  onClick={(e) => { e.stopPropagation(); onDelete(skill); }}
                  className={cn(
                    'inline-flex items-center justify-center w-7 h-7 p-0 border-none rounded-lg bg-transparent text-muted-foreground cursor-pointer hover:text-red-600 transition-all',
                    isHovered ? 'opacity-100 visible' : 'opacity-0 invisible',
                  )}
                  title={t('plaza.action.delete', { defaultValue: '删除' })}
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              )}
              <Switch
                checked={localEnabled}
                onCheckedChange={(checked) => {
                  setLocalEnabled(checked);
                  useSkillPlazaStore.getState().toggleSkill(skill.slug, checked).then(() => {
                    if (!checked) {
                      toast.custom(() => (
                        <div className="bg-[#1a1a1a] text-white px-6 py-2.5 rounded-full text-sm font-medium shadow-lg">
                          技能已关闭，仍可在「我的技能」中查看
                        </div>
                      ), { duration: 3000 });
                    } else {
                      toast.custom(() => (
                        <div className="bg-[#1a1a1a] text-white px-6 py-2.5 rounded-full text-sm font-medium shadow-lg">
                          技能已开启
                        </div>
                      ), { duration: 3000 });
                    }
                  }).catch((err) => {
                    setLocalEnabled(!checked);
                    console.error('[SkillCard] toggle failed:', err);
                    toast.custom(() => (
                      <div className="bg-[#1a1a1a] text-white px-6 py-2.5 rounded-full text-sm font-medium shadow-lg">
                        操作失败，请重试
                      </div>
                    ), { duration: 3000 });
                  });
                }}
                onClick={(e) => e.stopPropagation()}
                aria-label={t('plaza.action.toggle', { defaultValue: '启用/禁用' })}
              />
            </div>
          ) : (
            <div className="flex items-center flex-shrink-0" onClick={(e) => e.stopPropagation()}>
              {renderPlazaAction()}
            </div>
          )}
        </div>

        {/* Description */}
        <p className="m-0 text-[13px] leading-[20px] text-[#86909C] line-clamp-2 dark:text-muted-foreground">
          {skill.description}
        </p>
      </div>
    </article>
  );
}
