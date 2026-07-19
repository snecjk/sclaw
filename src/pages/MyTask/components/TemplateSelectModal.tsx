/**
 * TemplateSelectModal 组件
 * 工作流选择弹窗：展示官方推荐工作流卡片。
 * - 点击「添加」：先将模版实例化为工作流实例，再回调父级用实例 id 打开 TaskCreateModal 创建定时任务。
 */

import { useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { X, Loader2 } from 'lucide-react';
import { AnimatePresence, motion } from 'framer-motion';
import { toast } from 'sonner';
import { myTaskEmptyTemplateCardClass, myTaskEmptyTemplateAddButtonClass } from '@/lib/surfaces';
import { instantiateWorkflowFromTemplate } from '../lib/instantiate-workflow';
import type { OfficialWorkflowCard } from '@/pages/Workflow/types';

interface TemplateSelectModalProps {
  /** 弹窗是否打开 */
  open: boolean;
  /** 关闭弹窗回调 */
  onClose: () => void;
  /** 官方推荐工作流列表 */
  officialCards: OfficialWorkflowCard[];
  /** 实例化成功回调：父级用实例 id + 模版名打开 TaskCreateModal 创建定时任务 */
  onInstantiated?: (instanceId: string, templateName: string) => void;
}

export function TemplateSelectModal({
  open,
  onClose,
  officialCards,
  onInstantiated,
}: TemplateSelectModalProps) {
  const { t } = useTranslation('tasks');
  const [loadingCardId, setLoadingCardId] = useState<string | null>(null);

  const handleSelect = useCallback(
    async (card: OfficialWorkflowCard) => {
      setLoadingCardId(card.id);
      try {
        const instanceId = await instantiateWorkflowFromTemplate(card.id);
        onInstantiated?.(instanceId, card.name);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        toast.error(`工作流实例化失败: ${message}`);
      } finally {
        setLoadingCardId(null);
      }
    },
    [onInstantiated],
  );

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center px-4"
          onClick={onClose}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2, ease: 'easeInOut' }}
        >
          <motion.div
            className="w-full max-w-[min(820px,100%)] bg-background rounded-[22px] border border-border shadow-2xl flex flex-col max-h-[calc(100vh-4rem)]"
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
              {officialCards.length === 0 ? (
                <div className="flex items-center justify-center py-16">
                  <p className="text-sm text-muted-foreground">{t('myTask.templateModal.empty')}</p>
                </div>
              ) : (
                <div
                  role="list"
                  aria-label={t('myTask.empty.officialAria')}
                  className="grid grid-cols-1 gap-[clamp(12px,1.4vw,16px)] sm:grid-cols-2 lg:grid-cols-3"
                >
                  {officialCards.map((card) => {
                    const isLoading = loadingCardId === card.id;
                    return (
                    <article key={card.id} role="listitem" className={myTaskEmptyTemplateCardClass}>
                      <div className="mb-2 flex items-start gap-2">
                        <svg
                          className="mt-px shrink-0 text-muted-foreground"
                          viewBox="0 0 24 24"
                          width="18"
                          height="18"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="1.75"
                          aria-hidden="true"
                        >
                          <circle cx="12" cy="12" r="9" />
                          <path d="M12 7v5l3 2" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                        <h2 className="m-0 min-w-0 flex-1 text-[15px] font-bold leading-[1.35] tracking-[-0.02em] text-foreground">
                          {card.name}
                        </h2>
                      </div>
                      <p className="m-0 mb-3 line-clamp-2 flex-1 text-[13px] leading-[1.5] text-muted-foreground">
                        {card.description}
                      </p>
                      <div className="mt-auto flex items-center justify-end gap-3 border-t border-border pt-2.5 text-xs">
                        <button
                          type="button"
                          onClick={() => handleSelect(card)}
                          disabled={isLoading}
                          className={myTaskEmptyTemplateAddButtonClass}
                        >
                          {isLoading ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                          ) : (
                            t('myTask.empty.addTemplate')
                          )}
                        </button>
                      </div>
                    </article>
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
