import { flushSync } from 'react-dom';
import type { NavigateFunction, To } from 'react-router-dom';
import { useChatStore } from '@/stores/chat';
import { findSessionKeyByTitle } from '@/lib/session-label';

export function isMainChatHomePath(pathname: string): boolean {
  return pathname === '/';
}

export interface NavigateToSessionWithPromptOptions {
  /** Target session key; takes precedence over sessionTitle. */
  sessionKey?: string;
  /** Target session title (exact match, case-insensitive). Used when sessionKey is absent or not found locally. */
  sessionTitle?: string;
  /** Create a new session when the target cannot be resolved. Default true. */
  createIfMissing?: boolean;
  /** Extra query params forwarded to Home (e.g. workflowId). */
  extraSearchParams?: Record<string, string>;
  /** Mark this auto-send as a workflow run so Home can choose its execution engine. */
  workflowRun?: boolean;
}

/**
 * Open the main chat surface on home without using `/chat`.
 *
 * Any session-state side effect passed via `beforeNavigate` (e.g. switchSession,
 * newSession) is executed inside the same `flushSync` as the navigate, so React
 * commits both the session update and the route update in one go. This prevents
 * Sidebar from rendering an intermediate frame where `pathname === '/'` but
 * `currentSessionKey` still holds the old/default value, which caused the Home
 * nav item to flash orange briefly.
 */
export function navigateToMainChatHome(
  navigate: NavigateFunction,
  pathname: string,
  beforeNavigate?: () => void,
  search?: string,
): void {
  const target: To = search ? { pathname: '/', search } : '/';

  if (isMainChatHomePath(pathname)) {
    beforeNavigate?.();
    if (search) navigate(target);
    return;
  }

  flushSync(() => {
    beforeNavigate?.();
    navigate(target);
  });
}

function prepareSessionForPrompt(options: NavigateToSessionWithPromptOptions): void {
  const {
    sessionKey,
    sessionTitle,
    createIfMissing = true,
  } = options;

  const {
    sessions,
    sessionLabels,
    sessionLastActivity,
    switchSession,
    newSession,
    renameSession,
  } = useChatStore.getState();

  const trimmedKey = sessionKey?.trim();
  if (trimmedKey) {
    const existsLocally = sessions.some((session) => session.key === trimmedKey);
    if (existsLocally) {
      switchSession(trimmedKey);
      return;
    }
    if (!createIfMissing) {
      switchSession(trimmedKey);
      return;
    }
    // Cannot mint a backend session with an arbitrary key — fall through to title / new session.
  }

  const trimmedTitle = sessionTitle?.trim();
  if (trimmedTitle) {
    const foundKey = findSessionKeyByTitle(trimmedTitle, sessions, sessionLabels, sessionLastActivity);
    if (foundKey) {
      switchSession(foundKey);
      return;
    }
    if (createIfMissing) {
      newSession();
      renameSession(useChatStore.getState().currentSessionKey, trimmedTitle);
      return;
    }
  }

  if (createIfMissing) {
    newSession();
  }
}

function normalizePromptNavigationOptions(
  options?: NavigateToSessionWithPromptOptions | Record<string, string>,
  defaults: NavigateToSessionWithPromptOptions = {},
): NavigateToSessionWithPromptOptions {
  if (!options) return defaults;
  const isLegacyExtraSearchParamsOnly =
    !('sessionKey' in options)
    && !('sessionTitle' in options)
    && !('createIfMissing' in options)
    && !('extraSearchParams' in options)
    && !('workflowRun' in options);
  if (isLegacyExtraSearchParamsOnly) {
    return { ...defaults, extraSearchParams: options as Record<string, string> };
  }
  return { ...defaults, ...(options as NavigateToSessionWithPromptOptions) };
}

/**
 * Switch to (or create) a target session, open home, and seed auto-send via `?q=` (handled by Home).
 *
 * Resolution order:
 * 1. `sessionKey` — switch when present in the local session list; otherwise switch anyway if
 *    `createIfMissing` is false (backend-only session), or create a new session when true.
 * 2. `sessionTitle` — exact case-insensitive match on label / displayName / local preview title;
 *    creates a new session with that label when not found and `createIfMissing` is true.
 * 3. Neither — creates a new session when `createIfMissing` is true.
 */
export function navigateToSessionWithPrompt(
  navigate: NavigateFunction,
  pathname: string,
  prompt: string,
  options?: NavigateToSessionWithPromptOptions | Record<string, string>,
): void {
  const normalized = normalizePromptNavigationOptions(options);
  const { extraSearchParams, workflowRun, ...sessionOptions } = normalized;
  const params = new URLSearchParams({
    q: prompt,
    ...extraSearchParams,
    ...(workflowRun ? { workflowRun: '1' } : {}),
  });
  navigateToMainChatHome(
    navigate,
    pathname,
    () => prepareSessionForPrompt(sessionOptions),
    `?${params.toString()}`,
  );
}

/**
 * Open home and auto-send via `?q=`.
 * Supports the same session resolution options as `navigateToSessionWithPrompt`;
 * defaults `createIfMissing` to true (always creates when no target is found).
 *
 * Legacy: 4th arg may still be a plain `Record<string, string>` treated as `extraSearchParams`.
 */
export function navigateToNewSessionWithPrompt(
  navigate: NavigateFunction,
  pathname: string,
  prompt: string,
  options?: NavigateToSessionWithPromptOptions | Record<string, string>,
): void {
  navigateToSessionWithPrompt(
    navigate,
    pathname,
    prompt,
    normalizePromptNavigationOptions(options, { createIfMissing: true }),
  );
}
