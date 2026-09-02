export function isAuxiliaryWindowPath(pathname: string): boolean {
  return pathname === '/sprite'
    || pathname.startsWith('/sprite/')
    || pathname === '/float-icon'
    || pathname.startsWith('/float-icon/')
    || pathname.startsWith('/app-dev-ide');
}
