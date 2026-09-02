/**
 * SplitPanelResizeHandle — 三栏统一 Grid 上的拖拽热区 + 提示线。
 *
 * - 命中区与视觉线共用预览框左描边锚点（逻辑分界 + inset-x）
 * - 提示线 #FFD6BA / 2px：默认隐藏；hover / dragging / focus-visible 显示
 * - 禁止恢复旧短灰线胶囊；不改全局 primary
 */
import type { KeyboardEvent, PointerEvent } from 'react';
import { useTranslation } from 'react-i18next';
import {
  STO_PREVIEW_SPLIT_MAX,
  STO_PREVIEW_SPLIT_MIN,
  stoSplitPanelResizeEdgeClass,
  stoSplitPanelResizeHandleClass,
} from '@/lib/surfaces';
import { cn } from '@/lib/utils';

export interface SplitPanelResizeHandleProps {
  /** 当前预览区宽度百分比（aria-valuenow） */
  valuePercent: number;
  /** 最小值，默认 30 */
  minPercent?: number;
  /** 最大值，默认 70 */
  maxPercent?: number;
  /**
 * 是否正在拖拽。拖动中必须用此状态保持提示线可见，不能只依赖 CSS :hover。
 */
  isResizing?: boolean;
  /** Pointer 按下开始拖拽 */
  onResizeStart: (event: PointerEvent<HTMLDivElement>) => void;
  /**
   * 键盘微调：deltaPercent 为正表示预览区变宽。
   * ArrowLeft → +1；ArrowRight → -1（与「向左拖 = 预览变宽」一致）。
   */
  onKeyboardAdjust: (deltaPercent: number) => void;
  /** 覆盖默认「调整预览区宽度」文案（例如建站工作台会话分栏） */
  ariaLabel?: string;
  className?: string;
}

export function SplitPanelResizeHandle({
  valuePercent,
  minPercent = STO_PREVIEW_SPLIT_MIN,
  maxPercent = STO_PREVIEW_SPLIT_MAX,
  isResizing = false,
  onResizeStart,
  onKeyboardAdjust,
  ariaLabel,
  className,
}: SplitPanelResizeHandleProps) {
  const { t } = useTranslation('chat');

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      onKeyboardAdjust(1);
      return;
    }
    if (event.key === 'ArrowRight') {
      event.preventDefault();
      onKeyboardAdjust(-1);
    }
  };

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-valuenow={Math.round(valuePercent)}
      aria-valuemin={minPercent}
      aria-valuemax={maxPercent}
      aria-label={ariaLabel ?? t('preview.resizeSeparator')}
      tabIndex={0}
      data-resizing={isResizing ? 'true' : undefined}
      onPointerDown={onResizeStart}
      onKeyDown={handleKeyDown}
      className={cn(stoSplitPanelResizeHandleClass, className)}
    >
      <span aria-hidden className={stoSplitPanelResizeEdgeClass} />
    </div>
  );
}
