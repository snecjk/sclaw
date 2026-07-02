import { useEffect, useState } from 'react';
import { useSettingsStore } from '@/stores/settings';

export type ResolvedAppearance = 'light' | 'dark';

/**
 * 解析 settings.theme（含 system）为实际 light/dark，与 App.tsx 给 html 加 class 的逻辑一致。
 */
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
