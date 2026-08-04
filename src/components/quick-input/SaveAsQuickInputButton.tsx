/**
 * 将消息内容存为快捷输入：内部处理查重、飞入动画、创建与 toast。
 * 父组件只传 content + 样式/children（图标）。
 */
import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { triggerFlyToTarget } from '@/components/fly-to-target';
import { useQuickInputStore } from './store';

export interface SaveAsQuickInputButtonProps {
  content: string;
  className?: string;
  children: ReactNode;
}

export function SaveAsQuickInputButton({
  content,
  className,
  children,
}: SaveAsQuickInputButtonProps) {
  const { t } = useTranslation('chat');
  const [busy, setBusy] = useState(false);
  const ensureLoaded = useQuickInputStore((s) => s.ensureLoaded);
  const getPresence = useQuickInputStore((s) => s.getPresence);
  const create = useQuickInputStore((s) => s.create);

  const handleClick = async (startEl: HTMLElement) => {
    if (busy) return;
    setBusy(true);
    try {
      // 未打开过 Picker 时缓存为空；查重前先确保列表已加载
      await ensureLoaded();
      const presence = getPresence(content);
      if (presence === 'empty') return;
      if (presence === 'exists') {
        toast.info(t('composer.quickInputAlreadyExists'));
        return;
      }

      // 查重通过后立刻播动画，创建请求并行发出
      triggerFlyToTarget(startEl);
      await create(content.trim());
      toast.success(t('composer.quickInputAddSuccess'));
    } catch (error) {
      console.error('[SaveAsQuickInputButton] Failed to create quick input:', error);
      toast.error(t('composer.quickInputSaveFailed'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className={className}
      disabled={busy}
      aria-label={t('composer.quickInputTitle')}
      title={t('composer.quickInputTitle')}
      onClick={(event) => {
        void handleClick(event.currentTarget);
      }}
    >
      {children}
    </Button>
  );
}
