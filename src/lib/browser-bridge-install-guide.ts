const INSTALL_GUIDE_EVENT = 'sclaw-web-bridge-install-guide';

export function requestBrowserBridgeInstallGuide(): void {
  window.dispatchEvent(new Event(INSTALL_GUIDE_EVENT));
}

export function subscribeBrowserBridgeInstallGuide(handler: () => void): () => void {
  window.addEventListener(INSTALL_GUIDE_EVENT, handler);
  return () => window.removeEventListener(INSTALL_GUIDE_EVENT, handler);
}
