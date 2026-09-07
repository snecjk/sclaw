/**
 * In-page observation script for Browser Automation Platform.
 * Builds interactive element list with ref + stableKey for act/validate.
 *
 * 波次 1（A2）加固：
 * - buildObservation 上报 navEpoch（location.href + performance.timeOrigin 的 hash）——
 *   代际号本体由主进程颁发（B4），页面侧只提供换代检测信号；
 * - lastIssuedGeneration 页内记录主进程颁发的代际号，resolveTarget 做 STALE_REF 兜底校验；
 * - act('click') 遮挡检测（elementFromPoint 与目标/祖先比对）；
 * - act('fill') 统一走 fillWithNativeSetter（原型 setter + contenteditable 双路径）；
 * - installDialogHooks/drainDialogs：CDP Page 域不可用时的 JS dialog 页内 fallback（B2）；
 * - installClickProbe/readClickProbe：投递探针，供波次 2 的 actClickWithFallback 消费；
 * - getElementPageRect：截图 ref→clip 的页内解析（scrollIntoView + 文档坐标 rect，B4）。
 *
 * 注入脚本保持 ES5 语法风格（var / 无箭头函数 / 无模板字符串）。
 */
export const BROWSER_AUTOMATION_OBSERVE_SCRIPT = `(function() {
  var ISSUED_GENERATION = __GENERATION__;

  if (window.__stoBrowserAutomation && window.__stoBrowserAutomation.buildObservation) {
    if (typeof ISSUED_GENERATION === 'number' && window.__stoBrowserAutomation.noteGeneration) {
      window.__stoBrowserAutomation.noteGeneration(ISSUED_GENERATION);
    }
    return window.__stoBrowserAutomation.buildObservation();
  }

  var refCounter = 1;
  var refMap = new Map();
  var ELEMENT_LIMIT = __ELEMENT_LIMIT__;
  /** 主进程最近一次 observe 链路颁发的代际号；null 表示本页尚未被颁发（直接脚本调用等场景跳过校验）。 */
  var lastIssuedGeneration = null;
  var dialogHooksInstalled = false;
  var dialogPolicy = 'auto-dismiss';
  var pageDialogLog = [];
  var clickProbe = null;
  var clickProbeListener = null;

  function simpleHash(input) {
    var h = 2166136261;
    for (var i = 0; i < input.length; i++) {
      h ^= input.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return ('0000000' + (h >>> 0).toString(16)).slice(-8);
  }

  function currentNavEpoch() {
    var origin = (typeof performance !== 'undefined' && performance && performance.timeOrigin)
      ? performance.timeOrigin
      : 0;
    return simpleHash(location.href + '|' + origin);
  }

  /** 主进程颁发代际号（仅 observe 链路注入；act 链路不注入以免污染校验基准）。 */
  function noteGeneration(generation) {
    if (typeof generation === 'number' && isFinite(generation)) {
      lastIssuedGeneration = generation;
    }
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

  /** 元素摘要描述（遮挡上报用）：tag#id.classA.classB。 */
  function describeNode(node) {
    if (!node || !node.tagName) return 'unknown';
    var desc = node.tagName.toLowerCase();
    if (node.id) desc += '#' + node.id;
    var cls = node.className;
    if (cls && typeof cls === 'string') {
      var parts = cls.trim().split(/\\s+/).slice(0, 2);
      if (parts.length && parts[0]) desc += '.' + parts.join('.');
    }
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
      navEpoch: currentNavEpoch(),
    };
  }

  /**
   * 代际兜底校验（主校验在 B4 主进程侧）：payload.generation 与最近一次 observe
   * 链路颁发的代际不一致 → { staleRef: true }，供上层映射 STALE_REF。
   * lastIssuedGeneration 为 null（页内脚本被直接调用、灰度期）时跳过校验。
   */
  function resolveTarget(payload) {
    buildObservation();
    if (payload && typeof payload.generation === 'number'
      && typeof lastIssuedGeneration === 'number'
      && payload.generation !== lastIssuedGeneration) {
      return { staleRef: true };
    }
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
    if (target && target.staleRef) {
      return { success: false, action: action, staleRef: true, error: 'Stale element reference: re-observe required' };
    }
    if (!target) return { success: false, error: 'Element not found' };
    var el = target.node;
    el.scrollIntoView({ behavior: 'instant', block: 'center', inline: 'center' });
    if (action === 'click') {
      // 遮挡检测：元素中心点 elementFromPoint 命中非目标/非祖先 → 上报 occluded + occluder
      // （JS click 仍执行；是否降级 CDP 真实点击由上层 actClickWithFallback 决策）。
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
        action: action,
        ref: payload.ref,
        stableKey: target.stableKey,
        occluded: occluded,
        occluder: occluder,
      };
    }
    if (action === 'fill') {
      // 统一走 fillWithNativeSetter（原型 setter 绕过 React 受控组件 + contenteditable 双路径）
      fillWithNativeSetter(el, payload.value || '');
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

  function readTargetValue(target) {
    var el = target.node;
    if ('value' in el) return String(el.value || '');
    if (el.isContentEditable) return (el.textContent || '').trim();
    return (el.textContent || '').trim();
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

  /**
   * 真实输入目标解析（fill/press 前置）：
   * - document.visibilityState === 'hidden' → pageNotVisible（B7 页内可见性守卫）；
   * - scrollIntoView 后目标中心点须在 viewport 内 → outsideViewport；
   * - 代际不一致 → staleRef（resolveTarget 兜底）。
   */
  function resolveTargetForInput(payload) {
    var visibilityState = document.visibilityState || 'visible';
    if (visibilityState === 'hidden') {
      return {
        found: false,
        error: 'Page is not visible (visibilityState: ' + visibilityState + ')',
        pageNotVisible: true,
      };
    }
    var target = resolveTarget(payload);
    if (target && target.staleRef) {
      return { found: false, error: 'Stale element reference: re-observe required', staleRef: true };
    }
    if (!target) return { found: false, error: 'Element not found' };
    var el = target.node;
    el.scrollIntoView({ behavior: 'instant', block: 'center', inline: 'center' });
    var rect = el.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) {
      return { found: false, error: 'Element is not visible' };
    }
    var centerX = rect.left + rect.width / 2;
    var centerY = rect.top + rect.height / 2;
    var viewportW = window.innerWidth || 0;
    var viewportH = window.innerHeight || 0;
    if (viewportW > 0 && viewportH > 0
      && (centerX < 0 || centerY < 0 || centerX > viewportW || centerY > viewportH)) {
      return { found: false, error: 'Element center is outside the viewport', outsideViewport: true };
    }
    var ref = null;
    for (var pair of refMap.entries()) {
      if (pair[1].node === el) {
        ref = pair[0];
        break;
      }
    }
    return {
      found: true,
      ref: ref,
      stableKey: target.stableKey,
      centerX: centerX,
      centerY: centerY,
      value: readTargetValue(target),
      editable: !!(el.matches && el.matches('input, textarea, select, [contenteditable=""], [contenteditable="true"], [role="textbox"]')),
      disabled: !!(el.disabled || el.getAttribute('aria-disabled') === 'true'),
      readonly: !!(el.readOnly || el.hasAttribute('readonly') || el.getAttribute('aria-readonly') === 'true'),
    };
  }

  function readTargetInputValue(payload) {
    var target = resolveTarget(payload);
    if (target && target.staleRef) {
      return { found: false, error: 'Stale element reference: re-observe required', staleRef: true };
    }
    if (!target) return { found: false, error: 'Element not found' };
    return { found: true, value: readTargetValue(target), stableKey: target.stableKey };
  }

  function nativeFillTarget(payload) {
    var target = resolveTarget(payload);
    if (target && target.staleRef) {
      return { success: false, error: 'Stale element reference: re-observe required', staleRef: true };
    }
    if (!target) return { success: false, error: 'Element not found' };
    fillWithNativeSetter(target.node, payload.value || '');
    return {
      success: true,
      value: readTargetValue(target),
      stableKey: target.stableKey,
    };
  }

  // ── JS dialog 页内 hooks（B2 降级路径：CDP Page 域不可用时接管 alert/confirm/prompt）──

  function recordPageDialog(type, message, defaultValue, handled) {
    pageDialogLog.push({
      type: type,
      message: String(message == null ? '' : message),
      defaultValue: defaultValue == null ? undefined : String(defaultValue),
      handled: handled,
      at: Date.now(),
    });
    while (pageDialogLog.length > 50) pageDialogLog.shift();
  }

  /**
   * wrap alert/confirm/prompt：记录 + 按策略返回。record-only 不接管（透传原生函数仅记录）。
   * 风险：改写页面原生函数；beforeunload 对话框无法页内接管（由主进程 will-prevent-unload 兜底）。
   */
  function installDialogHooks(policy) {
    if (policy === 'auto-accept' || policy === 'auto-dismiss' || policy === 'record-only') {
      dialogPolicy = policy;
    }
    if (dialogHooksInstalled) return true;
    dialogHooksInstalled = true;
    var nativeAlert = window.alert;
    var nativeConfirm = window.confirm;
    var nativePrompt = window.prompt;
    window.alert = function(message) {
      if (dialogPolicy === 'record-only') {
        recordPageDialog('alert', message, undefined, 'auto');
        return nativeAlert.call(window, message);
      }
      recordPageDialog('alert', message, undefined, dialogPolicy === 'auto-accept' ? 'accepted' : 'dismissed');
    };
    window.confirm = function(message) {
      if (dialogPolicy === 'record-only') {
        recordPageDialog('confirm', message, undefined, 'auto');
        return nativeConfirm.call(window, message);
      }
      var accept = dialogPolicy === 'auto-accept';
      recordPageDialog('confirm', message, undefined, accept ? 'accepted' : 'dismissed');
      return accept;
    };
    window.prompt = function(message, defaultValue) {
      if (dialogPolicy === 'record-only') {
        recordPageDialog('prompt', message, defaultValue, 'auto');
        return nativePrompt.call(window, message, defaultValue);
      }
      var acceptPrompt = dialogPolicy === 'auto-accept';
      recordPageDialog('prompt', message, defaultValue, acceptPrompt ? 'accepted' : 'dismissed');
      return acceptPrompt ? (defaultValue == null ? '' : String(defaultValue)) : null;
    };
    return true;
  }

  function drainDialogs() {
    var out = pageDialogLog;
    pageDialogLog = [];
    return out;
  }

  // ── 点击投递探针（波次 2 actClickWithFallback 消费：JS click 后验证事件是否真实命中目标）──

  function removeClickProbeListener() {
    if (!clickProbeListener) return;
    window.removeEventListener('pointerdown', clickProbeListener, true);
    window.removeEventListener('click', clickProbeListener, true);
    clickProbeListener = null;
  }

  /** 在 window 捕获阶段挂一次性 pointerdown/click listener，记录事件目标链。 */
  function installClickProbe(payload) {
    removeClickProbeListener();
    var expectedNode = null;
    if (payload && (payload.ref || payload.stableKey || payload.name)) {
      var target = resolveTarget(payload);
      if (target && !target.staleRef && target.node) expectedNode = target.node;
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

  /** targetMatched = 事件目标链包含期望元素（链本身是祖先链，天然覆盖 interactiveAncestor 上溯）。 */
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

  /**
   * 截图 clip 目标解析（B4 captureScreenshot 的 ref→clip 路径）：
   * resolveTarget → scrollIntoView → 文档坐标 rect（x/y 含 scroll 偏移，供 Page.captureScreenshot clip）。
   */
  function getElementPageRect(payload) {
    var target = resolveTarget(payload);
    if (target && target.staleRef) {
      return { found: false, error: 'Stale element reference: re-observe required', staleRef: true };
    }
    if (!target) return { found: false, error: 'Element not found' };
    var el = target.node;
    el.scrollIntoView({ behavior: 'instant', block: 'center', inline: 'center' });
    var rect = el.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) {
      return { found: false, error: 'Element is not visible' };
    }
    return {
      found: true,
      rect: {
        x: Math.round(rect.left + (window.scrollX || window.pageXOffset || 0)),
        y: Math.round(rect.top + (window.scrollY || window.pageYOffset || 0)),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      },
      stableKey: target.stableKey,
    };
  }

  window.__stoBrowserAutomation = {
    buildObservation: buildObservation,
    act: act,
    resolveTarget: resolveTarget,
    resolveTargetForInput: resolveTargetForInput,
    readTargetInputValue: readTargetInputValue,
    nativeFillTarget: nativeFillTarget,
    noteGeneration: noteGeneration,
    installDialogHooks: installDialogHooks,
    drainDialogs: drainDialogs,
    installClickProbe: installClickProbe,
    readClickProbe: readClickProbe,
    getElementPageRect: getElementPageRect,
  };

  if (typeof ISSUED_GENERATION === 'number') {
    noteGeneration(ISSUED_GENERATION);
  }

  return buildObservation();
})()`;

/**
 * 构建页内注入脚本。
 * @param elementLimit 元素上限。
 * @param generation 主进程颁发的代际号（仅 observe 链路传入，页内记录供 resolveTarget
 *                   兜底校验；act/wait 链路不传，避免污染校验基准）。
 */
export function buildObserveScript(elementLimit: number, generation?: number): string {
  return BROWSER_AUTOMATION_OBSERVE_SCRIPT
    .replace('__ELEMENT_LIMIT__', String(elementLimit))
    .replace('__GENERATION__', typeof generation === 'number' ? String(Math.trunc(generation)) : 'null');
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
