import { useEffect, type ReactNode } from 'react';
import { useResolvedAppearance } from '@/hooks/use-resolved-appearance';
import {
  applyResolvedAppearance,
  postResolvedAppearance,
  ResolvedAppearanceContext,
} from './appearance-context';

export function ThemeController({ children }: { children?: ReactNode }) {
  const appearance = useResolvedAppearance();

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
