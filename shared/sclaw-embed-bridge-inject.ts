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
    var bestEl = null;
    var bestScore = -1;

    function scoreElement(el, name) {
      var exact = name === target;
      var partial = name.indexOf(target) >= 0;
      if (!exact && !partial) return -1;
      var score = exact ? 100 : 50;
      if (el.matches('a, button, input[type="submit"], input[type="button"], [role="button"], [role="link"], [role="tab"]')) {
        score += 40;
      } else {
        var style = window.getComputedStyle(el);
        if (style.cursor === 'pointer') score += 28;
        else if (el.getAttribute('onclick')) score += 20;
      }
      var rect = el.getBoundingClientRect();
      var area = Math.max(1, rect.width * rect.height);
      score += Math.max(0, 24 - Math.log10(area));
      return score;
    }

    function walkFind(node) {
      if (!node || node.nodeType !== 1) return;
      var name = computeAccessibleName(node);
      if (name) {
        var score = scoreElement(node, name);
        if (score > bestScore) {
          bestScore = score;
          bestEl = node;
        }
      }
      for (var i = 0; i < node.children.length; i++) walkFind(node.children[i]);
      if (node.shadowRoot) {
        for (var s = 0; s < node.shadowRoot.children.length; s++) walkFind(node.shadowRoot.children[s]);
      }
    }

    walkFind(document.body || document.documentElement);
    if (!bestEl) return null;
    var ref = '@e' + (refCounter++);
    refToElement.set(ref, bestEl);
    return ref;
  }

  function resolveClickTarget(el) {
    if (!el) return null;
    if (el.matches('a, button, input[type="submit"], input[type="button"], [role="button"], [role="link"], [role="tab"]')) {
      return el;
    }
    var closestInteractive = el.closest('a, button, [role="button"], [role="link"], [role="tab"]');
    if (closestInteractive) return closestInteractive;
    var parent = el.parentElement;
    for (var depth = 0; depth < 6 && parent; depth += 1) {
      var style = window.getComputedStyle(parent);
      if (style.cursor === 'pointer' || parent.getAttribute('onclick')) return parent;
      parent = parent.parentElement;
    }
    return el;
  }

  function synthesizeClick(el) {
    var target = resolveClickTarget(el);
    target.scrollIntoView({ behavior: 'instant', block: 'center', inline: 'center' });
    var opts = { bubbles: true, cancelable: true, view: window };
    try {
      target.dispatchEvent(new PointerEvent('pointerdown', opts));
      target.dispatchEvent(new MouseEvent('mousedown', opts));
      target.dispatchEvent(new PointerEvent('pointerup', opts));
      target.dispatchEvent(new MouseEvent('mouseup', opts));
      target.dispatchEvent(new MouseEvent('click', opts));
    } catch (err) {
      // PointerEvent may be unavailable in older webviews; MouseEvent-only is enough for most SPAs.
    }
    if (typeof target.click === 'function') target.click();
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
        synthesizeClick(clickEl);
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
