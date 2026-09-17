export type ChannelReplaceReason = 'unbound' | 'other_device';

export type MobileBindButtonKind = 'configure' | 'bind';

/** Mobile row copy: never reads DingTalk remote. */
export function mobileReplaceHint(input: {
  bindStatus?: string | null;
  enabled?: boolean;
  replaceReason?: ChannelReplaceReason | null;
}): ChannelReplaceReason | null {
  const enabled = Boolean(input.enabled);
  const bound = input.bindStatus === 'bound';
  if (enabled || bound) return null;
  if (input.bindStatus !== 'revoked' || enabled) return null;
  const reason = input.replaceReason;
  if (reason === 'unbound' || reason === 'other_device') return reason;
  return null;
}

/**
 * DingTalk row hint from local + remote (existing other_device / unbound behavior).
 * Does not feed mobile UI.
 */
export function dingTalkReplaceHint(input: {
  local?: { bindStatus?: string | null } | null;
  remote?: { bound?: boolean; deviceId?: string; error?: string } | null;
  deviceId?: string | null;
}): ChannelReplaceReason | null {
  if (!input.local || input.local.bindStatus !== 'bound') return null;
  const remote = input.remote;
  if (!remote || ('error' in remote && remote.error)) return null;
  if (remote.bound === false) return 'unbound';
  if (
    remote.bound
    && remote.deviceId
    && input.deviceId
    && remote.deviceId !== input.deviceId
  ) {
    return 'other_device';
  }
  return null;
}

/**
 * Button label when Switch is not shown. Independent of localStorage.
 */
export function mobileBindButtonKind(input: {
  bindStatus?: string | null;
  enabled?: boolean;
  replaceReason?: ChannelReplaceReason | null;
}): MobileBindButtonKind {
  if (input.enabled) return 'configure';
  const reason = input.replaceReason;
  if (reason === 'unbound' || reason === 'other_device') return 'configure';
  return 'bind';
}

export function parseReplaceReason(value: unknown): ChannelReplaceReason | null {
  if (value === 'unbound' || value === 'other_device') return value;
  return null;
}
