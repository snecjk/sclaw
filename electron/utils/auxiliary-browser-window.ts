/** Hash routes used by sprite / float-icon / IDE — must not be shown for in-app consent. */
export function isAuxiliaryBrowserWindowUrl(url: string): boolean {
  const hashMatch = /#([^?]*)/.exec(url);
  const path = (hashMatch?.[1] || '').split('?')[0];
  return path === '/sprite'
    || path.startsWith('/sprite/')
    || path === '/float-icon'
    || path.startsWith('/float-icon/')
    || path.startsWith('/app-dev-ide');
}
