/** Scrolls to and briefly highlights a chat message after notification navigation. */
export function focusChatMessage(messageId: string): void {
  const targetId = messageId.trim();
  if (!targetId) return;

  let attempts = 0;
  const focus = () => {
    const target = Array.from(document.querySelectorAll<HTMLElement>('[data-chat-message-id]'))
      .find((element) => element.dataset.chatMessageId === targetId);
    if (target) {
      target.scrollIntoView({ behavior: 'smooth', block: 'center' });
      target.animate(
        [
          { boxShadow: '0 0 0 0 rgba(255, 111, 0, 0)' },
          { boxShadow: '0 0 0 4px rgba(255, 111, 0, 0.28)' },
          { boxShadow: '0 0 0 0 rgba(255, 111, 0, 0)' },
        ],
        { duration: 1_400, easing: 'ease-out' },
      );
      return;
    }
    attempts += 1;
    if (attempts < 20) window.setTimeout(focus, 250);
  };
  window.setTimeout(focus, 0);
}
