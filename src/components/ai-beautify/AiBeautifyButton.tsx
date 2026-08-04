/**
 * AI 美化按钮：内部管理 loading / 请求 / toast，父组件只传 value 与结果回调。
 * 接口对齐 TaskCreateModal：/api/scheduled-tasks/beautify-instruction
 */
import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { AiBeautifyIcon } from '@/components/icons/AiBeautifyIcon';
import { hostApiFetch } from '@/lib/host-api';
import { cn } from '@/lib/utils';

export interface AiBeautifyButtonProps {
  value: string;
  onBeautified: (next: string) => void;
  /** 内容为空时回调（由父组件展示校验错误） */
  onEmpty?: () => void;
  disabled?: boolean;
  className?: string;
  /** 美化场景：task=定时任务（默认），prompt=提示词模版 */
  type?: 'task' | 'prompt';
  workflowId?: string;
  workflowName?: string;
}

export function AiBeautifyButton({
  value,
  onBeautified,
  onEmpty,
  disabled,
  className,
  type = 'prompt',
  workflowId,
  workflowName,
}: AiBeautifyButtonProps) {
  const { t } = useTranslation('chat');
  const [beautifying, setBeautifying] = useState(false);

  const handleBeautify = async () => {
    const trimmed = value.trim();
    if (!trimmed) {
      onEmpty?.();
      return;
    }

    setBeautifying(true);
    try {
      const result = await hostApiFetch<{
        instruction: string;
        changed: boolean;
        source: 'model' | 'rules-fallback';
        model?: string;
      }>('/api/scheduled-tasks/beautify-instruction', {
        method: 'POST',
        body: JSON.stringify({
          instruction: trimmed,
          type,
          workflowId: workflowId || undefined,
          workflowName: workflowName || undefined,
        }),
      });

      onBeautified(result.instruction);

      if (!result.changed) {
        toast.info(t('composer.quickInputBeautifyNoChange'));
        return;
      }

      if (result.source === 'rules-fallback') {
        toast.warning(t('composer.quickInputBeautifyFallback'));
        return;
      }

      toast.success(
        result.model
          ? t('composer.quickInputBeautifySuccessWithModel', { model: result.model })
          : t('composer.quickInputBeautifySuccess'),
      );
    } catch (err) {
      toast.error(String(err) || t('composer.quickInputBeautifyFailed'));
    } finally {
      setBeautifying(false);
    }
  };

  return (
    <button
      type="button"
      onClick={() => {
        void handleBeautify();
      }}
      disabled={disabled || !value.trim() || beautifying}
      className={cn(
        'inline-flex items-center gap-1 text-sm font-medium leading-5 transition-opacity',
        'text-[#FF7D00] hover:opacity-80',
        'disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      aria-label={t('composer.quickInputBeautifyAria')}
    >
      {beautifying ? (
        <Loader2 className="shrink-0 animate-spin" width={11} height={12} aria-hidden />
      ) : (
        <AiBeautifyIcon />
      )}
      {beautifying
        ? t('composer.quickInputBeautifying')
        : t('composer.quickInputBeautifyButton')}
    </button>
  );
}
