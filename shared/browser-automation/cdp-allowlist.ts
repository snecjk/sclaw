/**
 * P2：cdp 裸调白名单 + 每方法超时。
 * ba 的 /cdp 路由与 bridge 的 'cdp' action 共用本表。
 * 只读/低危方法优先；Page.navigate、Network.setCookie、Input.* 一律不进表。
 */
export const CDP_RAW_CALL_ALLOWLIST = {
  'Runtime.evaluate': { timeoutMs: 10_000 },
  'Runtime.getProperties': { timeoutMs: 5_000 },
  'DOM.describeNode': { timeoutMs: 5_000 },
  'DOM.getContentQuads': { timeoutMs: 5_000 },
  'DOM.getBoxModel': { timeoutMs: 5_000 },
  'Page.getFrameTree': { timeoutMs: 5_000 },
  'Emulation.setDeviceMetricsOverride': { timeoutMs: 5_000 },
} as const satisfies Record<string, { timeoutMs: number }>;

export type CdpAllowlistedMethod = keyof typeof CDP_RAW_CALL_ALLOWLIST;

export function isCdpMethodAllowed(method: string): method is CdpAllowlistedMethod {
  return Object.prototype.hasOwnProperty.call(CDP_RAW_CALL_ALLOWLIST, method);
}

export function cdpMethodTimeoutMs(method: string): number {
  if (!isCdpMethodAllowed(method)) {
    throw Object.assign(new Error(`CDP method is not allowlisted: ${method}`), {
      code: 'CDP_METHOD_NOT_ALLOWED' as const,
    });
  }
  return CDP_RAW_CALL_ALLOWLIST[method].timeoutMs;
}
