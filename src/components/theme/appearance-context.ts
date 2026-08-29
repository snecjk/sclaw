import { createContext, useContext } from 'react';
import type { ResolvedAppearance } from '@/hooks/use-resolved-appearance';

export const STO_APPEARANCE_MESSAGE_TYPE = 'sto:appearance-change' as const;

export const ResolvedAppearanceContext = createContext<ResolvedAppearance>('light');

export function useThemeAppearance(): ResolvedAppearance {
  return useContext(ResolvedAppearanceContext);
}

export function applyResolvedAppearance(root: HTMLElement, appearance: ResolvedAppearance): void {
  root.classList.remove('light', 'dark');
  root.classList.add(appearance);
  root.dataset.theme = appearance;
  root.style.colorScheme = appearance;
}

export function postResolvedAppearance(target: Window, appearance: ResolvedAppearance): void {
  target.postMessage({ type: STO_APPEARANCE_MESSAGE_TYPE, appearance }, '*');
}
