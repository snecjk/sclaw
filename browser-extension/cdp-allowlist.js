/** Keep in sync with sto-claw shared/browser-automation/cdp-allowlist.ts */
const CDP_RAW_CALL_ALLOWLIST = {
  'Runtime.evaluate': { timeoutMs: 10000 },
  'Runtime.getProperties': { timeoutMs: 5000 },
  'DOM.describeNode': { timeoutMs: 5000 },
  'DOM.getContentQuads': { timeoutMs: 5000 },
  'DOM.getBoxModel': { timeoutMs: 5000 },
  'Page.getFrameTree': { timeoutMs: 5000 },
  'Emulation.setDeviceMetricsOverride': { timeoutMs: 5000 },
};

function isCdpMethodAllowed(method) {
  return Object.prototype.hasOwnProperty.call(CDP_RAW_CALL_ALLOWLIST, method);
}
