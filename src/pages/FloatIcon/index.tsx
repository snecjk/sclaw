/**
 * FloatIcon - Desktop Floating Icon Component (桌面悬浮图标)
 * A small circular logo that floats on the desktop.
 * Click toggles the sprite assistant; drag moves the icon.
 */
import { useEffect, useRef, useCallback } from 'react';
import logoSvg from '@/assets/logo.svg';
import { useSettingsStore } from '@/stores/settings';
import { invokeIpc } from '@/lib/api-client';
import i18n from '@/i18n';

export function FloatIcon() {
  const initSettings = useSettingsStore((s) => s.init);
  const theme = useSettingsStore((s) => s.theme);
  const language = useSettingsStore((s) => s.language);

  const dragRef = useRef<{
    startX: number;
    startY: number;
    winX: number;
    winY: number;
    time: number;
    dragging: boolean;
  } | null>(null);

  // Init settings for theme
  useEffect(() => {
    initSettings();
  }, [initSettings]);

  useEffect(() => {
    if (language && language !== i18n.language) {
      i18n.changeLanguage(language);
    }
  }, [language]);

  // Apply theme
  useEffect(() => {
    const root = window.document.documentElement;
    root.classList.remove('light', 'dark');
    if (theme === 'system') {
      const systemTheme = window.matchMedia('(prefers-color-scheme: dark)').matches
        ? 'dark'
        : 'light';
      root.classList.add(systemTheme);
    } else {
      root.classList.add(theme);
    }
  }, [theme]);

  // 悬浮窗仅 56×56：锁定文档尺寸并禁止滚动（避免 macOS 出现滚动条）
  useEffect(() => {
    document.body.style.background = 'transparent';
    document.documentElement.style.background = 'transparent';

    const html = document.documentElement;
    const body = document.body;
    const root = document.getElementById('root');

    type Snap = { overflow: string; minHeight: string; height: string; width: string };
    const snap = (el: HTMLElement): Snap => ({
      overflow: el.style.overflow,
      minHeight: el.style.minHeight,
      height: el.style.height,
      width: el.style.width,
    });
    const prevHtml = snap(html);
    const prevBody = snap(body);
    const prevRoot = root ? snap(root) : null;

    const lock = (el: HTMLElement) => {
      el.style.overflow = 'hidden';
      el.style.minHeight = '0';
      el.style.height = '100%';
      el.style.width = '100%';
    };
    html.style.margin = '0';
    html.style.padding = '0';
    body.style.margin = '0';
    body.style.padding = '0';
    lock(html);
    lock(body);
    if (root) {
      lock(root);
      root.style.display = 'flex';
      root.style.alignItems = 'center';
      root.style.justifyContent = 'center';
      root.style.boxSizing = 'border-box';
    }

    return () => {
      const restore = (el: HTMLElement, p: Snap) => {
        el.style.overflow = p.overflow;
        el.style.minHeight = p.minHeight;
        el.style.height = p.height;
        el.style.width = p.width;
      };
      restore(html, prevHtml);
      restore(body, prevBody);
      html.style.margin = '';
      html.style.padding = '';
      body.style.margin = '';
      body.style.padding = '';
      if (root && prevRoot) {
        restore(root, prevRoot);
        root.style.display = '';
        root.style.alignItems = '';
        root.style.justifyContent = '';
        root.style.boxSizing = '';
      }
    };
  }, []);

  const handleMouseDown = useCallback(async (e: React.MouseEvent) => {
    e.preventDefault();
    const pos = await invokeIpc<{ x: number; y: number }>('floaticon:getPosition');
    dragRef.current = {
      startX: e.screenX,
      startY: e.screenY,
      winX: pos.x,
      winY: pos.y,
      time: Date.now(),
      dragging: false,
    };

    const handleMouseMove = (ev: MouseEvent) => {
      if (!dragRef.current) return;
      const dx = ev.screenX - dragRef.current.startX;
      const dy = ev.screenY - dragRef.current.startY;
      if (!dragRef.current.dragging && dx * dx + dy * dy > 25) {
        dragRef.current.dragging = true;
      }
      if (dragRef.current.dragging) {
        invokeIpc(
          'floaticon:setPosition',
          dragRef.current.winX + dx,
          dragRef.current.winY + dy,
        );
      }
    };

    const handleMouseUp = (ev: MouseEvent) => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      if (!dragRef.current) return;
      const dx = ev.screenX - dragRef.current.startX;
      const dy = ev.screenY - dragRef.current.startY;
      const dt = Date.now() - dragRef.current.time;
      // Click: small movement + short duration
      if (dx * dx + dy * dy < 25 && dt < 300) {
        invokeIpc('floaticon:toggleSprite');
      }
      dragRef.current = null;
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  }, []);

  return (
    <div
      onMouseDown={handleMouseDown}
      className="box-border h-[56px] w-[56px] shrink-0 cursor-pointer select-none overflow-hidden rounded-full border border-glass-border shadow-glass glass-subtle"
      style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
    >
      <div className="flex h-full w-full items-center justify-center transition-transform duration-150 hover:scale-105 active:scale-95">
        <img
          src={logoSvg}
          alt="StoClaw"
          className="pointer-events-none max-h-[68%] max-w-[68%] object-contain"
          width={38}
          height={38}
          draggable={false}
        />
      </div>
    </div>
  );
}

export default FloatIcon;
