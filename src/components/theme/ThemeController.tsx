import { useEffect, useState, type ReactNode } from 'react';
import { useResolvedAppearance } from '@/hooks/use-resolved-appearance';
import { subscribeHostEvent } from '@/lib/host-events';
import { useSettingsStore } from '@/stores/settings';
import {
  applyResolvedAppearance,
  isStoAppearanceState,
  postResolvedAppearance,
  ResolvedAppearanceContext,
  STO_APPEARANCE_STATE_EVENT,
  type StoAppearanceState,
} from './appearance-context';

export function ThemeController({ children }: { children?: ReactNode }) {
  const preference = useSettingsStore((state) => state.theme);
  const localAppearance = useResolvedAppearance();
  const [authoritativeState, setAuthoritativeState] = useState<StoAppearanceState | null>(null);
  const appearance = authoritativeState?.preference === preference
    ? authoritativeState.appearance
    : localAppearance;

  useEffect(() => subscribeHostEvent(STO_APPEARANCE_STATE_EVENT, (payload) => {
    if (!isStoAppearanceState(payload)) return;
    setAuthoritativeState(payload);
    useSettingsStore.setState({ theme: payload.preference });
  }), []);

  useEffect(() => {
    applyResolvedAppearance(document.documentElement, appearance);
    document
      .querySelectorAll<HTMLIFrameElement>('iframe[data-sto-theme-sync="true"]')
      .forEach((frame) => {
        if (frame.contentWindow) postResolvedAppearance(frame.contentWindow, appearance);
      });
  }, [appearance]);

  return (
    <ResolvedAppearanceContext.Provider value={appearance}>
      {children}
    </ResolvedAppearanceContext.Provider>
  );
}
