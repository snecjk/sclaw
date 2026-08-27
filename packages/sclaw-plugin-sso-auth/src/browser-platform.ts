export interface SsoBrowserPlatform {
  readonly href: string;
  readonly protocol: string;
  readonly cookie: string;
  setCookie(value: string): void;
  replaceUrl(pathAndQueryAndHash: string): void;
  redirect(url: string): void;
  getLocalStorage(key: string): string | null;
  setLocalStorage(key: string, value: string): void;
  removeLocalStorage(key: string): void;
  getSessionStorage(key: string): string | null;
  setSessionStorage(key: string, value: string): void;
  removeSessionStorage(key: string): void;
}

export function createBrowserPlatform(): SsoBrowserPlatform {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    throw new Error('SSO Auth browser platform is unavailable');
  }

  return {
    get href() {
      return window.location.href;
    },
    get protocol() {
      return window.location.protocol;
    },
    get cookie() {
      return document.cookie;
    },
    setCookie(value) {
      document.cookie = value;
    },
    replaceUrl(value) {
      window.history.replaceState(window.history.state, '', value);
    },
    redirect(value) {
      window.location.replace(value);
    },
    getLocalStorage(key) {
      return window.localStorage.getItem(key);
    },
    setLocalStorage(key, value) {
      window.localStorage.setItem(key, value);
    },
    removeLocalStorage(key) {
      window.localStorage.removeItem(key);
    },
    getSessionStorage(key) {
      return window.sessionStorage.getItem(key);
    },
    setSessionStorage(key, value) {
      window.sessionStorage.setItem(key, value);
    },
    removeSessionStorage(key) {
      window.sessionStorage.removeItem(key);
    },
  };
}
