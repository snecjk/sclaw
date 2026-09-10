/**
 * useMonacoColorTheme — Monaco 主题（vs-dark/light）跟随 settings，
 * 与 AppDevMonacoEditor 既有判定一致，供 DiffEditor / Editor 共用。
 */
import { useSettingsStore } from '@/stores/settings';

export function useMonacoColorTheme(): 'vs-dark' | 'light' {
  const theme = useSettingsStore((s) => s.theme);
  if (theme === 'dark') return 'vs-dark';
  if (
    theme === 'system'
    && typeof window !== 'undefined'
    && window.matchMedia('(prefers-color-scheme: dark)').matches
  ) {
    return 'vs-dark';
  }
  return 'light';
}
