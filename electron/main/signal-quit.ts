export interface SignalQuitHandlerHooks {
  logInfo: (message: string) => void;
  requestQuit: () => void;
  /** Defaults to process.exit when quit cleanup stalls (OpenIM native SDK, etc.). */
  forceExit?: (code?: number) => void;
  /** Delay before forceExit after the first signal. */
  forceExitDelayMs?: number;
}

export function createSignalQuitHandler(hooks: SignalQuitHandlerHooks): (signal: NodeJS.Signals) => void {
  const forceExit = hooks.forceExit ?? ((code = 0) => process.exit(code));
  const forceExitDelayMs = hooks.forceExitDelayMs ?? 3500;
  let signalCount = 0;

  return (signal: NodeJS.Signals) => {
    signalCount += 1;
    if (signalCount >= 2) {
      hooks.logInfo(`Received ${signal} again; forcing immediate exit`);
      forceExit(signal === 'SIGINT' ? 130 : 0);
      return;
    }

    hooks.logInfo(`Received ${signal}; requesting app quit`);
    hooks.requestQuit();

    setTimeout(() => {
      hooks.logInfo(`Quit stalled after ${signal}; forcing process exit`);
      forceExit(0);
    }, forceExitDelayMs).unref();
  };
}
