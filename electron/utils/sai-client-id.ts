/** Stable product client id injected into every sai-cli child process. */
export const SAI_CLIENT_ID_VALUE = 'sto-claw';

/** Apply to a process env map (mutates and returns the same object). */
export function applySaiClientIdEnv<T extends Record<string, string | undefined>>(env: T): T {
  env.SAI_CLIENT_ID = SAI_CLIENT_ID_VALUE;
  return env;
}
