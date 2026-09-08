import type { SclawExtensionState, SclawStateScope } from './types';

class MapStateScope implements SclawStateScope {
  constructor(private readonly values: Map<string, unknown>) {}

  get<T>(key: string): T | undefined {
    return this.values.get(key) as T | undefined;
  }

  set<T>(key: string, value: T): void {
    this.values.set(key, value);
  }

  getOrCreate<T>(key: string, create: () => T): T {
    if (!this.values.has(key)) this.values.set(key, create());
    return this.values.get(key) as T;
  }

  delete(key: string): void {
    this.values.delete(key);
  }

  clear(): void {
    this.values.clear();
  }
}

type SessionState = {
  session: Map<string, Map<string, unknown>>;
  turn: Map<string, Map<string, unknown>>;
  toolCalls: Map<string, Map<string, Map<string, unknown>>>;
};

function extensionMap(
  scopes: Map<string, Map<string, unknown>>,
  extensionId: string,
): Map<string, unknown> {
  let scope = scopes.get(extensionId);
  if (!scope) {
    scope = new Map();
    scopes.set(extensionId, scope);
  }
  return scope;
}

export class SclawExtensionStateManager {
  private readonly sessions = new Map<string, SessionState>();

  private getSession(sessionKey: string): SessionState {
    let state = this.sessions.get(sessionKey);
    if (!state) {
      state = { session: new Map(), turn: new Map(), toolCalls: new Map() };
      this.sessions.set(sessionKey, state);
    }
    return state;
  }

  beginTurn(sessionKey: string): void {
    const state = this.getSession(sessionKey);
    state.turn.clear();
    state.toolCalls.clear();
  }

  endTurn(sessionKey: string): void {
    const state = this.sessions.get(sessionKey);
    if (!state) return;
    state.turn.clear();
    state.toolCalls.clear();
  }

  completeToolCall(sessionKey: string, toolCallId: string): void {
    this.sessions.get(sessionKey)?.toolCalls.delete(toolCallId);
  }

  clearSession(sessionKey: string): void {
    this.sessions.delete(sessionKey);
  }

  forExtension(sessionKey: string, extensionId: string): SclawExtensionState {
    const state = this.getSession(sessionKey);
    return {
      session: new MapStateScope(extensionMap(state.session, extensionId)),
      turn: new MapStateScope(extensionMap(state.turn, extensionId)),
      toolCall: (toolCallId) => {
        let callScopes = state.toolCalls.get(toolCallId);
        if (!callScopes) {
          callScopes = new Map();
          state.toolCalls.set(toolCallId, callScopes);
        }
        return new MapStateScope(extensionMap(callScopes, extensionId));
      },
    };
  }
}
