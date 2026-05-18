---
name: claw-render-base
version: 1.0.0
description: 定义 Claw 生成页面的基础渲染标准，包括 HTML 骨架、CSS 变量系统、响应式断点、打印样式和主题切换。
author: sto
tags: [platform, render, base, standard]
---

# claw-render-base

## 职责

让所有通过 Claw 生成的 HTML 页面具备统一的基础视觉标准，避免每个业务 Skill 各自为战。

## 输入

业务内容（HTML 片段、表格、文字）。

## 输出

- `templates/base.html` — 标准 HTML 模板
- `static/claw-base.css` — 基础样式（变量系统、响应式、字体、间距、打印样式）

## 标准规范

### HTML 骨架

```html
<!DOCTYPE html>
<html data-claw-version="1.0">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <link rel="stylesheet" href="claw-base.css">
</head>
<body class="claw-page">
  <main class="claw-container">
    <!-- 业务内容插在这里 -->
  </main>
</body>
</html>
```

### 容器标准

| 项 | 标准值 | 说明 |
|---|---|---|
| 容器最大宽度 | `1200px` | 桌面端居中 |
| 容器内边距 | `24px` | 左右留白 |
| 基础字体大小 | `14px` | 正文 |
| 行高 | `1.6` | 正文 |
| 移动端断点 | `768px` | 小于此宽度自动适配 |
| 颜色变量 | CSS 自定义属性 | `--claw-primary`, `--claw-text`, `--claw-bg` 等 |
| 打印优化 | A4 适配 | `@media print` 隐藏无关元素 |
| 主题切换 | `data-theme` | `light` / `dark` |

### 业务 Skill 使用方式

在生成 HTML 时，将业务内容插入 `base.html` 的 `.claw-container` 中，并引用 `claw-base.css`。
