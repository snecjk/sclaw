import { useEffect } from 'react';
import { useResolvedAppearance, type ResolvedAppearance } from '@/hooks/use-resolved-appearance';

export const STO_APPEARANCE_MESSAGE_TYPE = 'sto:appearance-change' as const;

export function applyResolvedAppearance(root: HTMLElement, appearance: ResolvedAppearance): void {
  root.classList.remove('light', 'dark');
  root.classList.add(appearance);
  root.dataset.theme = appearance;
  root.style.colorScheme = appearance;
}

export function postResolvedAppearance(target: Window, appearance: ResolvedAppearance): void {
  target.postMessage({ type: STO_APPEARANCE_MESSAGE_TYPE, appearance }, '*');
}

export function ThemeController() {
  const appearance = useResolvedAppearance();

  useEffect(() => {
    applyResolvedAppearance(document.documentElement, appearance);
    document
      .querySelectorAll<HTMLIFrameElement>('iframe[data-sto-theme-sync="true"]')
      .forEach((frame) => {
        if (frame.contentWindow) postResolvedAppearance(frame.contentWindow, appearance);
      });
  }, [appearance]);

  return null;
}
