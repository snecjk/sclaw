/**
 * Main-world script injected into embed webview guests before page JS runs.
 * baxiaCommon.js / bundled app.js call setRequestHeader('origin', …) from their
 * click/tracking flow. `Origin` is a Fetch-spec forbidden header: Chromium does
 * NOT throw — it drops the header and logs "Refused to set unsafe header" from
 * the engine itself, so a try/catch wrapper can never suppress it. The patch
 * therefore filters forbidden names up front and never calls the native method
 * for them, which matches the browser's net behavior (header dropped) without
 * the console error.
 */
export const SCLAW_EMBED_BROWSER_XHR_PATCH_SCRIPT = String.raw`(function() {
  if (window.__STOCLAW_XHR_PATCHED__) return;
  window.__STOCLAW_XHR_PATCHED__ = true;
  var FORBIDDEN = [
    'accept-charset', 'accept-encoding', 'access-control-request-headers',
    'access-control-request-method', 'connection', 'content-length', 'cookie',
    'cookie2', 'date', 'dnt', 'expect', 'host', 'keep-alive', 'origin',
    'referer', 'te', 'trailer', 'transfer-encoding', 'upgrade', 'via'
  ];
  function isForbidden(name) {
    var n = String(name).toLowerCase();
    return FORBIDDEN.indexOf(n) >= 0 || n.indexOf('proxy-') === 0 || n.indexOf('sec-') === 0;
  }
  var originalSet = XMLHttpRequest.prototype.setRequestHeader;
  XMLHttpRequest.prototype.setRequestHeader = function(name, value) {
    if (isForbidden(name)) return;
    try {
      return originalSet.call(this, name, value);
    } catch (err) {
      var msg = err && err.message ? String(err.message) : '';
      if (msg.indexOf('unsafe header') >= 0 || msg.indexOf('Refused to set') >= 0) return;
      throw err;
    }
  };
})();`;
