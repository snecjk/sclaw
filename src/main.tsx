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

initializeDefaultTransports();

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
