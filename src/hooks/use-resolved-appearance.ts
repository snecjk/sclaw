import { useEffect, useState } from 'react';
import { useSettingsStore } from '@/stores/settings';

export type ResolvedAppearance = 'light' | 'dark';

/** Resolves the SClaw appearance setting to a concrete light or dark value. */
export function useResolvedAppearance(): ResolvedAppearance {
  const theme = useSettingsStore((s) => s.theme);
  const [systemDark, setSystemDark] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches,
  );

  useEffect(() => {
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => setSystemDark(mediaQuery.matches);
    mediaQuery.addEventListener('change', onChange);
    return () => mediaQuery.removeEventListener('change', onChange);
  }, []);

  if (theme === 'dark') return 'dark';
  if (theme === 'light') return 'light';
  return systemDark ? 'dark' : 'light';
}
