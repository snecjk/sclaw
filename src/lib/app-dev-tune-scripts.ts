/**
 * 预览页注入脚本：主题 token 读写 + 元素圈选（T06/T07）。
 * 经 SclawBrowserFrame.executeJS 执行；事件经 console.info('__SCLAW_TUNE_EVENT__' + JSON) 回传。
 */

export const SCLAW_TUNE_EVENT_PREFIX = '__SCLAW_TUNE_EVENT__';

/** 批量读取 :root 上的 CSS 变量值。names 为 ['--sto-color-primary', ...] */
export function buildReadTokensScript(names: string[]): string {
  const payload = JSON.stringify(names);
  return `(function(){
  var names = ${payload};
  var style = getComputedStyle(document.documentElement);
  var out = {};
  for (var i = 0; i < names.length; i++) {
    var n = names[i];
    out[n] = (style.getPropertyValue(n) || '').trim();
  }
  return out;
})()`;
}

/** 批量覆写 :root 内联 style（即时生效、不改文件）。 */
export function buildApplyTokenOverridesScript(overrides: Record<string, string>): string {
  const payload = JSON.stringify(overrides);
  return `(function(){
  var overrides = ${payload};
  var root = document.documentElement;
  var keys = Object.keys(overrides);
  for (var i = 0; i < keys.length; i++) {
    var k = keys[i];
    var v = overrides[k];
    if (v == null || v === '') root.style.removeProperty(k);
    else root.style.setProperty(k, v);
  }
  return true;
})()`;
}

/** 清除全部内联覆写（重置到 theme.css）。 */
export function buildClearTokenOverridesScript(names: string[]): string {
  const payload = JSON.stringify(names);
  return `(function(){
  var names = ${payload};
  var root = document.documentElement;
  for (var i = 0; i < names.length; i++) root.style.removeProperty(names[i]);
  return true;
})()`;
}

/**
 * 元素圈选脚本：挂载一次即可；重复执行会先 teardown。
 * 事件：hover / select / multi-select / cancel
 */
