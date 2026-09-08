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

  /** 直接文本子节点；用于判断"这个节点自己有名字"而不是名字来自后代。 */
  function ownText(node) {
    var out = '';
    for (var t = 0; t < node.childNodes.length; t++) {
      var child = node.childNodes[t];
      if (child.nodeType === 3) out += child.nodeValue;
    }
    return out.trim().replace(/\\s+/g, ' ').slice(0, 100);
  }

  function isVisible(node) {
    var style = window.getComputedStyle(node);
    return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
  }

  var INTERACTIVE_SELECTOR = 'a, button, input, textarea, select, summary, label, [contenteditable], [onclick], [tabindex]:not([tabindex="-1"]), [role="button"], [role="link"], [role="tab"], [role="menuitem"], [role="menuitemcheckbox"], [role="option"], [role="checkbox"], [role="radio"], [role="switch"], [role="textbox"], [role="combobox"], [role="slider"]';
  var CLICKABLE_SELECTOR = 'a, button, input, textarea, select, [contenteditable], [onclick], [role="button"], [role="link"], [role="tab"], [role="menuitem"], [role="option"], [role="checkbox"], [role="radio"], [role="switch"]';
  var EDITABLE_SELECTOR = 'input, textarea, select, [contenteditable]';
  /** 单次快照的节点预算；超出即截断并告诉模型缩小范围，而不是把整页塞进上下文。 */
  var MAX_SNAPSHOT_NODES = 600;

  function walk(node, state) {
    var tag = node.tagName.toLowerCase();
    var interactive = node.matches(INTERACTIVE_SELECTOR);
    var rect = node.getBoundingClientRect();
    var visible = rect.width > 0 && rect.height > 0 && isVisible(node);
    var own = ownText(node);
    var labelled = node.getAttribute('aria-label') || node.getAttribute('placeholder') || node.getAttribute('title') || '';
    var selfNamed = Boolean(own || labelled);

    // 只有可交互节点、和自己带文本的节点才产出记录，纯包装层折叠掉。
    // 此前 li/span/div 都算可交互，且 name 取的是整棵后代 textContent，于是
    // 页面上每个 div 都产出一条 ref+role+name+tag+两个布尔+四字段 boundingBox
    // 的记录——实测单次快照 13.9 万字符，模型直接丢掉页面模型。
    //
    // 折叠时必须继续递归：零尺寸包装层（display:contents、绝对定位容器）的子
    // 节点是有效的，原来在可见性判断处直接 return null 会连带丢掉整棵子树。
    if ((!interactive || !visible) && !selfNamed) {
      if (!node.children.length) return null;
      var collapsed = [];
      for (var i = 0; i < node.children.length; i++) {
        var childNode = walk(node.children[i], state);
        if (childNode) collapsed.push(childNode);
      }
      if (!collapsed.length) return null;
      if (collapsed.length === 1) return collapsed[0];
      return { role: tag, children: collapsed };
    }

    if (state.count >= MAX_SNAPSHOT_NODES) {
      state.truncated = true;
      return null;
    }
    state.count += 1;

    var ref = '@e' + (refCounter++);
    refToElement.set(ref, node);

    var children = [];
    for (var j = 0; j < node.children.length; j++) {
      var walked = walk(node.children[j], state);
      if (walked) children.push(walked);
    }

    var role = node.getAttribute('role') || inferRole(tag, node);
    // 字段按需产出：布尔为假、tag 与 role 相同、非可交互节点的 boundingBox
    // 都是纯字节浪费——它们占了旧快照的大头。
    var result = { ref: ref, role: role };
    var name = interactive ? computeAccessibleName(node) : (own || labelled);
    if (name) result.name = name;
    if (tag !== role) result.tag = tag;
    if (node.matches(CLICKABLE_SELECTOR)) result.clickable = true;
    if (node.matches(EDITABLE_SELECTOR)) result.editable = true;
    if (interactive) {
      result.boundingBox = {
        x: Math.round(rect.x + window.scrollX),
        y: Math.round(rect.y + window.scrollY),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      };
    }
    if (children.length) result.children = children;
    return result;
  }

  function buildSnapshot() {
    refCounter = 1;
    refToElement.clear();
    var state = { count: 0, truncated: false };
    var body = document.body ? walk(document.body, state) : null;
    var snapshot = {
      url: location.href,
      title: document.title,
      timestamp: Date.now(),
      nodeCount: state.count,
      tree: body ? [body] : [],
    };
    if (state.truncated) {
      snapshot.truncated = true;
      snapshot.actionHint = '快照已达 ' + MAX_SNAPSHOT_NODES + ' 节点预算并截断。'
        + '请先滚动或收窄到目标区域再快照，不要指望一次拿到整页。';
    }
    return snapshot;
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
