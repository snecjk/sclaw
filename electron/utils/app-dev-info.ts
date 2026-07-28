/**
 * Pure helpers for user app creation and the setup pipeline
 * (capabilities: app-create-scaffold / service-dev-server). No Electron deps.
 */

export type AppDevPhase =
  | 'created'        // scaffold done, pipeline not started
  | 'preparing-env'  // managed Node runtime downloading
  | 'installing'     // npm install running
  | 'starting'       // dev server spawning / probing
  | 'ready'          // preview reachable
  | 'stopped'        // dev server not running (installed)
  | 'error';

/**
 * Map a phase (plus intra-phase ratio 0..1) onto one continuous 0-100 progress
 * bar so the user sees a single smooth progression instead of separate
 * technical steps (UX requirement: one continuous progress indication).
 */
export function pipelineProgress(phase: AppDevPhase, ratio: number): number {
  const clamped = Math.min(1, Math.max(0, ratio));
  switch (phase) {
    case 'created':
      return 0;
    case 'preparing-env':
      return Math.round(clamped * 35);
    case 'installing':
      return Math.round(35 + clamped * 45);
    case 'starting':
      return Math.round(80 + clamped * 19);
    case 'ready':
      return 100;
    case 'stopped':
    case 'error':
      return 0;
  }
}

/** Derive an npm-safe package name from a user-facing app name. */
export function sanitizePackageName(appName: string): string {
  const normalized = appName
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
  return normalized || 'sclaw-app';
}

/** Text file extensions that go through template variable substitution. */
const TEXT_EXTENSIONS = new Set([
  '.json', '.html', '.md', '.ts', '.tsx', '.css', '.js', '.jsx', '.txt', '.npmrc', '.gitignore',
  '.yaml', '.yml',
]);

export function isTemplateTextFile(fileName: string): boolean {
  const dot = fileName.lastIndexOf('.');
  const ext = dot >= 0 ? fileName.slice(dot) : fileName;
  // dotfiles like .npmrc / .gitignore have the "extension" equal to the name
  return TEXT_EXTENSIONS.has(ext) || TEXT_EXTENSIONS.has(fileName);
}

/** Apply template variables to file content. */
export function substituteTemplateVars(
  content: string,
  vars: { appName: string; appTitle: string },
): string {
  return content
    .replaceAll('__APP_NAME__', vars.appName)
    .replaceAll('__APP_TITLE__', vars.appTitle);
}

/**
 * Synthetic creeping progress for phases without deterministic progress
 * (npm install): approach 1.0 asymptotically as activity events arrive so the
 * bar keeps moving without ever completing prematurely.
 */
export function creepRatio(previous: number, step = 0.06): number {
  return Math.min(0.98, previous + (1 - previous) * step);
}
