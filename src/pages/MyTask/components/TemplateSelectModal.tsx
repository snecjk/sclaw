/**
 * TemplateSelectModal 组件
 * 官方推荐弹窗：展示推荐位全部类型（工作流模版/实例、技能、提示词），无分类 Tab。
 * 卡片复用首页 RecommendCard；选中后由父级把标题写入任务名称、描述写入任务描述（技能保留安装/更新）。
 */

import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { X } from 'lucide-react';
import { AnimatePresence, motion } from 'framer-motion';
import { RecommendCard } from '@/pages/Home/RecommendCard';
import { useHomeRecommendSkillStatus } from '@/pages/Home/use-home-recommend-skill-status';
import type { RecommendItem } from '@/lib/recommend-api';

interface TemplateSelectModalProps {
  /** 弹窗是否打开 */
  open: boolean;
  /** 关闭弹窗回调 */
  onClose: () => void;
  /** 推荐位条目（工作流 / 技能 / 提示词等） */
  items: RecommendItem[];
  /**
   * 选中条目回调：父级关闭弹窗并打开 TaskCreateModal，预填任务名称与描述。
   * 技能在安装/更新完成后也会走此回调。
   */
  onSelect: (item: RecommendItem) => void;
}

export function TemplateSelectModal({
  open,
  onClose,
  items,
  onSelect,
}: TemplateSelectModalProps) {
  const { t } = useTranslation('tasks');
  const {
    skillStatusMap,
    loading: skillStatusLoading,
    refreshingSlugs,
    handleRefresh: handleSkillStatusRefresh,
  } = useHomeRecommendSkillStatus(open ? items : []);

  const handleNonSkillClick = useCallback(
    (item: RecommendItem) => {
      onSelect(item);
    },
    [onSelect],
  );

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="sto-overlay-scrim sto-overlay-scrim--dialog fixed inset-0 z-50 flex items-center justify-center px-4"
          onClick={onClose}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2, ease: 'easeInOut' }}
        >
          <motion.div
            className="sto-overlay sto-overlay--dialog w-full max-w-[min(728px,100%)] rounded-[var(--sto-dialog-radius)] border flex flex-col max-h-[calc(100vh-4rem)]"
            onClick={(e) => e.stopPropagation()}
            initial={{ opacity: 0, scale: 0.96, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 8 }}
            transition={{ duration: 0.2, ease: 'easeOut' }}
          >
            {/* 标题区 */}
            <div className="flex items-start justify-between gap-4 mb-4 px-[18px] pt-[18px] flex-shrink-0">
              <div className="min-w-0">
                <h2 className="text-xl font-bold text-foreground tracking-[-0.02em] leading-[1.3] mb-2.5">
                  {t('myTask.templateModal.title')}
                </h2>
                <p className="text-[13px] leading-[1.55] text-muted-foreground">
                  {t('myTask.templateModal.subtitle')}
                </p>
              </div>
              <button
                type="button"
                onClick={onClose}
                className="shrink-0 flex items-center justify-center w-9 h-9 -mr-2 -mt-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                aria-label={t('myTask.createModal.closeAria')}
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* 卡片网格区 */}
            <div className="px-[18px] pb-[18px] flex-1 overflow-y-auto min-h-0">
              {items.length === 0 ? (
                <div className="flex items-center justify-center py-16">
                  <p className="text-sm text-muted-foreground">{t('myTask.templateModal.empty')}</p>
                </div>
              ) : (
                <div
                  role="list"
                  aria-label={t('myTask.empty.officialAria')}
                  className="grid grid-cols-1 gap-[clamp(12px,1.4vw,16px)] sm:grid-cols-2 lg:grid-cols-3"
                >
                  {items.map((item) => {
                    const skillSlug = item.skill_slug || item.item_ref_id;
                    return (
                      <div key={`${item.item_type}:${item.item_ref_id}`} role="listitem" className="min-h-0">
                        <RecommendCard
                          item={item}
                          skillClickMode="use-only"
                          onClick={() => handleNonSkillClick(item)}
                          onSkillUse={() => onSelect(item)}
                          onSkillInstalled={() => {
                            handleSkillStatusRefresh(skillSlug);
                          }}
                          skillStatus={
                            item.item_type === 'skill' ? skillStatusMap[skillSlug] : undefined
                          }
                          skillStatusLoading={
                            item.item_type === 'skill'
                              ? skillStatusLoading || refreshingSlugs.has(skillSlug)
                              : false
                          }
                        />
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
