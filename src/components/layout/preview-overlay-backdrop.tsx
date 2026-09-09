import { useLayoutEffect, useRef, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';

const FOCUSABLE = 'button:not(:disabled),a[href],input:not(:disabled),textarea:not(:disabled),select:not(:disabled),iframe,[tabindex]:not([tabindex="-1"])';
const FLOATING_CONTROL = '[role="dialog"],[role="alertdialog"],[role="menu"],[role="listbox"],[data-radix-popper-content-wrapper]';

/** Only the backdrop is portalled. Header and preview keep their DOM identity. */
export function PreviewOverlayBackdrop({ active, panelRef, onClose }: {
  active: boolean;
  panelRef: RefObject<HTMLDivElement | null>;
  onClose: () => void;
}) {
  const { t } = useTranslation('chat');
  const closeRef = useRef(onClose);
  useLayoutEffect(() => { closeRef.current = onClose; }, [onClose]);

  useLayoutEffect(() => {
    const panel = panelRef.current;
    if (!active || !panel) return;
    const main = panel.closest('main');
    const header = main?.querySelector<HTMLElement>('[data-slot="preview-header-zone"]');
    const roots = [header, panel].filter((el): el is HTMLElement => Boolean(el));
    const previousFocus = document.activeElement as HTMLElement | null;
    const background = Array.from((main?.closest('[data-app-shell]') ?? document).querySelectorAll<HTMLElement>(
      'aside,[data-preview-background],[data-slot="chat-header-zone"],.sto-sidebar-resize-handle',
    ));
    const inertBefore = background.map((el) => el.hasAttribute('inert'));
    background.forEach((el) => el.setAttribute('inert', ''));

    const inside = (node: Node | null) => roots.some((root) => node && root.contains(node));
    const hasNestedDialog = () => Array.from(document.querySelectorAll('[role="dialog"],[role="alertdialog"]'))
      .some((el) => el !== panel && !el.closest('[hidden],[inert]') && el.getAttribute('data-state') !== 'closed');
    const focusables = () => roots.flatMap((root) => Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)))
      .filter((el) => {
        const style = getComputedStyle(el);
        return !el.closest('[hidden],[inert],[aria-hidden="true"]')
          && style.display !== 'none' && style.visibility !== 'hidden' && style.visibility !== 'collapse';
      });
    const focusFirst = () => (focusables()[0] ?? panel).focus({ preventScroll: true });
    const dismiss = () => { if (!hasNestedDialog()) closeRef.current(); };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || hasNestedDialog()) return;
      const target = event.target instanceof Element ? event.target : null;
      const floating = target?.closest(FLOATING_CONTROL);
      if (floating && floating !== panel) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        dismiss();
      } else if (event.key === 'Tab') {
        const items = focusables();
        const index = items.indexOf(document.activeElement as HTMLElement);
        if (index < 0 || (event.shiftKey ? index === 0 : index === items.length - 1)) {
          event.preventDefault();
          (event.shiftKey ? items.at(-1) ?? panel : items[0] ?? panel).focus();
        }
      }
    };
    const onFocus = (event: FocusEvent) => {
      const target = event.target as Element | null;
      if (inside(target) || target?.closest?.(FLOATING_CONTROL) || hasNestedDialog()) return;
      focusFirst();
    };
    window.addEventListener('keydown', onKeyDown);
    document.addEventListener('focusin', onFocus);
    // Electron delivers Escape from cross-origin frames, whose DOM events cannot bubble here.
    const unsubscribe = window.electron?.ipcRenderer?.on('preview:frame-escape', dismiss);

    const onFrameKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onKeyDown(event);
    };
    const frameCleanups = new Map<HTMLIFrameElement, () => void>();
    const observeFrames = () => {
      const frames = new Set(panel.querySelectorAll('iframe'));
      for (const [frame, clean] of frameCleanups) {
        if (!frames.has(frame)) { clean(); frameCleanups.delete(frame); }
      }
      for (const frame of frames) {
        if (frameCleanups.has(frame)) continue;
        let frameDocument: Document | null = null;
        const attach = () => {
          frameDocument?.removeEventListener('keydown', onFrameKeyDown);
          try { frameDocument = frame.contentDocument; } catch { frameDocument = null; }
          frameDocument?.addEventListener('keydown', onFrameKeyDown);
        };
        frame.addEventListener('load', attach);
        attach();
        frameCleanups.set(frame, () => {
          frame.removeEventListener('load', attach);
          frameDocument?.removeEventListener('keydown', onFrameKeyDown);
        });
      }
    };
    const observer = new MutationObserver(observeFrames);
    observer.observe(panel, { childList: true, subtree: true });
    observeFrames();
    focusFirst();
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('focusin', onFocus);
      if (typeof unsubscribe === 'function') unsubscribe();
      observer.disconnect();
      frameCleanups.forEach((clean) => clean());
      background.forEach((el, index) => { if (!inertBefore[index]) el.removeAttribute('inert'); });
      // React restores the pre-commit focus after layout-effect cleanup; restore after that.
      queueMicrotask(() => {
        if (document.querySelector('[data-preview-overlay-panel="true"]')) return;
        if (previousFocus?.isConnected && !previousFocus.closest('[hidden],[inert]')) previousFocus.focus({ preventScroll: true });
      });
    };
  }, [active, panelRef]);

  return active ? createPortal(
    <button
      type="button"
      tabIndex={-1}
      aria-label={t('toolbar.closePreview', { defaultValue: 'Close preview' })}
      className="sto-preview-overlay-backdrop no-drag"
      onClick={onClose}
    />,
    document.body,
  ) : null;
}
