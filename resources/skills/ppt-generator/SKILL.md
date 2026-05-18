---
name: ppt-generator
description: 通用 PPT HTML 报告生成器。根据模板配置和数据源，生成可上下滑动查看的多页面 PPT 风格 HTML 报告。支持折线图、柱状图、表格等多种图表类型，支持多列布局和侧边栏布局。
version: 1.0.0
trigger: 被其他 skill 调用，或用户明确要求使用 ppt-generator 生成报告
title: 通用 PPT 生成器
---

# 通用 PPT 生成器

**技能名称**: ppt-generator
**技能描述**: 通用 PPT HTML 报告生成器，模板驱动，数据源无关
**版本**: 1.0.0

---

## 核心定位

本 skill **不负责查询数据**，只负责：
1. 读取模板配置（JSON）
2. 读取数据源（JSON 文件）
3. 根据模板渲染成 HTML PPT 报告

它是纯"表现层" skill，需要由编排 skill 调用。

---

## 触发条件

通常由其他 skill 调用，不直接响应用户自然语言。但如果用户明确说：
- "用 ppt-generator 生成报告"
- "根据这些数据生成 PPT"

则直接触发。

---

## 执行参数

```bash
uv run python scripts/generate.py \
  --config <template.json> \
  --data-dir <data_directory> \
  --output <output.html>
```

| 参数 | 必填 | 说明 |
|------|------|------|
| `--config` | 是 | 模板配置文件路径（JSON） |
| `--data-dir` | 是 | 数据目录，内含 `<data_key>.json` 文件 |
| `--output` | 否 | 输出 HTML 路径，默认自动生成 |

---

## 模板配置格式

```json
{
  "name": "报告名称",
  "pages": [
    {
      "id": 1,
      "title": "页面标题",
      "layout": "multi-column",
      "columns": 3,
      "sections": [
        {
          "title": "图表标题",
          "type": "line-chart",
          "data_source": "market",
          "fields": ["field1", "field2"],
          "labels": ["系列1", "系列2"],
          "colors": ["#ff6600", "#00aa00"],
          "y_formatter": "percent",
          "info_text": "底部说明文字，支持 {{变量}}"
        }
      ]
    },
    {
      "id": 2,
      "title": "表格页",
      "layout": "table-with-sidebar",
      "table": {
        "data_source": "process",
        "columns": [
          {"field": "name", "title": "名称", "format": "text"},
          {"field": "rate", "title": "达成率", "format": "rate", "colorize": true}
        ],
        "row_filter": "...",
        "row_sort": "..."
      },
      "sidebar": [
        {"title": "说明", "content": "文本内容"}
      ]
    }
  ],
  "theme": {
    "primary": "#ff6600",
    "background": "#f5f5f5",
    "negative": "#cc0000",
    "positive": "#00aa00"
  }
}
```

### 布局类型（layout）

| 类型 | 说明 |
|------|------|
| `multi-column` | 多列等宽布局，每列一个 section |
| `table-with-sidebar` | 左侧表格 + 右侧信息栏 |
| `single` | 单列全宽布局 |

### 图表类型（type）

| 类型 | 说明 |
|------|------|
| `line-chart` | 折线图，适合时间序列 |
| `bar-chart` | 柱状图，适合分类对比 |
| `table` | 表格 |
| `metric-cards` | 指标卡片 |
| `info` | 纯文本信息块 |

### 数据格式（y_formatter）

| 值 | 说明 |
|------|------|
| `percent` | 百分比，如 `0.123` → `12.3%` |
| `wan` | 万为单位，如 `1230000` → `123w` |
| `int` | 整数，千分位分隔 |
| `float` | 保留两位小数 |
| `rate` | 百分比率，如 `92.5` → `92.50%` |

---

## 数据文件格式

`--data-dir` 下每个数据文件是一个 JSON 数组：

```json
[
  {"date": "20260501", "value_a": 100, "value_b": 200},
  {"date": "20260508", "value_a": 110, "value_b": 210}
]
```

文件名对应模板中的 `data_source`，如 `market.json`。

---

## 输出规范

- 页面尺寸：1280px × 720px
- 支持滚动吸附（CSS scroll-snap）
- 支持在线编辑（contenteditable="true"）
- 右侧导航面板（可折叠）
- 页脚显示生成时间和页码

---

## 注意事项

1. **本 skill 不查询数据**，只负责渲染。数据必须由调用方提供。
2. 模板配置错误时，脚本会输出具体错误信息到 stderr。
3. 如果数据文件中缺少模板要求的字段，对应位置显示 "-" 或 "暂无数据"。
4. 生成的 HTML 文件不自开浏览器，只输出文件路径。
