export function scheduleMemoryCaptureRetry(
  delayMs: number,
  markReady: () => Promise<void>,
  retry: () => void,
  onError: (error: unknown) => void,
): ReturnType<typeof setTimeout> {
  const timer = setTimeout(() => {
    void markReady().then(retry).catch(onError);
  }, delayMs);
  timer.unref?.();
  return timer;
}
