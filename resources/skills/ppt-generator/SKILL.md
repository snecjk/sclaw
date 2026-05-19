---
name: ppt-generator
description: 通用 PPT HTML 报告生成器。根据模板配置和数据源，生成可上下滑动查看的多页面 PPT 风格 HTML 报告。支持折线图、柱状图、表格等多种图表类型，支持多列布局和侧边栏布局。
version: 1.0.0
trigger: 被其他 skill 调用，或用户涉及 ppt-generator 生成报告的任何场景（包括首次生成、调整、修改、更新内容）
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

### 首次生成

- "用 ppt-generator 生成报告"
- "根据这些数据生成 PPT"
- "生成周报 PPT"

### 调整 / 修改 / 更新

**当用户要求对已有的 HTML 报告进行任何调整时，本 skill 同样必须触发。** 包括但不限于：
- "把第3页改成..."
- "帮我调整一下颜色"
- "这个数据更新一下"
- "标红低于5%的"
- "加一页..."
- "删掉..."
- 任何涉及已生成报告内容变化的需求

**不要尝试用 `write` 或 `edit` 工具直接修改 HTML 文件。** 这是错误做法。

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

## 行为约束

### 绝对禁止

- ❌ **禁止使用 `write`、`edit`、`apply_patch` 等文件工具直接修改已生成的 HTML 报告。**
- ❌ 禁止覆盖已有的 `.html` 报告文件。
- ❌ 禁止以"只改一点"为理由直接编辑旧文件。

### 唯一正确做法

- ✅ **任何内容调整都必须重新调用本 skill，生成完整的新版本 HTML。**
- ✅ 新版本的 `--output` 路径必须使用 `_v{N}` 批次命名（如 `report_v1.html`）。
- ✅ 如果忘记指定版本号，脚本会自动递增保护。

**原因**：直接编辑 HTML 会破坏模板与数据的一致性，导致后续无法追溯版本、无法复现、容易出错。重新生成是唯一的正确工作流。

---

## 版本化输出规范

本 skill **每次调用都必须生成新文件，禁止覆盖已有文件**。

### 批次命名规则

| 场景 | 命名示例 | 说明 |
|------|---------|------|
| 首次生成 | `report_20260519_101010.html` | 默认带时间戳，不冲突 |
| 指定路径首次 | `weekly-report.html` | 用户/Agent 通过 `--output` 指定 |
| 第一次调整 | `weekly-report_v1.html` | 原文件存在时自动递增 |
| 第二次调整 | `weekly-report_v2.html` | 基于同一基础名继续递增 |

### 自动保护机制

- 若调用方提供的 `--output` 路径已存在，脚本会自动检测并递增版本号（`_v1`、`_v2`…），**确保历史文件不被覆盖**。
- 若调用方未提供 `--output`，则默认使用 `report_<timestamp>.html`，天然避免冲突。
- **调用方仍应在"调整/迭代"场景下主动提供带语义的新路径**，而非依赖自动保护。

---

## 注意事项

1. **本 skill 不查询数据**，只负责渲染。数据必须由调用方提供。
2. 模板配置错误时，脚本会输出具体错误信息到 stderr。
3. 如果数据文件中缺少模板要求的字段，对应位置显示 "-" 或 "暂无数据"。
4. 生成的 HTML 文件不自开浏览器，只输出文件路径。
5. **禁止覆盖已有文件**：无论通过 `--output` 指定还是使用默认路径，脚本都会确保写入的是新文件。若需迭代调整，请在 `--output` 中使用 `_v{N}` 批次命名，或让脚本自动递增版本号。
