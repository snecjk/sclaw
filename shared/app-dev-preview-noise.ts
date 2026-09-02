/**
 * Preview / Vite noise that must not be treated as app bugs for the workbench agent.
 * Shared by renderer console capture and the Electron dev-server log buffer.
 */

const VITE_HMR_LINE_RE =
  /\[vite\]\s*(hmr\b|page reload|hot updated|connecting|connected)/i;

const LOCAL_VITE_MODULE_PATH_RE =
  /^\/(@vite|@fs\/|@id\/|@react-refresh|node_modules\/|src\/|frontend\/src\/)/i;

const LOCAL_SOURCE_FILE_RE =
  /\.(tsx?|jsx?|mjs|cjs|css|scss|sass|less|vue|svelte|map)$/i;

export function isViteHmrLogLine(line: string): boolean {
  const text = line.trim();
  if (!text) return false;
  return VITE_HMR_LINE_RE.test(text);
}

export function isLocalViteModuleUrl(url: string): boolean {
  const raw = url.trim();
  if (!raw) return false;
  try {
    const parsed = new URL(raw, 'http://127.0.0.1');
    const host = parsed.hostname;
    if (host !== '127.0.0.1' && host !== 'localhost') return false;
    const path = parsed.pathname;
    return LOCAL_VITE_MODULE_PATH_RE.test(path) || LOCAL_SOURCE_FILE_RE.test(path);
  } catch {
    return false;
  }
}

export function isSclawPreviewNetworkViteNoise(message: string): boolean {
  const match = message.match(/\[sclaw-preview-network\]\s*(\{[\s\S]*\})\s*$/i);
  if (!match?.[1]) return false;
  try {
    const payload = JSON.parse(match[1]) as { url?: unknown };
    return typeof payload.url === 'string' && isLocalViteModuleUrl(payload.url);
  } catch {
    return false;
  }
}

/** Dev-server stdout/stderr lines worth draining into the agent repair loop. */
export function isDevServerRepairWorthyLine(line: string): boolean {
  const text = line.trim();
  if (!text) return false;
  if (isViteHmrLogLine(text)) return false;
  return /error|failed to compile|internal server error/i.test(text);
}
