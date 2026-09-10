import type { KeyboardEvent, PointerEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import {
  MESSAGES_LIST_MAX_WIDTH,
  MESSAGES_LIST_MIN_WIDTH,
} from '../lib/messages-list-resize-metrics';

export function MessagesListResizeHandle({
  valueNow,
  isResizing = false,
  onResizeStart,
  onKeyboardAdjust,
}: {
  valueNow: number;
  isResizing?: boolean;
  onResizeStart: (event: PointerEvent<HTMLDivElement>) => void;
  onKeyboardAdjust: (delta: number) => void;
}) {
  const { t } = useTranslation('common');

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'ArrowRight') {
      event.preventDefault();
      onKeyboardAdjust(1);
      return;
    }
    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      onKeyboardAdjust(-1);
    }
  };

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-valuenow={Math.round(valueNow)}
      aria-valuemin={MESSAGES_LIST_MIN_WIDTH}
      aria-valuemax={MESSAGES_LIST_MAX_WIDTH}
      aria-label={t('im.resizeListSeparator')}
      tabIndex={0}
      data-resizing={isResizing ? 'true' : undefined}
      onPointerDown={onResizeStart}
      onKeyDown={handleKeyDown}
      className={cn(
        'group no-drag absolute inset-y-0 right-0 z-20 w-[8px] translate-x-1/2',
        'cursor-col-resize bg-transparent',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
      )}
    >
      <span
        aria-hidden
        className={cn(
          'pointer-events-none absolute inset-y-0 right-1/2 w-[2px] translate-x-1/2 bg-[#FFD6BA]',
          'opacity-0 transition-opacity duration-150',
          'group-hover:opacity-100 group-focus-visible:opacity-100',
          'group-data-[resizing=true]:opacity-100',
        )}
      />
    </div>
  );
}
