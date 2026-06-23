/**
 * ParameterFormDock - 吸附输入框上方的参数表单固定浮层
 *
 * 使用场景：Chat 页、HomeComposer 上方、任务详情对话区。
 * 数据来自 useActiveParameterForm（只读），提交走既有 submitParameterForm。
 */
import { AnimatePresence, motion } from 'framer-motion';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { stoChatShellHomeClass, stoChatShellPageClass } from '@/lib/surfaces';
import { useActiveParameterForm } from '@/hooks/use-active-parameter-form';
import { submitParameterForm } from '@/components/parameter-form/form-handlers';
import { PARAMETER_FORM_USE_FLOAT_DOCK } from '@/components/parameter-form/constants';
import { ParameterFormCard } from '@/components/parameter-form/ParameterFormCard';

export interface ParameterFormDockProps {
  /** 首页 Hero（780）；默认对话页（862） */
  layout?: 'home' | 'page';
  className?: string;
}

export function ParameterFormDock({ layout = 'page', className }: ParameterFormDockProps) {
  const { t } = useTranslation('chat');
  const activeForm = useActiveParameterForm();
  const show = PARAMETER_FORM_USE_FLOAT_DOCK && activeForm !== null;
  const widthShell = layout === 'home' ? stoChatShellHomeClass : stoChatShellPageClass;

  return (
    <AnimatePresence initial={false}>
      {show && activeForm ? (
        <motion.div
          key={activeForm.formId}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 8 }}
          transition={{ duration: 0.2, ease: 'easeOut' }}
          className={cn(
            // mb-[14px] = PARAMETER_FORM_DOCK_INPUT_GAP_PX（选项卡 ↔ 输入框）
            'mb-[14px] shrink-0',
            className,
          )}
        >
          <div className={cn(widthShell, 'px-0')}>
            <ParameterFormCard
              variant="chat-dock"
              config={activeForm.formConfig}
              context={activeForm.formContext}
              onSubmit={async (values) => {
                const ok = await submitParameterForm(activeForm.formId, values);
                if (!ok) {
                  toast.error(t('parameterForm.submitFailed', { defaultValue: '表单提交失败，请刷新页面后重试' }));
                }
              }}
            />
          </div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
