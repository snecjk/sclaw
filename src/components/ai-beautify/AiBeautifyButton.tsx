/**
 * AI 美化按钮：内部管理 loading / 请求 / toast，父组件只传 value 与结果回调。
 * 接口对齐 TaskCreateModal：/api/scheduled-tasks/beautify-instruction
 * 文案固定中文，不做多语言。
 */
import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { AiBeautifyIcon } from '@/components/icons/AiBeautifyIcon';
import { hostApiFetch } from '@/lib/host-api';
import { cn } from '@/lib/utils';

const COPY = {
  button: 'AI美化',
  beautifying: '美化中…',
  aria: 'AI 美化',
  noChange: '内容已较规范，无需调整',
  fallback: '模型暂时不可用，已使用基础规则优化',
  success: 'AI 已美化',
  successWithModel: (model: string) => `AI 已美化（${model}）`,
  failed: 'AI 美化失败，请稍后重试',
} as const;

export interface AiBeautifyButtonProps {
  value: string;
  onBeautified: (next: string) => void;
  /** 内容为空时回调（由父组件展示校验错误） */
  onEmpty?: () => void;
  disabled?: boolean;
  className?: string;
  /** 美化场景：task=定时任务描述，prompt=提示词模版（默认） */
  type?: 'task' | 'prompt';
  workflowId?: string;
  workflowName?: string;
  /** 点击时读取最新工作流上下文（优先于 workflowId / workflowName） */
  resolveWorkflow?: () => { workflowId?: string; workflowName?: string };
  /**
   * 任务描述含文件 / 技能 / 工作流时跳过请求（仅纯文本与 @ 提及才美化）。
   * `type="prompt"` 不使用。
   */
  hasStructuredChips?: () => boolean;
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
  resolveWorkflow,
  hasStructuredChips,
}: AiBeautifyButtonProps) {
  const [beautifying, setBeautifying] = useState(false);

  const handleBeautify = async () => {
    const trimmed = value.trim();
    if (!trimmed) {
      onEmpty?.();
      return;
    }

    if (type === 'task' && hasStructuredChips?.()) {
      setBeautifying(true);
      await new Promise((resolve) => {
        window.setTimeout(resolve, 1000);
      });
      toast.info(COPY.noChange);
      setBeautifying(false);
      return;
    }

    const workflow = resolveWorkflow?.() ?? {};
    const nextWorkflowId = workflow.workflowId || workflowId;
    const nextWorkflowName = workflow.workflowName || workflowName;

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
          workflowId: nextWorkflowId || undefined,
          workflowName: nextWorkflowName || undefined,
        }),
      });

      onBeautified(result.instruction);

      if (!result.changed) {
        toast.info(COPY.noChange);
        return;
      }

      if (result.source === 'rules-fallback') {
        toast.warning(COPY.fallback);
        return;
      }

      toast.success(
        result.model ? COPY.successWithModel(result.model) : COPY.success,
      );
    } catch (err) {
      toast.error(String(err) || COPY.failed);
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
      aria-label={COPY.aria}
    >
      {beautifying ? (
        <Loader2 className="shrink-0 animate-spin" width={11} height={12} aria-hidden />
      ) : (
        <AiBeautifyIcon />
      )}
      {beautifying ? COPY.beautifying : COPY.button}
    </button>
  );
}
