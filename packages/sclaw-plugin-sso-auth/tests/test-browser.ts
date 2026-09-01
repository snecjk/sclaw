import type { SsoBrowserPlatform } from '../src/browser-platform';

export class TestBrowserPlatform implements SsoBrowserPlatform {
  href: string;
  protocol: string;
  cookie = '';
  readonly cookieWrites: string[] = [];
  readonly replacedUrls: string[] = [];
  readonly redirects: string[] = [];
  readonly local = new Map<string, string>();
  readonly session = new Map<string, string>();

  constructor(href = 'https://page.sto.cn/app') {
    this.href = href;
    this.protocol = new URL(href).protocol;
  }

  setCookie(value: string): void {
    this.cookieWrites.push(value);
    const [pair, ...attributes] = value.split(';').map((item) => item.trim());
    const [name, rawValue] = pair!.split('=');
    const maxAge = attributes.find((item) => item.toLowerCase().startsWith('max-age='));
    const cookies = new Map(
      this.cookie
        .split(';')
        .map((item) => item.trim())
        .filter(Boolean)
        .map((item) => item.split('=', 2) as [string, string]),
    );
    if (maxAge === 'Max-Age=0') cookies.delete(name!);
    else cookies.set(name!, rawValue ?? '');
    this.cookie = [...cookies].map(([key, item]) => `${key}=${item}`).join('; ');
  }

  replaceUrl(value: string): void {
    this.replacedUrls.push(value);
    this.href = new URL(value, this.href).toString();
  }

  redirect(value: string): void {
    this.redirects.push(value);
  }

  getLocalStorage(key: string): string | null {
    return this.local.get(key) ?? null;
  }

  setLocalStorage(key: string, value: string): void {
    this.local.set(key, value);
  }

  removeLocalStorage(key: string): void {
    this.local.delete(key);
  }

  getSessionStorage(key: string): string | null {
    return this.session.get(key) ?? null;
  }

  setSessionStorage(key: string, value: string): void {
    this.session.set(key, value);
  }

  removeSessionStorage(key: string): void {
    this.session.delete(key);
  }
}
