/**
 * claw-editor.js
 * Claw 可编辑页面编辑交互脚本 v1.0
 * 职责：编辑模式切换、可编辑元素管理、内容提取
 */

(function () {
  'use strict';

  const SELECTORS = '[data-editable="text"], [data-editable="cell"], [data-editable="rich"]';

  function enterEditMode() {
    document.body.classList.add('claw-editing');
    document.querySelectorAll(SELECTORS).forEach((el) => {
      el.setAttribute('contenteditable', 'true');
    });
  }

  function exitEditMode() {
    document.body.classList.remove('claw-editing');
    document.querySelectorAll(SELECTORS).forEach((el) => {
      el.removeAttribute('contenteditable');
    });
  }

  function isEditing() {
    return document.body.classList.contains('claw-editing');
  }

  function getEditedContent() {
    return document.documentElement.outerHTML;
  }

  // 暴露全局接口（Claw 前端通过 iframe.contentWindow 调用）
  window.clawEditor = {
    enterEditMode,
    exitEditMode,
    isEditing,
    getEditedContent,
  };
})();
