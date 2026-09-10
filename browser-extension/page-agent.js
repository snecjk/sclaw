/**
 * Injected via chrome.debugger Runtime.evaluate (not a content script).
 * ES5. Exposes window.__stoBridge for snapshot / click / fill / mark / read.
 */
const PAGE_AGENT_SOURCE = `(function() {
  var ELEMENT_LIMIT = 400;
  var refCounter = 1;
  var refMap = new Map();
  var clickProbe = null;
  var clickProbeListener = null;
  var MARK_SHEET_ID = '__stoclaw_bridge_mark__';

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

  function describeNode(node) {
    if (!node || !node.tagName) return 'unknown';
    var desc = node.tagName.toLowerCase();
    if (node.id) desc += '#' + node.id;
    return desc;
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
    if (node.readOnly || (node.hasAttribute && node.hasAttribute('readonly'))) states.push('readonly');
    if (node.checked) states.push('checked');
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
            height: Math.round(rect.height)
          }
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
    var truncated = elements.length >= ELEMENT_LIMIT;
    return {
      url: location.href,
      title: document.title || '',
      timestamp: Date.now(),
      nodeCount: elements.length,
      truncated: truncated,
      actionHint: truncated
        ? '观察已达预算并截断。请先滚动或收窄到目标区域再观察，不要指望一次拿到整页。'
        : undefined,
      elements: elements
    };
  }

  function resolveTarget(payload) {
    buildObservation();
    if (!payload) return null;
    if (payload.ref && refMap.has(payload.ref)) return refMap.get(payload.ref);
    if (payload.stableKey) {
      for (var pair of refMap.entries()) {
        if (pair[1].stableKey === payload.stableKey) return pair[1];
      }
    }
    if (payload.name) {
      var target = String(payload.name).trim();
      for (var pair2 of refMap.entries()) {
        var nm = computeName(pair2[1].node);
        if (nm === target || nm.indexOf(target) >= 0) return pair2[1];
      }
    }
    return null;
  }

  function fillWithNativeSetter(el, value) {
    var text = value == null ? '' : String(value);
    if (typeof el.focus === 'function') el.focus();
    if (el.isContentEditable) {
      el.textContent = text;
    } else if ('value' in el) {
      var proto = el instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : (el instanceof HTMLInputElement ? HTMLInputElement.prototype : null);
      if (proto) {
        var descriptor = Object.getOwnPropertyDescriptor(proto, 'value');
        if (descriptor && descriptor.set) descriptor.set.call(el, text);
        else el.value = text;
      } else {
        el.value = text;
      }
    }
    try {
      el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
    } catch (err) {
      el.dispatchEvent(new Event('input', { bubbles: true }));
    }
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function removeClickProbeListener() {
    if (!clickProbeListener) return;
    window.removeEventListener('pointerdown', clickProbeListener, true);
    window.removeEventListener('click', clickProbeListener, true);
    clickProbeListener = null;
  }

  function installClickProbe(payload) {
    removeClickProbeListener();
    var expectedNode = null;
    if (payload && (payload.ref || payload.stableKey || payload.name)) {
      var target = resolveTarget(payload);
      if (target && target.node) expectedNode = target.node;
    }
    clickProbe = { delivered: false, chain: [], expectedNode: expectedNode };
    clickProbeListener = function(event) {
      if (clickProbe) {
        clickProbe.delivered = true;
        var chain = [];
        var node = event.target;
        while (node) {
          chain.push(node);
          node = node.parentElement;
        }
        clickProbe.chain = chain;
      }
      removeClickProbeListener();
    };
    window.addEventListener('pointerdown', clickProbeListener, true);
    window.addEventListener('click', clickProbeListener, true);
    return true;
  }

  function readClickProbe() {
    if (!clickProbe) return null;
    var matched = false;
    if (clickProbe.expectedNode) {
      for (var i = 0; i < clickProbe.chain.length; i++) {
        if (clickProbe.chain[i] === clickProbe.expectedNode) {
          matched = true;
          break;
        }
      }
    }
    return { delivered: clickProbe.delivered, targetMatched: matched };
  }

  function jsClick(payload) {
    var target = resolveTarget(payload);
    if (!target) return { success: false, error: 'Element not found' };
    var el = target.node;
    el.scrollIntoView({ behavior: 'instant', block: 'center', inline: 'center' });
    var occluded = false;
    var occluder;
    var rect = el.getBoundingClientRect();
    if (typeof document.elementFromPoint === 'function' && rect.width > 0 && rect.height > 0) {
      var hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
      if (hit && hit !== el && !el.contains(hit) && !(hit.contains && hit.contains(el))) {
        occluded = true;
        occluder = describeNode(hit);
      }
    }
    el.click();
    return {
      success: true,
      occluded: occluded,
      occluder: occluder,
      stableKey: target.stableKey,
      centerX: rect.left + rect.width / 2,
      centerY: rect.top + rect.height / 2
    };
  }

  function nativeFill(payload) {
    var target = resolveTarget(payload);
    if (!target) return { success: false, error: 'Element not found' };
    var el = target.node;
    if (el.disabled || el.getAttribute('aria-disabled') === 'true') {
      return { success: false, error: 'Element is disabled' };
    }
    if (el.readOnly || el.hasAttribute('readonly') || el.getAttribute('aria-readonly') === 'true') {
      return { success: false, error: 'Element is readonly' };
    }
    el.scrollIntoView({ behavior: 'instant', block: 'center', inline: 'center' });
    fillWithNativeSetter(el, payload.value || '');
    return { success: true, stableKey: target.stableKey };
  }

  function readPage() {
    var text = (document.body && document.body.innerText ? document.body.innerText : '').replace(/\\s+/g, ' ').trim();
    var truncated = text.length > 20000;
    return {
      url: location.href,
      title: document.title || '',
      text: truncated ? text.slice(0, 8000) : text,
      truncated: truncated
    };
  }

  function setVisualMark(marked, label) {
    var existing = document.getElementById(MARK_SHEET_ID);
    if (existing) existing.remove();
    if (window.__stoBridgeMarkSheet) {
      try {
        var sheets = Array.prototype.slice.call(document.adoptedStyleSheets || []);
        document.adoptedStyleSheets = sheets.filter(function(s) { return s !== window.__stoBridgeMarkSheet; });
      } catch (e) {}
      window.__stoBridgeMarkSheet = null;
    }
    if (!marked) {
      var bar = document.getElementById('__stoclaw_bridge_bar__');
      if (bar) bar.remove();
      return { success: true, marked: false };
    }
    var css = '#__stoclaw_bridge_bar__{position:fixed;top:0;left:0;right:0;z-index:2147483647;height:28px;background:#FF6F00;color:#fff;font:12px/28px sans-serif;text-align:center;pointer-events:none}';
    try {
      var sheet = new CSSStyleSheet();
      sheet.replaceSync(css);
      var next = Array.prototype.slice.call(document.adoptedStyleSheets || []);
      next.push(sheet);
      document.adoptedStyleSheets = next;
      window.__stoBridgeMarkSheet = sheet;
    } catch (err) {
      /* constructable stylesheet unavailable; badge still uses a DOM node without <style> */
    }
    var node = document.getElementById('__stoclaw_bridge_bar__');
    if (!node) {
      node = document.createElement('div');
      node.id = '__stoclaw_bridge_bar__';
      (document.documentElement || document.body).appendChild(node);
    }
    node.textContent = label ? String(label) : '[自动操作]';
    return { success: true, marked: true };
  }

  function doScroll(payload) {
    payload = payload || {};
    if (payload.ref || payload.name || payload.stableKey) {
      var target = resolveTarget(payload);
      if (!target) return { success: false, error: 'Element not found' };
      target.node.scrollIntoView({ behavior: 'instant', block: 'center', inline: 'center' });
      return { success: true };
    }
    window.scrollBy(0, Number(payload.scrollY || payload.dy || 400));
    return { success: true };
  }

  window.__stoBridge = {
    snapshot: buildObservation,
    jsClick: jsClick,
    nativeFill: nativeFill,
    installClickProbe: installClickProbe,
    readClickProbe: readClickProbe,
    readPage: readPage,
    setVisualMark: setVisualMark,
    doScroll: doScroll
  };
  return true;
})()`;
