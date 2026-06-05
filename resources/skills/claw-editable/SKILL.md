---
name: claw-editable
version: 1.0.0
description: 定义 Claw 生成页面的可编辑标准，包括编辑区域标记规范、编辑交互逻辑和编辑态视觉反馈。
author: sto
tags: [platform, editable, editor, standard]
---

# claw-editable

## 职责

让业务 Skill 生成的 HTML 页面具备可编辑能力。业务 Skill 只需在生成 HTML 时按规范添加标记，Claw 前端自动识别并提供编辑交互。

## 输入

业务生成的 HTML 内容。

## 输出

- `static/claw-editor.js` — 编辑交互脚本（编辑模式切换、内容提取）
- `static/claw-editor.css` — 编辑态样式（高亮、边框、hover 提示）
- `EDITABLE_GUIDE.md` — 标记规范文档

## 标记规范

### 页面级标记（由业务 Skill 在生成时注入）

```html
<html data-claw-editable="true">
```

### 可编辑区域标记

| 标记 | 说明 | 示例 |
|---|---|---|
| `data-editable="text"` | 纯文本可编辑（标题、段落） | `<h1 data-editable="text">标题</h1>` |
| `data-editable="cell"` | 表格单元格可编辑 | `<td data-editable="cell">2.6%</td>` |
| `data-editable="rich"` | 富文本可编辑（多行、简单格式） | `<div data-editable="rich">描述</div>` |
| `data-editable="false"` | 明确不可编辑（图表、图片保护） | `<div data-editable="false"><canvas></canvas></div>` |

### 默认行为

- 未标记 `data-editable` 的元素：**不可编辑**（安全优先）
- 业务 Skill 需显式标记可编辑区域

## 使用方式

业务 Skill 生成 HTML 时：
1. 在 `<html>` 上加 `data-claw-editable="true"`
2. 给需要编辑的元素加 `data-editable="text|cell|rich"`
3. 给图表、图片等加 `data-editable="false"`（可选，明确保护）
4. 在页面底部引入 `claw-editor.js` 和 `claw-editor.css`

```html
<!DOCTYPE html>
<html data-claw-editable="true">
<head>
  <link rel="stylesheet" href="claw-base.css">
  <link rel="stylesheet" href="claw-editor.css">
</head>
<body>
  <h1 data-editable="text">日报标题</h1>
  <table>
    <tr><td data-editable="cell">2.6%</td></tr>
  </table>
  <div data-editable="false"><canvas id="chart"></canvas></div>
  <script src="claw-editor.js"></script>
</body>
</html>
```

## Claw 前端识别逻辑

```ts
const isEditable = doc.documentElement.getAttribute('data-claw-editable') === 'true';
const editableElements = doc.querySelectorAll('[data-editable="text"], [data-editable="cell"], [data-editable="rich"]');
```
