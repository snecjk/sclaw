/**
 * Single dispatch point for the action returned by `case-template/use`.
 *
 * Every learning case target is mapped here instead of inside the case UI so
 * the whitelist stays exhaustive and testable. Nothing is guessed: a target we
 * cannot open with an existing sto-claw entry point stops the dispatch and
 * reports a reason the caller turns into user-visible feedback.
 *
 * Entry points reused (no new routes are introduced):
 * - SKILL     → home composer skill chip (homepage recommend reuse)
 * - CONNECTOR → `/skills?section=connectors` (plaza section; no per-connector deep link exists)
 * - APP       → `/more-apps` (App Plaza; no per-app deep link exists)
 * - WORKFLOW  → home composer workflow chip (homepage recommend reuse)
 * - URL       → host `openExternal` bridge, http(s) only
 * - CHAT      → main chat composer draft
 *
 * CONNECTOR and APP are deliberate degradations: sto-claw can only open the
 * plaza, so `targetCode` is validated but the user still picks the item there.
 * Prompt text is only written into the composer for targets that land on the
 * chat surface (CHAT, SKILL, WORKFLOW); other targets never touch the draft.
 */
import type { NavigateFunction } from 'react-router-dom';
import type { MainChatDraftMode } from '@/lib/main-chat-composer-draft';
import {
  navigateToMainChatWithComposerHandoff,
  navigateToMainChatWithDraft,
} from '@/lib/main-chat-navigation';
import { openExternalUrl } from '@/lib/preview-url';
import type { LearningCaseAction } from '@/types/learning-center';
import { SKILL_PLAZA_CONNECTORS_PATH } from '../../shared/connectors/deep-link';

export type LearningCaseActionFailureReason =
  /** targetType outside the whitelist (including UNKNOWN). */
  | 'UNSUPPORTED_TARGET'
  /** targetType needs a stable code to locate the target but none was returned. */
  | 'MISSING_TARGET_CODE'
  /** targetUrl is empty or not an http(s) address. */
  | 'INVALID_TARGET_URL'
  /** A prompt was returned with a promptMode outside REPLACE/APPEND. */
  | 'UNSUPPORTED_PROMPT_MODE'
  /** A CHAT action carries no prompt, so there is nothing to seed. */
  | 'MISSING_PROMPT'
  /** The host capability required by this target is not available. */
  | 'TARGET_UNAVAILABLE';

export interface LearningCaseActionResult {
  ok: boolean;
  reason?: LearningCaseActionFailureReason;
  /** In-app route that was opened. */
  navigatedTo?: string;
  /** External address handed to the host browser bridge. */
  openedUrl?: string;
  /** Whether the returned prompt was written into the chat composer draft. */
  draftApplied?: boolean;
}

export interface LearningCaseActionContext {
  navigate: NavigateFunction;
  /** Case card title is never used as the chip label; caller must pass the selected skill/workflow name. */
  displayTitle?: string;
}

const APP_PLAZA_PATH = '/more-apps';

function fail(reason: LearningCaseActionFailureReason): LearningCaseActionResult {
  return { ok: false, reason };
}

function isSafeHttpUrl(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return false;
  try {
    const protocol = new URL(trimmed).protocol;
    return protocol === 'http:' || protocol === 'https:';
  } catch {
    return false;
  }
}

function openRoute(context: LearningCaseActionContext, path: string): LearningCaseActionResult {
  context.navigate(path);
  return { ok: true, navigatedTo: path, draftApplied: false };
}

export function dispatchLearningCaseAction(
  action: LearningCaseAction,
  context: LearningCaseActionContext,
): LearningCaseActionResult {
  const targetCode = action.targetCode.trim();
  const prompt = action.promptText?.trim() ?? '';

  // Validate everything before touching navigation so a rejected action leaves
  // the route, the composer and the case list untouched.
  let promptMode: MainChatDraftMode = 'REPLACE';
  if (prompt) {
    if (action.promptMode !== 'REPLACE' && action.promptMode !== 'APPEND') {
      return fail('UNSUPPORTED_PROMPT_MODE');
    }
    promptMode = action.promptMode;
  }

  switch (action.targetType) {
    case 'CHAT': {
      if (!prompt) return fail('MISSING_PROMPT');
      const applied = navigateToMainChatWithDraft(context.navigate, prompt, { mode: promptMode });
      return applied ? { ok: true, navigatedTo: '/', draftApplied: true } : fail('TARGET_UNAVAILABLE');
    }

    case 'SKILL': {
      if (!targetCode) return fail('MISSING_TARGET_CODE');
      const title = context.displayTitle?.trim() || targetCode;
      const applied = navigateToMainChatWithComposerHandoff(context.navigate, {
        skill: { slug: targetCode, title },
        ...(prompt ? { suffixText: prompt } : {}),
      });
      return applied ? { ok: true, navigatedTo: '/', draftApplied: true } : fail('TARGET_UNAVAILABLE');
    }

    case 'CONNECTOR':
      if (!targetCode) return fail('MISSING_TARGET_CODE');
      return openRoute(context, SKILL_PLAZA_CONNECTORS_PATH);

    case 'APP':
      if (!targetCode) return fail('MISSING_TARGET_CODE');
      return openRoute(context, APP_PLAZA_PATH);

    case 'WORKFLOW': {
      if (!targetCode) return fail('MISSING_TARGET_CODE');
      const title = context.displayTitle?.trim() || targetCode;
      const applied = navigateToMainChatWithComposerHandoff(context.navigate, {
        workflow: { id: targetCode, name: title, source: 'template' },
        ...(prompt ? { suffixText: prompt } : {}),
      });
      return applied ? { ok: true, navigatedTo: '/', draftApplied: true } : fail('TARGET_UNAVAILABLE');
    }

    case 'URL': {
      const url = action.targetUrl.trim();
      if (!isSafeHttpUrl(url)) return fail('INVALID_TARGET_URL');
      if (!window.electron?.openExternal) return fail('TARGET_UNAVAILABLE');
      openExternalUrl(url);
      return { ok: true, openedUrl: url, draftApplied: false };
    }

    default:
      return fail('UNSUPPORTED_TARGET');
  }
}
