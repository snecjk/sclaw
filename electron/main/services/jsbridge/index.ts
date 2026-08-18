export { createBridgeSession, destroyBridgeSession, destroyBridgeSessionsForRuntime, destroyAllBridgeSessions, getBridgeSession, getBridgeSessionByRuntimeId, getBridgeSessionByWebContentsId, grantCapabilityToSession, listActiveBridgeSessions, toBridgeBootstrap } from './session-registry';
export type { BridgeSession, CreateBridgeSessionInput } from './session-registry';
export { dispatchBridgeInvoke, listRegisteredBridgeMethods } from './dispatcher';
export { grantBridgeConsent, hasBridgeConsent, listBridgeConsents, revokeBridgeAppConsents, revokeBridgeConsent } from './consent-store';
