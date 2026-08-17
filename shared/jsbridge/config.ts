/** JSBridge origin and session policy — single source of truth. */

export const JSBRIDGE_ORIGIN_POLICY = {
  /** Global allowed origin patterns (currently *.sto.cn only). */
  globalPatterns: ['https://*.sto.cn', 'http://*.sto.cn'] as const,
  /** Allow bare sto.cn hostname. */
  allowRootDomain: true,
  /** Create bridge sessions for non-sto.cn pages (false = browse only, no bridge). */
  createSessionForNonStoCn: false,
  /** Default session TTL. */
  sessionTtlMs: 24 * 60 * 60 * 1000,
  /** Untrusted session TTL. */
  untrustedSessionTtlMs: 2 * 60 * 60 * 1000,
  /** Request timestamp skew tolerance. */
  requestTimestampSkewMs: 5 * 60 * 1000,
  /** Default invoke timeout. */
  defaultInvokeTimeoutMs: 30_000,
  /** Replay cache size per session. */
  replayCacheSize: 10_000,
} as const;
