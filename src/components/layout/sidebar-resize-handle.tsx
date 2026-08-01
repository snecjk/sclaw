/**
 * SidebarResizeHandle — Workspace 起始侧的 8px 拖拽 overlay。
 *
 * 默认透明；hover / dragging / focus-visible 显示提示线。
 * 不占 AppShell Grid 宽度；collapsed 时由父级不渲染本组件。
 */
import type { KeyboardEvent, PointerEvent } from 'react';
import { useTranslation } from 'react-i18next';
import {
  stoSidebarResizeEdgeClass,
  stoSidebarResizeHandleClass,
} from '@/lib/surfaces';
import { cn } from '@/lib/utils';

export interface SidebarResizeHandleProps {
  /** aria-valuenow — current rendered width */
  valueNow: number;
  ariaValueMin: number;
  ariaValueMax: number;
  isResizing?: boolean;
  onResizeStart: (event: PointerEvent<HTMLDivElement>) => void;
  onKeyboardKey: (key: string, shiftKey: boolean) => void;
  className?: string;
}

export function SidebarResizeHandle({
  valueNow,
  ariaValueMin,
  ariaValueMax,
  isResizing = false,
  onResizeStart,
  onKeyboardKey,
  className,
}: SidebarResizeHandleProps) {
  const { t } = useTranslation('common');

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (
      event.key === 'ArrowLeft'
      || event.key === 'ArrowRight'
      || event.key === 'Home'
      || event.key === 'End'
    ) {
      event.preventDefault();
      onKeyboardKey(event.key, event.shiftKey);
    }
  };

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-valuenow={Math.round(valueNow)}
      aria-valuemin={Math.round(ariaValueMin)}
      aria-valuemax={Math.round(ariaValueMax)}
      aria-label={t('sidebar.resizeSeparator', { defaultValue: 'Resize sidebar' })}
      tabIndex={0}
      data-resizing={isResizing ? 'true' : undefined}
      onPointerDown={onResizeStart}
      onKeyDown={handleKeyDown}
      className={cn(stoSidebarResizeHandleClass, className)}
    >
      <span aria-hidden className={stoSidebarResizeEdgeClass} />
    </div>
  );
}
