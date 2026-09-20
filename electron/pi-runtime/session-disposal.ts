import type {
  AgentSession,
  SessionShutdownEvent,
} from '@earendil-works/pi-coding-agent';

export type PiSessionDisposalStage =
  | 'session_shutdown'
  | 'unsubscribe'
  | 'session_dispose'
  | 'extension_state_clear';

export type PiSessionDisposalFailure = {
  stage: PiSessionDisposalStage;
  error: unknown;
};

export type PiSessionDisposalTarget = {
  session: Pick<AgentSession, 'dispose' | 'extensionRunner' | 'hasExtensionHandlers'>;
  unsubscribe: () => void;
  clearExtensionSessionState: () => void;
};

export type PiSessionDisposalResult = {
  shutdownEmitted: boolean;
  failures: PiSessionDisposalFailure[];
};

/**
 * Gracefully tears down a Pi session and all extension-owned resources.
 *
 * Cleanup is best-effort by design: a failing extension handler must not stop
 * the AgentSession and framework state from being released. Callers receive
 * every failure for structured diagnostics.
 */
export async function disposePiSession(
  target: PiSessionDisposalTarget,
  event: SessionShutdownEvent,
): Promise<PiSessionDisposalResult> {
  const failures: PiSessionDisposalFailure[] = [];
  let shutdownEmitted = false;

  try {
    if (target.session.hasExtensionHandlers('session_shutdown')) {
      shutdownEmitted = true;
      await target.session.extensionRunner.emit(event);
    }
  } catch (error) {
    failures.push({ stage: 'session_shutdown', error });
  }

  const cleanup = (
    stage: Exclude<PiSessionDisposalStage, 'session_shutdown'>,
    action: () => void,
  ) => {
    try {
      action();
    } catch (error) {
      failures.push({ stage, error });
    }
  };

  cleanup('unsubscribe', target.unsubscribe);
  cleanup('session_dispose', () => target.session.dispose());
  if (event.reason !== 'reload') {
    cleanup('extension_state_clear', target.clearExtensionSessionState);
  }

  return { shutdownEmitted, failures };
}