export const ELEMENT_PICKER_SCRIPT = `(function(){
  var PREFIX = ${JSON.stringify(SCLAW_TUNE_EVENT_PREFIX)};
  var NS = '__sclawTunePicker';
  if (window[NS] && typeof window[NS].teardown === 'function') {
    try { window[NS].teardown(); } catch (e) {}
  }

  function emit(type, payload) {
    try {
      console.info(PREFIX + JSON.stringify({ type: type, payload: payload || null }));
    } catch (e) {}
  }

  function cssPath(el) {
    if (!el || el.nodeType !== 1) return '';
    if (el.id) return '#' + CSS.escape(el.id);
    var testId = el.getAttribute && el.getAttribute('data-testid');
    if (testId) return '[data-testid="' + String(testId).replace(/"/g, '\\\\"') + '"]';
    var parts = [];
    var cur = el;
    var depth = 0;
    while (cur && cur.nodeType === 1 && depth < 5 && cur !== document.documentElement) {
      var tag = (cur.tagName || '').toLowerCase();
      if (!tag) break;
      var parent = cur.parentElement;
      if (!parent) {
        parts.unshift(tag);
        break;
      }
      var siblings = parent.children;
      var same = 0;
      var index = 0;
      for (var i = 0; i < siblings.length; i++) {
        if ((siblings[i].tagName || '').toLowerCase() === tag) {
          same++;
          if (siblings[i] === cur) index = same;
        }
      }
      parts.unshift(same > 1 ? tag + ':nth-of-type(' + index + ')' : tag);
      if (cur.id || (cur.getAttribute && cur.getAttribute('data-testid'))) break;
      cur = parent;
      depth++;
    }
    return parts.join(' > ');
  }

  function styleSummary(el) {
    var s = getComputedStyle(el);
    return {
      color: s.color,
      background: s.backgroundColor,
      fontSize: s.fontSize,
      padding: s.padding,
      margin: s.margin,
      borderRadius: s.borderRadius
    };
  }

  function makeOverlay(kind) {
    var node = document.createElement('div');
    node.setAttribute('data-sclaw-picker-overlay', kind);
    node.style.cssText = kind === 'select'
      ? 'position:fixed;pointer-events:none;z-index:2147483646;outline:2px solid #FF6F00;background:rgba(255,111,0,0.10);display:none;box-sizing:border-box;'
      : 'position:fixed;pointer-events:none;z-index:2147483645;outline:1px solid rgba(255,111,0,0.7);background:rgba(255,111,0,0.04);display:none;box-sizing:border-box;';
    var tag = document.createElement('div');
    tag.setAttribute('data-sclaw-picker-label', '1');
    tag.style.cssText = 'position:absolute;left:0;top:-18px;height:16px;padding:0 6px;border-radius:4px 4px 0 0;background:#FF6F00;color:#fff;font:11px/16px ui-monospace,SFMono-Regular,Menlo,monospace;white-space:nowrap;max-width:220px;overflow:hidden;text-overflow:ellipsis;';
    node.appendChild(tag);
    document.documentElement.appendChild(node);
    return { node: node, tag: tag };
  }

  var hoverBox = makeOverlay('hover');
  var selectBox = makeOverlay('select');

  var selected = [];
  var selectedSet = new Set();
  var raf = 0;
  var lastTarget = null;

  function placeOverlay(box, el, label) {
    if (!el || !el.getBoundingClientRect) {
      box.node.style.display = 'none';
      return;
    }
    var r = el.getBoundingClientRect();
    box.node.style.display = 'block';
    box.node.style.left = r.left + 'px';
    box.node.style.top = r.top + 'px';
    box.node.style.width = Math.max(0, r.width) + 'px';
    box.node.style.height = Math.max(0, r.height) + 'px';
    box.tag.textContent = label || '';
    box.tag.style.display = label ? 'block' : 'none';
  }

  function rectOf(el) {
    var r = el.getBoundingClientRect();
    return { left: r.left, top: r.top, width: r.width, height: r.height };
  }

  function describe(el) {
    var selector = cssPath(el);
    return {
      selector: selector,
      tag: (el.tagName || '').toLowerCase(),
      text: (el.innerText || '').trim().slice(0, 80),
      styles: styleSummary(el),
      rect: rectOf(el)
    };
  }

  function pinSelection(el) {
    var label = cssPath(el);
    if (label.length > 28) label = label.slice(0, 26) + '…';
    placeOverlay(selectBox, el, label);
  }

  function onMove(ev) {
    var t = ev.target;
    if (!t || (t.getAttribute && t.getAttribute('data-sclaw-picker-overlay'))) return;
    lastTarget = t;
    if (raf) return;
    raf = requestAnimationFrame(function(){
      raf = 0;
      placeOverlay(hoverBox, lastTarget, '');
      emit('hover', { selector: cssPath(lastTarget), tag: (lastTarget.tagName || '').toLowerCase() });
    });
  }

  function onClick(ev) {
    ev.preventDefault();
    ev.stopPropagation();
    var t = ev.target;
    if (!t || (t.getAttribute && t.getAttribute('data-sclaw-picker-overlay'))) return;
    var selector = cssPath(t);
    var entry = describe(t);
    if (ev.metaKey || ev.ctrlKey) {
      if (selectedSet.has(selector)) {
        selected = selected.filter(function(x){ return x.selector !== selector; });
        selectedSet.delete(selector);
      } else {
        selected.push(entry);
        selectedSet.add(selector);
      }
      emit('select', { multi: true, elements: selected.slice() });
    } else {
      selected = [entry];
      selectedSet = new Set([selector]);
      emit('select', { multi: false, elements: selected.slice() });
    }
    pinSelection(t);
  }

  function onKey(ev) {
    if (ev.key === 'Escape') {
      teardown();
      emit('cancel', null);
    }
  }

  function teardown() {
    document.removeEventListener('mousemove', onMove, true);
    document.removeEventListener('click', onClick, true);
    document.removeEventListener('keydown', onKey, true);
    if (hoverBox.node.parentNode) hoverBox.node.parentNode.removeChild(hoverBox.node);
    if (selectBox.node.parentNode) selectBox.node.parentNode.removeChild(selectBox.node);
    if (raf) cancelAnimationFrame(raf);
    delete window[NS];
  }

  document.addEventListener('mousemove', onMove, true);
  document.addEventListener('click', onClick, true);
  document.addEventListener('keydown', onKey, true);
  window[NS] = { teardown: teardown, active: true };
  emit('ready', null);
  return true;
})()`;

export const ELEMENT_PICKER_TEARDOWN_SCRIPT = `(function(){
  var NS = '__sclawTunePicker';
  if (window[NS] && typeof window[NS].teardown === 'function') {
    window[NS].teardown();
    return true;
  }
  return false;
})()`;
