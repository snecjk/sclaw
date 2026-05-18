---
name: daily-report
version: 1.0.0
description: 生成日报 HTML 页面。从 CLI 取数，组装业务内容，引用 claw-render-base 和 claw-editable 标准，输出可编辑的日报页面。
author: sto
tags: [business, report, daily, html]
---

# daily-report

## 职责

生成日报 HTML 文件。支持数据表格、文字描述和图表，生成的页面可在 Claw 中预览和编辑。

## 输入

CLI 取数结果（JSON 格式）：
```json
{
  "date": "2026-05-13",
  "title": "日报",
  "regions": [
    {"name": "江苏", "growth": "-28.1 万", "rate": "-5.1%"},
    {"name": "浙江", "growth": "-4.4 万", "rate": "-0.9%"}
  ]
}
```

## 输出

- `daily-report.html` — 最终可编辑页面

## 依赖

- `claw-render-base` — 基础渲染标准
- `claw-editable` — 可编辑标记标准
- `claw-archiver` — 保存归档标准（通过 meta 标签引用）

## 生成流程

1. 调用 CLI 取数 → 得到数据 JSON
2. 组装业务内容：
   - 标题（可编辑）
   - 数据表格（单元格可编辑）
   - 文字描述（可编辑）
   - 趋势图表（不可编辑，受保护）
3. 套入 `claw-render-base/templates/base.html`
4. 按 `claw-editable` 规范标记可编辑区域
5. 注入 `claw-archiver` 的 meta 标签
6. 输出 HTML 文件到 workspace

## 生成的 HTML 示例结构

```html
<!DOCTYPE html>
<html data-claw-editable="true" data-claw-version="1.0" data-theme="light">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="claw:save-mode" content="manual">
  <meta name="claw:save-dir" content="{workspace}/{date}">
  <meta name="claw:version-format" content="v{N}">
  <meta name="claw:filename" content="daily-report">
  <title>2026-05-13 日报</title>
  <link rel="stylesheet" href="claw-base.css">
  <link rel="stylesheet" href="claw-editor.css">
</head>
<body class="claw-page">
  <main class="claw-container">
    <!-- 标题：可编辑 -->
    <h1 data-editable="text">2026-05-13 业务日报</h1>
    
    <!-- 数据表格：单元格可编辑 -->
    <table>
      <thead>
        <tr>
          <th>省份</th>
          <th>增长量</th>
          <th>增长率</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>江苏</td>
          <td data-editable="cell">-28.1 万</td>
          <td data-editable="cell">-5.1%</td>
        </tr>
        <tr>
          <td>浙江</td>
          <td data-editable="cell">-4.4 万</td>
          <td data-editable="cell">-0.9%</td>
        </tr>
      </tbody>
    </table>
    
    <!-- 文字描述：可编辑 -->
    <p data-editable="rich">今日整体业务量较昨日有所下滑，主要受...</p>
    
    <!-- 图表：不可编辑（受保护） -->
    <div data-editable="false">
      <canvas id="trend-chart"></canvas>
    </div>
  </main>
  <script src="claw-editor.js"></script>
</body>
</html>
```

## 可编辑区域说明

| 元素 | 标记 | 说明 |
|---|---|---|
| 标题 | `data-editable="text"` | 用户可修改标题文字 |
| 表格单元格 | `data-editable="cell"` | 用户可修改数值 |
| 文字描述 | `data-editable="rich"` | 用户可修改段落内容 |
| 趋势图表 | `data-editable="false"` | 保护图表，不可编辑 |
