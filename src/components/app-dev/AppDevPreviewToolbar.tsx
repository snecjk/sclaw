/**
 * 预览工具条（T03）：后退 / 刷新 / 路由下拉 / 地址栏 / 设备切换 / 全屏 / 浏览器打开。
 *
 * - 设备切换只改外层容器宽度与设备框样式，绝不 remount <webview>（remount 是工作台
 *   jank 主因，见 AppDevWorkbenchStage 中 key 的注释）。
 * - 全屏优先 requestFullscreen，不可用 / 被拒时降级为 fixed 覆盖层（macOS webview
 *   全屏黑帧兜底），Esc 均可退出。
 * - 路由发现失败（如 dev web 无 Host API）时兜底为「当前地址」单条，控件不报错。
 */
import { memo, useEffect, useMemo, useState, type RefObject } from 'react';
import {
  ArrowLeft,
  ChevronDown,
  ExternalLink,
  Maximize,
  Minimize,
  Monitor,
  Pencil,
  RotateCw,
  Smartphone,
  Sparkles,
} from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { listAppRoutes, type AppRouteEntry } from '@/lib/app-dev-api';
import { matchAppDevRoute } from '@/lib/app-dev-preview-routes';
import { cn } from '@/lib/utils';
import {
  useAppDevWorkbenchStore,
  type AppDevPreviewDevice,
} from '@/stores/app-dev-workbench';
import './app-dev-preview-toolbar.css';

interface AppDevPreviewToolbarProps {
  workspaceId: string;
  canGoBack: boolean;
  /** 地址栏受控值（用户可能正在编辑）。 */
  address: string;
  /** 应用重启后自增，触发路由重新扫描。 */
  previewRevision: number;
  /** 全屏目标容器（工具条 + 预览视口的共同祖先）。 */
  fullscreenTargetRef: RefObject<HTMLElement | null>;
  onBack: () => void;
  onReload: () => void;
  onAddressChange: (next: string) => void;
  onAddressSubmit: () => void;
  onAddressBlur: () => void;
  onAddressEscape: (input: HTMLInputElement) => void;
  onOpenExternal: () => void;
  /** 选中路由条目（兜底单条不会触发）；完整地址由宿主按当前预览 URL 拼接。 */
  onNavigateRoute: (route: AppRouteEntry) => void;
  /** 打开手动微调面板（T06）。与对话修改独立。 */
  onOpenTune?: () => void;
  tuneActive?: boolean;
  /** 预览圈选对话修改，不经过手动微调。 */
  onToggleInspect?: () => void;
  inspectActive?: boolean;
}

