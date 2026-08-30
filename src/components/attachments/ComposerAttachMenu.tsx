import { createPortal } from 'react-dom';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';

export type ComposerAttachSource =
  | 'local'
  | 'drive'
  | 'qa_artifact'
  | 'site_shared_artifact';

export interface ComposerAttachMenuProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  anchorRef: React.RefObject<HTMLElement | null>;
  showSharedArtifact: boolean;
  onSelect: (source: ComposerAttachSource) => void;
  labels: {
    local: string;
    drive: string;
    qaArtifact: string;
    siteSharedArtifact: string;
  };
}

interface MenuPosition {
  /** 相对视口底边的距离：菜单贴在锚点上方展开 */
  bottom: number;
  left: number;
}

function positionAboveAnchor(anchor: HTMLElement): MenuPosition {
  const rect = anchor.getBoundingClientRect();
  return {
    bottom: Math.max(0, window.innerHeight - rect.top + 6),
    left: rect.left,
  };
}

export function ComposerAttachMenu({
  open,
  onOpenChange,
  anchorRef,
  showSharedArtifact,
  onSelect,
  labels,
}: ComposerAttachMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<MenuPosition>({ bottom: 0, left: 0 });

  useLayoutEffect(() => {
    if (!open) return;
    const anchor = anchorRef.current;
    if (!anchor) return;
    setPos(positionAboveAnchor(anchor));
  }, [open, anchorRef]);

  useEffect(() => {
    if (!open) return;

    const openedAt = Date.now();
    const onPointerDown = (event: MouseEvent) => {
      if (Date.now() - openedAt < 150) return;
      const target = event.target as Node | null;
      if (!target) return;
      if (menuRef.current?.contains(target)) return;
      if (anchorRef.current?.contains(target)) return;
      onOpenChange(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onOpenChange(false);
    };
    const onReposition = () => {
      const anchor = anchorRef.current;
      if (!anchor) return;
      setPos(positionAboveAnchor(anchor));
    };

    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    window.addEventListener('resize', onReposition);
    window.addEventListener('scroll', onReposition, true);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('resize', onReposition);
      window.removeEventListener('scroll', onReposition, true);
    };
  }, [open, onOpenChange, anchorRef]);

  if (!open || typeof document === 'undefined') return null;

  const items: Array<{ source: ComposerAttachSource; label: string }> = [
    { source: 'local', label: labels.local },
    { source: 'drive', label: labels.drive },
    { source: 'qa_artifact', label: labels.qaArtifact },
  ];
  if (showSharedArtifact) {
    items.push({ source: 'site_shared_artifact', label: labels.siteSharedArtifact });
  }

  return createPortal(
    <div
      ref={menuRef}
      role="menu"
      className={cn(
        'sto-overlay sto-overlay--menu-border fixed z-[100001] min-w-[180px] overflow-hidden rounded-[10px] border',
        'p-1 shadow-[var(--sto-shadow-dropdown-strong)]',
      )}
      style={{ bottom: pos.bottom, left: pos.left }}
    >
      {items.map((item) => (
        <button
          key={item.source}
          type="button"
          role="menuitem"
          className={cn(
            'flex w-full items-center rounded-[6px] px-3 py-2 text-left text-[13px] leading-5',
            'text-[var(--sto-text-primary)] hover:bg-[var(--sto-control-hover-bg)]',
          )}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => {
            onOpenChange(false);
            onSelect(item.source);
          }}
        >
          {item.label}
        </button>
      ))}
    </div>,
    document.body,
  );
}
