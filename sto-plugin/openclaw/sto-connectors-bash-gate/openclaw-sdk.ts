export function requireOpenClawPluginSdk<T>(subpath: string): T {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require(`openclaw/plugin-sdk/${subpath}`) as T;
}
