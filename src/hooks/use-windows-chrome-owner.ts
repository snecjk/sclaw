import { useLocation } from 'react-router-dom';
import { useAppShellLayout } from '@/components/layout/app-shell-layout-context';
import { useAppPlazaShellStore } from '@/stores/app-plaza-shell';
import { useSclawBrowserOverlayStore } from '@/stores/sclaw-browser-overlay';

export type WindowsChromeOwner =
  | 'none'
  | 'content-header'
  | 'app-plaza'
  | 'shell-fallback';

export function resolveWindowsChromeOwner(input: {
  isProvincial: boolean;
  pathname: string;
  browserOverlayOpen: boolean;
  appPlazaVisible: boolean;
}): WindowsChromeOwner {
  if (!input.isProvincial) return 'none';
  if (input.browserOverlayOpen) return 'shell-fallback';
  if (input.appPlazaVisible) return 'app-plaza';
  // ContentHeader 对这些路由返回 null，改由 Shell fallback 挂载 Windows 控件
  if (
    input.pathname.startsWith('/settings')
    || input.pathname.startsWith('/skills')
    || input.pathname.startsWith('/my-tasks')
  ) {
    return 'shell-fallback';
  }
  return 'content-header';
}

/** Exactly one provincial Chrome Surface owns the Windows controls at a time. */
export function useWindowsChromeOwner(): WindowsChromeOwner {
  const { pathname } = useLocation();
  const { snapshot } = useAppShellLayout();
  const browserOverlayOpen = useSclawBrowserOverlayStore((s) => s.session !== null);
  const appPlazaVisible = useAppPlazaShellStore((s) => s.routeActive);

  return resolveWindowsChromeOwner({
    isProvincial: snapshot.layoutVariant === 'provincial',
    pathname,
    browserOverlayOpen,
    appPlazaVisible,
  });
}
