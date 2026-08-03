import { useChatStore } from '@/stores/chat';

/** Opens a workflow result from either an in-app or OS notification. */
export function openWorkflowResult(sessionKey: string, runId: string): void {
  const chat = useChatStore.getState();
  if (sessionKey && chat.currentSessionKey !== sessionKey) chat.switchSession(sessionKey);

  // History and card hydration are async. Retry briefly so the destination card
  // can be found after the session switch without coupling this helper to page state.
  let attempts = 0;
  const focusCard = () => {
    const card = document.getElementById(`workflow-card-${runId}`);
    if (card) {
      card.scrollIntoView({ behavior: 'smooth', block: 'center' });
      card.focus({ preventScroll: true });
      return;
    }
    attempts += 1;
    if (attempts < 10) window.setTimeout(focusCard, 250);
  };
  window.setTimeout(focusCard, 0);
}
