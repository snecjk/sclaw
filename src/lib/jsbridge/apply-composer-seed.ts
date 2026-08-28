import { CHAT_EDIT_DRAFT_EVENT, type ChatEditDraftEventDetail } from '@/components/input-composer/use-input-composer-edit-draft';
import type { ComposerSeedEntry } from '@/stores/jsbridge-host';

/** True when a JSBridge seed should be applied as skill/workflow chips, not plain text. */
export function shouldApplyJsBridgeStructuredComposerSeed(
  seed: ComposerSeedEntry | null | undefined,
): boolean {
  if (!seed || seed.send) return false;
  return Boolean(seed.segments?.some((seg) => seg.type === 'skill' || seg.type === 'workflow'));
}

/** Replay structured composer fill through the same path homepage recommend cards use. */
export function dispatchJsBridgeStructuredComposerSeed(
  seed: ComposerSeedEntry | null | undefined,
): void {
  if (!shouldApplyJsBridgeStructuredComposerSeed(seed) || !seed?.segments?.length) return;
  window.dispatchEvent(new CustomEvent<ChatEditDraftEventDetail>(CHAT_EDIT_DRAFT_EVENT, {
    detail: {
      segments: seed.segments,
      text: seed.text,
    },
  }));
}
