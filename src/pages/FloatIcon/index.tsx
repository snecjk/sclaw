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

  // Make body transparent
  useEffect(() => {
    document.body.style.background = 'transparent';
    document.documentElement.style.background = 'transparent';
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
      className="w-[56px] h-[56px] rounded-full flex items-center justify-center cursor-pointer select-none
        border border-glass-border shadow-glass glass-subtle
        hover:scale-105 active:scale-95 transition-transform duration-150"
      style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
    >
      <img
        src={logoSvg}
        alt="StoClaw"
        className="w-9 h-9 pointer-events-none"
        draggable={false}
      />
    </div>
  );
}

export default FloatIcon;
