import { useEffect, type RefObject } from 'react';

export interface UseMentionPopoverDismissOutsideOptions {
  open: boolean;
  panelRef: RefObject<HTMLElement | null>;
  excludeRef?: RefObject<HTMLElement | null>;
  onDismissOutside?: () => void;
}

/** @ 联系人浮层：点击面板与 exclude 区域外部时关闭 */
export function useMentionPopoverDismissOutside({
  open,
  panelRef,
  excludeRef,
  onDismissOutside,
}: UseMentionPopoverDismissOutsideOptions): void {
  useEffect(() => {
    if (!open || !onDismissOutside) return;

    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (panelRef.current?.contains(target)) return;
      if (excludeRef?.current?.contains(target)) return;
      onDismissOutside();
    };

    document.addEventListener('mousedown', onPointerDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
    };
  }, [excludeRef, onDismissOutside, open, panelRef]);
}
