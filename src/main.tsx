/**
 * React Application Entry Point
 */
import React from 'react';
import ReactDOM from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import App from './App';
import './i18n';
import './styles/globals.css';
import { initializeDefaultTransports } from './lib/api-client';
import { applyScrollbarLayoutAttribute } from './lib/scrollbar-layout';

initializeDefaultTransports();

const resolveAppPlatform = (): string => {
  const fromElectron = window.electron?.platform?.trim();
  if (fromElectron) return fromElectron;
  const nav = navigator.platform.toLowerCase();
  if (nav.includes('mac')) return 'darwin';
  if (nav.includes('win')) return 'win32';
  return 'linux';
};

document.documentElement.setAttribute('data-platform', resolveAppPlatform());
applyScrollbarLayoutAttribute();

// 桌面悬浮图标窗口极小：在 React 绘制前去掉 splash / 锁定溢出，避免 WebKit 出现滚动条
const hashPath = window.location.hash.replace(/^#/, '').split('?')[0] ?? '';
if (hashPath === '/float-icon') {
  document.documentElement.style.overflow = 'hidden';
  document.documentElement.style.minHeight = '0';
  document.body.style.overflow = 'hidden';
  document.body.style.minHeight = '0';
  const splash = document.getElementById('splash-screen');
  if (splash) splash.classList.add('hidden');
}

// Track when splash was first shown
const splashStartTime = Date.now();
const MIN_SPLASH_DISPLAY_MS = 800; // Minimum time to show splash screen

// Hide splash screen with minimum display time
function hideSplashScreen() {
  const splash = document.getElementById('splash-screen');
  if (!splash) return;
  
  const elapsed = Date.now() - splashStartTime;
  const remainingTime = Math.max(0, MIN_SPLASH_DISPLAY_MS - elapsed);
  
  // Wait for minimum display time before hiding
  setTimeout(() => {
    splash.classList.add('fade-out');
    setTimeout(() => {
      splash.classList.add('hidden');
    }, 300);
  }, remainingTime);
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <HashRouter>
      <App />
    </HashRouter>
  </React.StrictMode>,
);

// Hide splash after React hydrates the root
// Double requestAnimationFrame ensures paint is complete
requestAnimationFrame(() => {
  requestAnimationFrame(() => {
    hideSplashScreen();
  });
});
