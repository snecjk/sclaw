/**
 * In-page observation script for Browser Automation Platform.
 * Builds interactive element list with ref + stableKey for act/validate.
 */
export const BROWSER_AUTOMATION_OBSERVE_SCRIPT = `(function() {
  if (window.__stoBrowserAutomation && window.__stoBrowserAutomation.buildObservation) {
    return window.__stoBrowserAutomation.buildObservation();
  }

  var refCounter = 1;
  var refMap = new Map();
  var ELEMENT_LIMIT = __ELEMENT_LIMIT__;

  function simpleHash(input) {
    var h = 2166136261;
    for (var i = 0; i < input.length; i++) {
      h ^= input.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return ('0000000' + (h >>> 0).toString(16)).slice(-8);
  }

  function inferRole(tag, node) {
    var explicit = node.getAttribute && node.getAttribute('role');
    if (explicit) return explicit;
    if (tag === 'a') return 'link';
    if (tag === 'button') return 'button';
    if (tag === 'input') return node.type || 'textbox';
    if (tag === 'textarea') return 'textbox';
    if (tag === 'select') return 'combobox';
    if (tag === 'img') return 'image';
    return tag;
  }

  function computeName(node) {
    return (
      (node.getAttribute && node.getAttribute('aria-label'))
      || (node.getAttribute && node.getAttribute('placeholder'))
      || (node.getAttribute && node.getAttribute('title'))
      || (node.getAttribute && node.getAttribute('name'))
      || (node.id ? '#' + node.id : '')
      || (node.textContent || '').trim().replace(/\\s+/g, ' ').slice(0, 100)
    );
  }

  function cssPath(node, root) {
    if (!node || node === root) return 'body';
    if (node.id) return '#' + CSS.escape(node.id);
    var tag = node.tagName ? node.tagName.toLowerCase() : 'node';
    var parent = node.parentElement;
    if (!parent) return tag;
    var siblings = Array.prototype.filter.call(parent.children, function(child) {
      return child.tagName === node.tagName;
    });
    var index = siblings.indexOf(node) + 1;
    return cssPath(parent, root) + '>' + tag + ':nth-of-type(' + index + ')';
  }

  function isVisible(node) {
    if (!node || !node.getBoundingClientRect) return false;
    var style = window.getComputedStyle(node);
    if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
    var rect = node.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function collectStates(node) {
    var states = [];
    if (node.disabled) states.push('disabled');
    if (node.checked) states.push('checked');
    if (node.selected) states.push('selected');
    if (node.getAttribute && node.getAttribute('aria-expanded') === 'true') states.push('expanded');
    if (node.getAttribute && node.getAttribute('aria-expanded') === 'false') states.push('collapsed');
    return states;
  }

  function walkInteractive(node, root, out, limit) {
    if (!node || out.length >= limit) return;
    var nodes = [];
    if (node.nodeType === 1) nodes.push(node);
    if (node.shadowRoot) nodes.push(node.shadowRoot);
    for (var n = 0; n < nodes.length; n++) {
      var current = nodes[n];
      if (current.nodeType === 11) {
        var shadowChildren = current.children || current.childNodes;
        for (var c = 0; c < shadowChildren.length; c++) walkInteractive(shadowChildren[c], root, out, limit);
        continue;
      }
      var tag = current.tagName ? current.tagName.toLowerCase() : '';
      var interactive = current.matches && current.matches(
        'a, button, input, textarea, select, [contenteditable=""], [contenteditable="true"], [role="button"], [role="link"], [role="tab"], [role="menuitem"], [role="checkbox"], [role="radio"], [role="combobox"], [role="textbox"]'
      );
      var name = computeName(current);
      var visible = isVisible(current);
      if (interactive && (visible || name)) {
        var role = inferRole(tag, current);
        var selector = cssPath(current, root);
        var stableKey = simpleHash(role + '|' + name + '|' + selector);
        var ref = '@e' + (refCounter++);
        refMap.set(ref, { node: current, stableKey: stableKey, selector: selector });
        var rect = current.getBoundingClientRect();
        out.push({
          ref: ref,
          stableKey: stableKey,
          role: role,
          name: name || '',
          tag: tag,
          selector: selector,
          clickable: !!(current.matches && current.matches('a, button, [role="button"], [role="link"], [role="tab"], input[type="submit"], input[type="button"]')),
          editable: !!(current.matches && current.matches('input, textarea, select, [contenteditable=""], [contenteditable="true"], [role="textbox"]')),
          value: ('value' in current ? String(current.value || '') : undefined),
          states: collectStates(current),
          boundingBox: {
            x: Math.round(rect.x + window.scrollX),
            y: Math.round(rect.y + window.scrollY),
            width: Math.round(rect.width),
            height: Math.round(rect.height),
          },
        });
      }
      if (current.children) {
        for (var i = 0; i < current.children.length; i++) walkInteractive(current.children[i], root, out, limit);
      }
      if (current.shadowRoot) {
        for (var s = 0; s < current.shadowRoot.children.length; s++) walkInteractive(current.shadowRoot.children[s], root, out, limit);
      }
    }
  }

  function buildObservation() {
    refCounter = 1;
    refMap = new Map();
    var root = document.body || document.documentElement;
    var elements = [];
    walkInteractive(root, root, elements, ELEMENT_LIMIT);
    var textSample = (document.body && document.body.innerText ? document.body.innerText : '').replace(/\\s+/g, ' ').trim().slice(0, 500);
    var fingerprint = simpleHash(location.href + '|' + document.title + '|' + elements.length + '|' + textSample);
    return {
      url: location.href,
      title: document.title || '',
      timestamp: Date.now(),
      elements: elements,
      fingerprint: fingerprint,
    };
  }

  function resolveTarget(payload) {
    buildObservation();
    if (payload.ref && refMap.has(payload.ref)) return refMap.get(payload.ref);
    if (payload.stableKey) {
      for (var pair of refMap.entries()) {
        if (pair[1].stableKey === payload.stableKey) return pair[1];
      }
    }
    if (payload.name) {
      var target = String(payload.name).trim();
      for (var pair2 of refMap.entries()) {
        var node = pair2[1].node;
        var nm = computeName(node);
        if (nm === target || nm.indexOf(target) >= 0) return pair2[1];
      }
    }
    return null;
  }

  function act(payload) {
    payload = payload || {};
    var action = payload.action;
    if (action === 'navigate') {
      if (!payload.url) return { success: false, error: 'url is required' };
      location.href = payload.url;
      return { success: true, action: action };
    }
    var target = resolveTarget(payload);
    if (!target) return { success: false, error: 'Element not found' };
    var el = target.node;
    el.scrollIntoView({ behavior: 'instant', block: 'center', inline: 'center' });
    if (action === 'click') {
      el.click();
      return { success: true, action: action, ref: payload.ref, stableKey: target.stableKey };
    }
    if (action === 'fill') {
      if ('value' in el) el.value = payload.value || '';
      else if (el.isContentEditable) el.textContent = payload.value || '';
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return { success: true, action: action, ref: payload.ref, stableKey: target.stableKey };
    }
    if (action === 'select') {
      if (el.tagName && el.tagName.toLowerCase() === 'select') {
        el.value = payload.value || '';
        el.dispatchEvent(new Event('change', { bubbles: true }));
        return { success: true, action: action, stableKey: target.stableKey };
      }
      return { success: false, error: 'Element is not a select' };
    }
    if (action === 'scroll') {
      window.scrollBy(0, Number(payload.scrollY || 400));
      return { success: true, action: action };
    }
    if (action === 'press') {
      el.dispatchEvent(new KeyboardEvent('keydown', { key: payload.key || 'Enter', bubbles: true }));
      el.dispatchEvent(new KeyboardEvent('keyup', { key: payload.key || 'Enter', bubbles: true }));
      return { success: true, action: action, stableKey: target.stableKey };
    }
    return { success: false, error: 'Unsupported action: ' + action };
  }

  window.__stoBrowserAutomation = {
    buildObservation: buildObservation,
    act: act,
    resolveTarget: resolveTarget,
  };

  return buildObservation();
})()`;

