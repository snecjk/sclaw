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

export type AppDevElementLivePatch = {
  styles?: Record<string, string>;
  text?: string;
  src?: string;
  alt?: string;
  cascadeAlign?: boolean;
};

/** 按选择器覆写选中节点的样式 / 文案 / 图片（即时预览，不改文件）。 */
export function buildApplyElementPatchScript(selector: string, patch: AppDevElementLivePatch): string {
  return `(function(){
  var selector = ${JSON.stringify(selector)};
  var patch = ${JSON.stringify(patch)};
  var el = document.querySelector(selector);
  if (!el) return { ok: false, reason: 'missing' };
  var styles = patch.styles || {};
  var keys = Object.keys(styles);
  function paint(node) {
    if (!node || !node.style) return;
    for (var i = 0; i < keys.length; i++) {
      var k = keys[i];
      var v = styles[k];
      if (v == null || v === '') node.style.removeProperty(k);
      else node.style.setProperty(k, v, 'important');
    }
  }
  paint(el);
  if (styles['background-color'] || styles.background) {
    var child = el.firstElementChild;
    if (child) {
      var er = el.getBoundingClientRect();
      var cr = child.getBoundingClientRect();
      if (er.width > 0 && cr.width >= er.width * 0.7 && cr.height >= er.height * 0.4) paint(child);
    }
  }
  function applyAlign(node, textAlign, justify) {
    if (textAlign) node.style.setProperty('text-align', textAlign, 'important');
    else node.style.removeProperty('text-align');
    var display = getComputedStyle(node).display;
    if (justify && (display === 'flex' || display === 'inline-flex' || display === 'grid' || styles.display === 'flex')) {
      node.style.setProperty('justify-content', justify, 'important');
    } else if (!justify) {
      node.style.removeProperty('justify-content');
    }
    if (textAlign && (display === 'grid' || styles.display === 'flex')) {
      node.style.setProperty('justify-items', textAlign, 'important');
    }
  }
  if (patch.cascadeAlign) {
    var textAlign = styles['text-align'] || '';
    var justify = styles['justify-content'] || '';
    applyAlign(el, textAlign, justify);
    var kids = el.querySelectorAll('div,span,p,h1,h2,h3,h4,h5,h6,a,button,label,td,th,li,section,header,article');
    for (var j = 0; j < kids.length; j++) applyAlign(kids[j], textAlign, justify);
  }
  function setText(node, text) {
    if (node.childElementCount === 0) {
      node.textContent = text;
      return;
    }
    var child = node.firstChild;
    while (child) {
      if (child.nodeType === 3 && String(child.textContent || '').trim()) {
        child.textContent = text;
        return;
      }
      child = child.nextSibling;
    }
    var nested = node.querySelector('span,p,h1,h2,h3,h4,h5,h6,label,a,button,strong,em');
    if (nested && nested.childElementCount === 0) {
      nested.textContent = text;
      return;
    }
    node.textContent = text;
  }
  if (typeof patch.text === 'string') setText(el, patch.text);
  if (typeof patch.src === 'string' && 'src' in el) el.src = patch.src;
  if (typeof patch.alt === 'string' && 'alt' in el) el.alt = patch.alt;
  return { ok: true };
})()`;
}

/**
 * 元素圈选脚本：挂载一次即可；重复执行会先 teardown。
 * inspect：Esc 卸载圈选；tune：Esc 只清空选区。
 */
