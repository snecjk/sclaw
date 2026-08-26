import type { BridgeTrustTier } from './trust-policy';

export type CapabilityRisk = 'public' | 'low' | 'medium' | 'high' | 'critical';

export type Capability =
  | 'bridge.ping'
  | 'bridge.getCapabilities'
  | 'app.getInfo'
  | 'user.getInfo'
  | 'auth.getUser'
  | 'auth.getAuthMode'
  | 'auth.getToken'
  | 'auth.requestLogin'
  | 'nav.openTab'
  | 'nav.openApp'
  | 'nav.jump'
  | 'nav.openExternal'
  | 'nav.closeSelf'
  | 'nav.goBack'
  | 'nav.reload'
  | 'host.fetch'
  | 'storage.get'
  | 'storage.set'
  | 'storage.remove'
  | 'storage.clear'
  | 'ui.toast'
  | 'ui.alert'
  | 'ui.confirm'
  | 'ui.openDrawer'
  | 'chat.togglePanel'
  | 'chat.fillComposer'
  | 'chat.openSession'
  | 'chat.sendMessage'
  | 'chat.complete'
  | 'chat.cancel'
  | 'chat.invokeAgent'
  | 'composer.openFilePicker'
  | 'nav.openPreviewTab';

export const ALL_CAPABILITIES: readonly Capability[] = [
  'bridge.ping',
  'bridge.getCapabilities',
  'app.getInfo',
  'user.getInfo',
  'auth.getUser',
  'auth.getAuthMode',
  'auth.getToken',
  'auth.requestLogin',
  'nav.openTab',
  'nav.openApp',
  'nav.jump',
  'nav.openExternal',
  'nav.closeSelf',
  'nav.goBack',
  'nav.reload',
  'host.fetch',
  'storage.get',
  'storage.set',
  'storage.remove',
  'storage.clear',
  'ui.toast',
  'ui.alert',
  'ui.confirm',
  'ui.openDrawer',
  'chat.togglePanel',
  'chat.fillComposer',
  'chat.openSession',
  'chat.sendMessage',
  'chat.complete',
  'chat.cancel',
  'chat.invokeAgent',
  'composer.openFilePicker',
  'nav.openPreviewTab',
];

export const CAPABILITY_RISK: Record<Capability, CapabilityRisk> = {
  'bridge.ping': 'public',
  'bridge.getCapabilities': 'public',
  'app.getInfo': 'public',
  'user.getInfo': 'low',
  'auth.getUser': 'low',
  'auth.getAuthMode': 'low',
  'auth.getToken': 'high',
  'auth.requestLogin': 'medium',
  'nav.openTab': 'medium',
  'nav.openApp': 'medium',
  'nav.jump': 'medium',
  'nav.openExternal': 'medium',
  'nav.closeSelf': 'low',
  'nav.goBack': 'low',
  'nav.reload': 'low',
  'host.fetch': 'high',
  'storage.get': 'low',
  'storage.set': 'low',
  'storage.remove': 'low',
  'storage.clear': 'medium',
  'ui.toast': 'low',
  'ui.alert': 'low',
  'ui.confirm': 'medium',
  'ui.openDrawer': 'low',
  'chat.togglePanel': 'low',
  'chat.fillComposer': 'medium',
  'chat.openSession': 'medium',
  'chat.sendMessage': 'high',
  'chat.complete': 'critical',
  // Aborting a run the caller itself started is de-escalating, not privileged.
  'chat.cancel': 'low',
  'chat.invokeAgent': 'critical',
  'composer.openFilePicker': 'low',
  'nav.openPreviewTab': 'medium',
};

/** AI invocation capabilities. Granting these is not sufficient: the app's AI
 * profile (`bridgePolicy.ai.enabled`) is the effective gate. */
export const AI_CAPABILITIES: readonly Capability[] = [
  'chat.complete',
  'chat.cancel',
  'chat.invokeAgent',
];

export function isAiCapability(value: Capability): boolean {
  return (AI_CAPABILITIES as readonly string[]).includes(value);
}

/** Capabilities that require explicit user consent before first use. */
export const CONSENT_CAPABILITIES: readonly Capability[] = [
  'auth.getToken',
  'nav.openExternal',
  'host.fetch',
  'chat.sendMessage',
  // chat.cancel is intentionally absent: requiring consent to abort would leave
  // an app unable to stop a run it already started.
  'chat.complete',
  'chat.invokeAgent',
];

const DEFAULT_BY_TIER: Record<BridgeTrustTier, readonly Capability[]> = {
  internal: ALL_CAPABILITIES,
  catalog: [
    'bridge.ping',
    'bridge.getCapabilities',
    'app.getInfo',
    'user.getInfo',
    'auth.getUser',
    'auth.getAuthMode',
    'nav.openTab',
    'nav.openApp',
    'nav.jump',
    'nav.goBack',
    'nav.reload',
    'storage.get',
    'storage.set',
    'storage.remove',
    'ui.toast',
    'ui.alert',
    'ui.confirm',
    'ui.openDrawer',
    'chat.togglePanel',
    'chat.fillComposer',
    'chat.openSession',
    'chat.sendMessage',
    'composer.openFilePicker',
    'nav.openPreviewTab',
  ],
  external: [
    'bridge.ping',
    'bridge.getCapabilities',
    'app.getInfo',
    'auth.getUser',
    'ui.toast',
  ],
  untrusted: [
    'bridge.ping',
    'bridge.getCapabilities',
    'app.getInfo',
  ],
};

export function defaultCapabilitiesForTier(tier: BridgeTrustTier): Capability[] {
  return [...DEFAULT_BY_TIER[tier]];
}

export function mergeCapabilities(
  tier: BridgeTrustTier,
  policyCapabilities?: Capability[],
): Capability[] {
  const base = new Set(defaultCapabilitiesForTier(tier));
  for (const cap of policyCapabilities ?? []) {
    base.add(cap);
  }
  return [...base];
}

export function isCapability(value: string): value is Capability {
  return (ALL_CAPABILITIES as readonly string[]).includes(value);
}