export function buildObserveScript(elementLimit: number): string {
  return BROWSER_AUTOMATION_OBSERVE_SCRIPT.replace('__ELEMENT_LIMIT__', String(elementLimit));
}

export const BROWSER_AUTOMATION_VALIDATE_SCRIPT = `(function(spec) {
  spec = spec || {};
  function countMatches(role, name) {
    var selector = role.indexOf('/') >= 0 ? role : '[role="' + role + '"], ' + role;
    var nodes = document.querySelectorAll(selector);
    if (!name) return nodes.length;
    var count = 0;
    for (var i = 0; i < nodes.length; i++) {
      var text = (nodes[i].getAttribute('aria-label') || nodes[i].textContent || '').trim();
      if (text.indexOf(name) >= 0) count++;
    }
    return count;
  }
  if (spec.type === 'url') {
    var pattern = spec.pattern || '';
    var ok = pattern ? new RegExp(pattern).test(location.href) : true;
    return { passed: ok, type: 'url', message: ok ? 'URL matched' : ('URL mismatch: ' + location.href) };
  }
  if (spec.type === 'title') {
    var tp = spec.pattern || '';
    var tok = tp ? new RegExp(tp).test(document.title || '') : true;
    return { passed: tok, type: 'title', message: tok ? 'Title matched' : ('Title mismatch: ' + document.title) };
  }
  if (spec.type === 'elementCount') {
    var cnt = countMatches(spec.role || 'button', spec.name || '');
    var min = typeof spec.minCount === 'number' ? spec.minCount : 1;
    var max = typeof spec.maxCount === 'number' ? spec.maxCount : Infinity;
    var cok = cnt >= min && cnt <= max;
    return { passed: cok, type: 'elementCount', message: 'count=' + cnt };
  }
  if (spec.type === 'elementText') {
    var body = (document.body && document.body.innerText) ? document.body.innerText : '';
    var expected = spec.expectedText || '';
    var eok = expected ? body.indexOf(expected) >= 0 : true;
    return { passed: eok, type: 'elementText', message: eok ? 'Text found' : ('Text not found: ' + expected) };
  }
  if (spec.type === 'elementExists') {
    var exists = countMatches(spec.role || '*', spec.name || '') > 0;
    return { passed: exists, type: 'elementExists', message: exists ? 'Element exists' : 'Element missing' };
  }
  return { passed: false, type: spec.type || 'unknown', message: 'Unsupported validator' };
})`;