export function buildElementPickerScript(mode: 'inspect' | 'tune' = 'inspect'): string {
  return `(function(){
  var PREFIX = ${JSON.stringify(SCLAW_TUNE_EVENT_PREFIX)};
  var MODE = ${JSON.stringify(mode)};
  var NS = '__sclawTunePicker';
  if (window[NS] && typeof window[NS].teardown === 'function') {
    try { window[NS].teardown(); } catch (e) {}
  }

  function emit(type, payload) {
    try {
      console.info(PREFIX + JSON.stringify({ type: type, payload: payload || null }));
    } catch (e) {}
  }

  function closestStamp(el) {
    var cur = el;
    while (cur && cur.nodeType === 1) {
      var id = cur.getAttribute && cur.getAttribute('data-a2ui-component-id');
      if (id) {
        var host = cur.closest ? cur.closest('[data-a2ui-page-id],[data-a2ui-surface-id]') : null;
        return {
          a2uiComponentId: id,
          a2uiComponent: cur.getAttribute('data-a2ui-component') || '',
          a2uiSurfaceId: (cur.getAttribute('data-a2ui-surface-id') || (host && host.getAttribute('data-a2ui-surface-id')) || ''),
          a2uiPageId: (host && host.getAttribute('data-a2ui-page-id')) || ''
        };
      }
      cur = cur.parentElement;
    }
    var page = el.closest ? el.closest('[data-a2ui-page-id]') : null;
    if (page) return { a2uiPageId: page.getAttribute('data-a2ui-page-id') || '' };
    return null;
  }

  function cssPath(el) {
    if (!el || el.nodeType !== 1) return '';
    if (el.id) return '#' + CSS.escape(el.id);
    var testId = el.getAttribute && el.getAttribute('data-testid');
    if (testId) return '[data-testid="' + String(testId).replace(/"/g, '\\\\"') + '"]';
    var stamp = closestStamp(el);
    if (stamp && stamp.a2uiComponentId) {
      return '[data-a2ui-component-id="' + String(stamp.a2uiComponentId).replace(/"/g, '\\\\"') + '"]';
    }
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
      fontWeight: s.fontWeight,
      fontFamily: s.fontFamily,
      textAlign: s.textAlign,
      lineHeight: s.lineHeight,
      padding: s.padding,
      paddingTop: s.paddingTop,
      paddingRight: s.paddingRight,
      paddingBottom: s.paddingBottom,
      paddingLeft: s.paddingLeft,
      margin: s.margin,
      marginTop: s.marginTop,
      marginRight: s.marginRight,
      marginBottom: s.marginBottom,
      marginLeft: s.marginLeft,
      borderRadius: s.borderRadius,
      borderWidth: s.borderWidth,
      borderColor: s.borderColor,
      objectFit: s.objectFit,
      display: s.display,
      gap: s.gap,
      justifyContent: s.justifyContent,
      alignItems: s.alignItems,
      flexDirection: s.flexDirection,
      flexWrap: s.flexWrap,
      width: s.width,
      height: s.height,
      opacity: s.opacity
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
    var tag = (el.tagName || '').toLowerCase();
    var src = '';
    var alt = '';
    var href = '';
    if (tag === 'img') {
      src = el.currentSrc || el.getAttribute('src') || '';
      alt = el.getAttribute('alt') || '';
    } else {
      var bg = getComputedStyle(el).backgroundImage;
      var m = bg && bg.match(/url\\(["']?([^"')]+)["']?\\)/);
      if (m) src = m[1];
    }
    if (tag === 'a') href = el.getAttribute('href') || '';
    var stamp = closestStamp(el) || {};
    return {
      selector: cssPath(el),
      tag: tag,
      text: (el.innerText || '').trim().slice(0, 80),
      styles: styleSummary(el),
      rect: rectOf(el),
      src: src,
      alt: alt,
      href: href,
      a2uiPageId: stamp.a2uiPageId || '',
      a2uiSurfaceId: stamp.a2uiSurfaceId || '',
      a2uiComponentId: stamp.a2uiComponentId || '',
      a2uiComponent: stamp.a2uiComponent || ''
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

  function clearSelection() {
    selected = [];
    selectedSet = new Set();
    selectBox.node.style.display = 'none';
    emit('select', { multi: false, elements: [] });
  }

  function onKey(ev) {
    if (ev.key !== 'Escape') return;
    if (MODE === 'tune') {
      clearSelection();
      return;
    }
    teardown();
    emit('cancel', null);
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
}

export const ELEMENT_PICKER_SCRIPT = buildElementPickerScript('inspect');

export const ELEMENT_PICKER_TEARDOWN_SCRIPT = `(function(){
  var NS = '__sclawTunePicker';
  if (window[NS] && typeof window[NS].teardown === 'function') {
    window[NS].teardown();
    return true;
  }
  return false;
})()`;
