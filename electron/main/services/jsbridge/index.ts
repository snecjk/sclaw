export { createBridgeSession, destroyBridgeSession, destroyBridgeSessionsForRuntime, destroyAllBridgeSessions, getBridgeSession, getBridgeSessionByRuntimeId, getBridgeSessionByWebContentsId, grantCapabilityToSession, listActiveBridgeSessions, toBridgeBootstrap, emitBridgeEvent } from './session-registry';
export type { BridgeSession, CreateBridgeSessionInput, EmitBridgeEventInput } from './session-registry';
export { dispatchBridgeInvoke, listRegisteredBridgeMethods } from './dispatcher';
export { grantBridgeConsent, hasBridgeConsent, listBridgeConsents, revokeBridgeAppConsents, revokeBridgeConsent } from './consent-store';
