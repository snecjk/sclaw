/**
 * TemplateSelectModal 组件
 * 模版选择弹窗：展示官方推荐工作流模版卡片，点击后打开 TaskCreateModal 并预填工作流
 */

import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { X } from 'lucide-react';
import { AnimatePresence, motion } from 'framer-motion';
import { myTaskEmptyTemplateCardClass, myTaskEmptyTemplateAddButtonClass } from '@/lib/surfaces';
import type { OfficialWorkflowCard } from '@/pages/Workflow/types';

interface TemplateSelectModalProps {
  /** 弹窗是否打开 */
  open: boolean;
  /** 关闭弹窗回调 */
  onClose: () => void;
  /** 官方推荐工作流模版列表 */
  officialCards: OfficialWorkflowCard[];
  /** 选择模版回调：关闭弹窗并打开 TaskCreateModal 预填工作流 */
  onSelect?: (card: OfficialWorkflowCard) => void;
}

export function TemplateSelectModal({
  open,
  onClose,
  officialCards,
  // onSelect
}: TemplateSelectModalProps) {
  const navigate = useNavigate();
  const { t } = useTranslation('tasks');

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
                  {officialCards.map((card) => (
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
                      <div className="mt-auto flex items-center justify-between gap-3 border-t border-border pt-2.5 text-xs">
                        <span className="inline-flex min-w-0 items-center font-normal leading-[1.4] text-muted-foreground">
                          {card.category || t('myTask.empty.templateFallbackCategory')}
                        </span>
                        <button
                          type="button"
                          // onClick={() => onSelect(card)}
                          onClick={() => {
                            const q = encodeURIComponent(`/${card.name}`);
                            const wid = encodeURIComponent(card.id);
                            navigate(`/?q=${q}&workflowId=${wid}`);
                          }}
                          className={myTaskEmptyTemplateAddButtonClass}
                        >
                          {t('myTask.empty.addTemplate')}
                        </button>
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
