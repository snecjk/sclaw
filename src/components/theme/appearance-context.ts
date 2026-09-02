import { createContext, useContext } from 'react';
import type { ResolvedAppearance } from '@/hooks/use-resolved-appearance';

export const STO_APPEARANCE_MESSAGE_TYPE = 'sto:appearance-change' as const;
export const STO_APPEARANCE_STATE_EVENT = 'sto:appearance-state' as const;

export type StoAppearancePreference = 'light' | 'dark' | 'system';

export type StoAppearanceState = {
  preference: StoAppearancePreference;
  appearance: ResolvedAppearance;
};

export const ResolvedAppearanceContext = createContext<ResolvedAppearance>('light');

export function useThemeAppearance(): ResolvedAppearance {
  return useContext(ResolvedAppearanceContext);
}

export function isStoAppearanceState(value: unknown): value is StoAppearanceState {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<StoAppearanceState>;
  const validPreference = candidate.preference === 'light'
    || candidate.preference === 'dark'
    || candidate.preference === 'system';
  const validAppearance = candidate.appearance === 'light' || candidate.appearance === 'dark';
  if (!validPreference || !validAppearance) return false;
  return candidate.preference === 'system' || candidate.preference === candidate.appearance;
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
