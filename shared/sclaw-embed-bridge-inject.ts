/**
 * Injected into embed webview pages — same DOM ops as browser-extension content-script,
 * exposed as window.__stoEmbedBridge (no Chrome extension APIs).
 */
export const SCLAW_EMBED_BRIDGE_INJECT_SCRIPT = `(function() {
  if (window.__stoEmbedBridge) return true;
  var refCounter = 1;
  var refToElement = new Map();

  function inferRole(tag, node) {
    if (tag === 'a') return 'link';
    if (tag === 'button') return 'button';
    if (tag === 'input') return node.type || 'textbox';
    if (tag === 'textarea') return 'textbox';
    if (tag === 'select') return 'combobox';
    if (tag === 'img') return 'image';
    return tag;
  }

  function computeAccessibleName(node) {
    return (
      node.getAttribute('aria-label')
      || node.getAttribute('placeholder')
      || node.getAttribute('title')
      || (node.textContent || '').trim().replace(/\\s+/g, ' ').slice(0, 100)
    );
  }

  function isVisible(node) {
    var style = window.getComputedStyle(node);
    return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
  }

  function walk(node) {
    var tag = node.tagName.toLowerCase();
    var isInteractive = node.matches(
      'a, button, input, textarea, select, [contenteditable], [onclick], [role="button"], [role="link"], [role="tab"], li, span, div'
    );
    var rect = node.getBoundingClientRect();
    var visible = rect.width > 0 && rect.height > 0 && isVisible(node);
    var name = computeAccessibleName(node);
    var hasName = Boolean(name && name.length > 0);
    if (!visible && !hasName) return null;
    if (!isInteractive && !hasName && node.children.length > 0) {
      var onlyChildren = [];
      for (var i = 0; i < node.children.length; i++) {
        var childNode = walk(node.children[i]);
        if (childNode) onlyChildren.push(childNode);
      }
      return onlyChildren.length === 1 ? onlyChildren[0] : (onlyChildren.length ? { role: tag, name: name || tag, tag: tag, children: onlyChildren } : null);
    }

    var ref = '@e' + (refCounter++);
    refToElement.set(ref, node);

    var children = [];
    for (var j = 0; j < node.children.length; j++) {
      var walked = walk(node.children[j]);
      if (walked) children.push(walked);
    }

    var result = {
      ref: ref,
      role: node.getAttribute('role') || inferRole(tag, node),
      name: name,
      tag: tag,
      clickable: node.matches('a, button, input, textarea, select, [contenteditable], [onclick], [role="button"], [role="link"], [role="tab"]'),
      editable: node.matches('input, textarea, [contenteditable], select'),
      boundingBox: {
        x: Math.round(rect.x + window.scrollX),
        y: Math.round(rect.y + window.scrollY),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      },
    };
    if (children.length) result.children = children;
    return result;
  }

  function buildSnapshot() {
    refCounter = 1;
    refToElement.clear();
    var body = document.body ? walk(document.body) : null;
    return {
      url: location.href,
      title: document.title,
      timestamp: Date.now(),
      tree: body ? [body] : [],
    };
  }

  function findByName(text) {
    var target = (text || '').trim();
    if (!target) return null;
    buildSnapshot();
    for (var pair of refToElement.entries()) {
      var el = pair[1];
      var name = computeAccessibleName(el);
      if (name === target || name.indexOf(target) >= 0) return pair[0];
    }
    return null;
  }

  function executeCommand(action, payload) {
    payload = payload || {};
    switch (action) {
      case 'snapshot':
        return buildSnapshot();
      case 'click': {
        var clickRef = payload.ref || findByName(payload.name || payload.text);
        var clickEl = clickRef ? refToElement.get(clickRef) : null;
        if (!clickEl) return { success: false, error: 'Element not found: ' + (payload.ref || payload.name || '') };
        clickEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
        clickEl.click();
        return { success: true, ref: clickRef };
      }
      case 'fill': {
        var fillRef = payload.ref || findByName(payload.name || payload.text);
        var fillEl = fillRef ? refToElement.get(fillRef) : null;
        if (!fillEl) return { success: false, error: 'Element not found: ' + (payload.ref || payload.name || '') };
        if (fillEl.isContentEditable) {
          fillEl.textContent = payload.value || '';
        } else if ('value' in fillEl) {
          fillEl.value = payload.value || '';
        }
        fillEl.dispatchEvent(new Event('input', { bubbles: true }));
        fillEl.dispatchEvent(new Event('change', { bubbles: true }));
        return { success: true, ref: fillRef, value: payload.value || '' };
      }
      case 'scroll':
        window.scrollTo(payload.x || 0, payload.y || 0);
        return { success: true };
      case 'evaluate':
        try {
          var fn = new Function('return (' + (payload.script || 'null') + ')')();
          return { success: true, value: fn() };
        } catch (err) {
          return { success: false, error: String(err) };
        }
      default:
        return { success: false, error: 'Unknown action: ' + action };
    }
  }

  window.__stoEmbedBridge = {
    buildSnapshot: buildSnapshot,
    executeCommand: executeCommand,
  };
  return true;
})()`;

export function buildSclawEmbedBridgeSessionId(runtimeId: string): string {
  return `embed-${runtimeId}`;
}
