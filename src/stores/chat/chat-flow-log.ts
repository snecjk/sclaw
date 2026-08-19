export function logChatFlow(stage: string, data?: Record<string, unknown>): void {
  console.info('[chat-flow]', stage, {
    at: new Date().toISOString(),
    ...(data ?? {}),
  });
}
