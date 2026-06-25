/**
 * ContentHeaderSessionChip — 标题栏会话 pill（truncate + 关闭）。
 *
 * 使用位置：ContentHeader 左侧，侧栏展开钮右侧。
 */
import { X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import {
  contentHeaderSessionChipClass,
  contentHeaderSessionChipCloseClass,
  contentHeaderSessionChipLabelClass,
} from '@/lib/surfaces';

export interface ContentHeaderSessionChipProps {
  /** 会话标题（已 resolveSessionLabel） */
  label: string;
  /** 关闭当前会话视图 */
  onClose: () => void;
}

export function ContentHeaderSessionChip({ label, onClose }: ContentHeaderSessionChipProps) {
  const { t } = useTranslation('chat');

  return (
    <div className={contentHeaderSessionChipClass} title={label}>
      <span className={contentHeaderSessionChipLabelClass}>{label}</span>
      <button
        type="button"
        className={contentHeaderSessionChipCloseClass}
        aria-label={t('toolbar.closeSession')}
        onClick={onClose}
      >
        <X className="h-3.5 w-3.5" aria-hidden />
      </button>
    </div>
  );
}
