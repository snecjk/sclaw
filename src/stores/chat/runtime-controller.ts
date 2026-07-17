import {
  getSessionRuntimeState,
  patchSessionRuntimeState,
} from './session-runtime';
import type { ChatGet, ChatSet } from './store-api';
import type { ChatState, SessionRuntimeState } from './types';

export function getCurrentRuntime(state: ChatState): SessionRuntimeState {
  return getSessionRuntimeState(state.runtimeBySessionKey, state.currentSessionKey);
}

export function applyRuntimePatch(
  state: ChatState,
  sessionKey: string,
  patch: Partial<SessionRuntimeState> | ((runtime: SessionRuntimeState) => Partial<SessionRuntimeState>),
): Partial<ChatState> {
  return patchSessionRuntimeState(state, sessionKey, patch);
}

export function setRuntimePatch(
  set: ChatSet,
  sessionKey: string,
  patch: Partial<SessionRuntimeState> | ((runtime: SessionRuntimeState) => Partial<SessionRuntimeState>),
): void {
  set((state) => applyRuntimePatch(state, sessionKey, patch));
}

export function setCurrentRuntimePatch(
  set: ChatSet,
  get: ChatGet,
  patch: Partial<SessionRuntimeState> | ((runtime: SessionRuntimeState) => Partial<SessionRuntimeState>),
): void {
  setRuntimePatch(set, get().currentSessionKey, patch);
}