export const AppDevPreviewToolbar = memo(function AppDevPreviewToolbar({
  workspaceId,
  canGoBack,
  address,
  previewRevision,
  fullscreenTargetRef,
  onBack,
  onReload,
  onAddressChange,
  onAddressSubmit,
  onAddressBlur,
  onAddressEscape,
  onOpenExternal,
  onNavigateRoute,
  onOpenTune,
  tuneActive = false,
  onToggleInspect,
  inspectActive = false,
}: AppDevPreviewToolbarProps) {
  const device = useAppDevWorkbenchStore((s) => s.device);
  const setDevice = useAppDevWorkbenchStore((s) => s.setDevice);

  const [routes, setRoutes] = useState<AppRouteEntry[]>([]);
  const [cssFullscreen, setCssFullscreen] = useState(false);
  const [nativeFullscreen, setNativeFullscreen] = useState(false);
  const fullscreen = cssFullscreen || nativeFullscreen;

  // 路由发现：工作区 / 预览重启后重新扫描；失败兜底空列表（菜单降级为当前地址）。
  useEffect(() => {
    let cancelled = false;
    setRoutes([]);
    void listAppRoutes(workspaceId)
      .then((next) => {
        if (!cancelled) setRoutes(next);
      })
      .catch(() => {
        if (!cancelled) setRoutes([]);
      });
    return () => {
      cancelled = true;
    };
  }, [workspaceId, previewRevision]);

  const currentRoute = useMemo(() => matchAppDevRoute(address, routes), [address, routes]);
  const routeItems = useMemo<AppRouteEntry[]>(() => {
    if (routes.length > 0) return routes;
    // 兜底：仅展示当前地址，保证菜单可用且不误导。
    return address.trim()
      ? [{ path: address.trim(), label: address.trim(), source: 'router' as const }]
      : [];
  }, [routes, address]);

  // 原生全屏状态跟踪（Esc 退出由浏览器触发 fullscreenchange）。
  useEffect(() => {
    const onChange = () => {
      const el = fullscreenTargetRef.current;
      const fsEl = document.fullscreenElement;
      setNativeFullscreen(Boolean(fsEl && el && (fsEl === el || fsEl.contains(el))));
    };
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, [fullscreenTargetRef]);

  // CSS 降级全屏：给目标容器挂 fixed 覆盖类。
  useEffect(() => {
    const el = fullscreenTargetRef.current;
    if (!el) return;
    el.classList.toggle('app-dev-preview-fullscreen', cssFullscreen);
    return () => el.classList.remove('app-dev-preview-fullscreen');
  }, [cssFullscreen, fullscreenTargetRef]);

  // CSS 降级全屏下 Esc 退出。
  useEffect(() => {
    if (!cssFullscreen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setCssFullscreen(false);
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [cssFullscreen]);

  const toggleFullscreen = () => {
    if (nativeFullscreen) {
      void document.exitFullscreen().catch(() => undefined);
      return;
    }
    if (cssFullscreen) {
      setCssFullscreen(false);
      return;
    }
    const el = fullscreenTargetRef.current;
    if (el && typeof el.requestFullscreen === 'function') {
      el.requestFullscreen().catch(() => setCssFullscreen(true));
      return;
    }
    setCssFullscreen(true);
  };

  const handleSelectRoute = (route: AppRouteEntry) => {
    if (routes.length === 0) return; // 兜底单条仅展示，不触发跳转
    onNavigateRoute(route);
  };

  return (
    <header className="app-plaza-browser-toolbar">
      <div className="app-plaza-browser-toolbar__nav">
        <button
          type="button"
          className="app-plaza-browser-toolbar__nav-btn"
          disabled={!canGoBack}
          onClick={onBack}
          title="返回上一页"
          aria-label="返回上一页"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden />
        </button>
        <button
          type="button"
          className="app-plaza-browser-toolbar__nav-btn"
          onClick={onReload}
          title="刷新"
          aria-label="刷新"
        >
          <RotateCw className="h-4 w-4" aria-hidden />
        </button>
      </div>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="app-plaza-browser-toolbar__btn app-dev-preview-route-trigger"
            title="切换预览页面"
            aria-label="切换预览页面"
          >
            <span className="app-dev-preview-route-trigger__label">
              {currentRoute?.label ?? '页面'}
            </span>
            <ChevronDown className="h-3.5 w-3.5 shrink-0" aria-hidden />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="z-[260] min-w-[10rem]">
          {routeItems.map((route) => {
            const active = currentRoute?.path === route.path;
            return (
              <DropdownMenuItem
                key={route.path}
                className="gap-1.5 text-xs"
                aria-current={active || undefined}
                onSelect={() => handleSelectRoute(route)}
              >
                <span className={cn('truncate font-mono', active && 'font-medium')}>
                  {route.label}
                </span>
              </DropdownMenuItem>
            );
          })}
        </DropdownMenuContent>
      </DropdownMenu>

      <form
        className="app-plaza-browser-address"
        onSubmit={(event) => {
          event.preventDefault();
          onAddressSubmit();
        }}
      >
        <input
          className="app-plaza-browser-toolbar__url"
          value={address}
          onChange={(event) => onAddressChange(event.target.value)}
          onBlur={onAddressBlur}
          onKeyDown={(event) => {
            if (event.key === 'Escape') onAddressEscape(event.target as HTMLInputElement);
          }}
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          aria-label="预览地址"
        />
      </form>

      <div className="app-dev-preview-device-cluster" role="group" aria-label="预览视口">
        <Tabs
          value={device}
          onValueChange={(value) => setDevice(value as AppDevPreviewDevice)}
          className="app-dev-preview-device-tabs shrink-0"
        >
          <TabsList aria-label="预览设备">
            <TabsTrigger value="desktop" title="桌面视图" aria-label="桌面视图">
              <Monitor className="h-3.5 w-3.5" aria-hidden />
            </TabsTrigger>
            <TabsTrigger value="mobile" title="手机视图" aria-label="手机视图">
              <Smartphone className="h-3.5 w-3.5" aria-hidden />
            </TabsTrigger>
          </TabsList>
        </Tabs>
        <span className="app-dev-preview-device-cluster__divider" aria-hidden />
        <button
          type="button"
          className="app-dev-preview-device-cluster__action"
          onClick={onOpenExternal}
          title="在系统浏览器打开"
          aria-label="在系统浏览器打开"
        >
          <ExternalLink className="h-3.5 w-3.5" aria-hidden />
        </button>
      </div>

      {onToggleInspect || onOpenTune ? (
        <div className="app-dev-preview-mode-toggles">
          {onToggleInspect ? (
            <button
              type="button"
              className={cn(
                'app-dev-preview-mode-toggle',
                inspectActive && 'app-dev-preview-mode-toggle--active',
              )}
              onClick={onToggleInspect}
              aria-pressed={inspectActive}
              title="对话修改"
              aria-label="对话修改"
            >
              <Sparkles className="h-3.5 w-3.5" aria-hidden />
              对话修改
            </button>
          ) : null}
          {onOpenTune ? (
            <button
              type="button"
              className={cn(
                'app-dev-preview-mode-toggle',
                tuneActive && 'app-dev-preview-mode-toggle--active',
              )}
              onClick={onOpenTune}
              aria-pressed={tuneActive}
              title="手动微调"
              aria-label="手动微调"
            >
              <Pencil className="h-3.5 w-3.5" aria-hidden />
              手动微调
            </button>
          ) : null}
        </div>
      ) : null}

      <button
        type="button"
        className="app-plaza-browser-toolbar__nav-btn"
        onClick={toggleFullscreen}
        aria-pressed={fullscreen}
        title={fullscreen ? '退出全屏' : '全屏预览'}
        aria-label={fullscreen ? '退出全屏' : '全屏预览'}
      >
        {fullscreen ? (
          <Minimize className="h-4 w-4" aria-hidden />
        ) : (
          <Maximize className="h-4 w-4" aria-hidden />
        )}
      </button>
    </header>
  );
});
