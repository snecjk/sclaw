---
name: claw-archiver
version: 1.0.0
description: 定义 Claw 生成页面编辑后的保存归档标准，包括目录结构模板、版本命名规则和保存触发策略。
author: sto
tags: [platform, archive, save, standard]
---

# claw-archiver

## 职责

定义编辑后的页面保存到哪里、怎么命名、怎么组织历史版本。

## 输入

编辑后的 HTML 内容 + 保存配置。

## 输出

- 归档策略配置模板
- 版本命名规则
- 保存目录结构约定

## 归档策略（通过 HTML meta 标签声明）

业务 Skill 在生成 HTML 时，通过 `<meta>` 标签声明保存策略：

```html
<head>
  <meta name="claw:save-mode" content="manual"> <!-- manual | auto -->
  <meta name="claw:save-dir" content="{workspace}/{date}"> <!-- 目录模板 -->
  <meta name="claw:version-format" content="v{N}"> <!-- 版本命名 -->
  <meta name="claw:filename" content="daily-report"> <!-- 基础文件名 -->
</head>
```

### 配置项

| meta 标签 | 可选值 | 说明 |
|---|---|---|
| `claw:save-mode` | `manual` / `auto` | `manual` = 用户点击保存按钮；`auto` = 退出编辑时自动保存 |
| `claw:save-dir` | 模板字符串 | 保存目录，支持变量替换 |
| `claw:version-format` | `v{N}` / `{time}` | `v{N}` = v1, v2... 自动递增；`{time}` = 时间戳命名 |
| `claw:filename` | 字符串 | 文件基础名（不含扩展名），默认从原文件名提取 |

### 目录模板变量

| 变量 | 示例值 | 说明 |
|---|---|---|
| `{workspace}` | `~/.stoclaw/openclaw/workspace` | 工作空间根目录 |
| `{date}` | `2026-05-13` | 当前日期 `YYYY-MM-DD` |
| `{time}` | `143022` | 当前时间 `HHMMSS` |
| `{filename}` | `daily-report` | 原文件名（不含扩展名） |
| `{N}` | `3` | 自动递增版本号 |

## 归档风格

### 风格 A：同目录版本号（默认，简单）

```
workspace/
├── daily-report.html          ← 当前工作版本（最新副本）
├── daily-report_v1.html       ← 历史版本
├── daily-report_v2.html
└── daily-report_v3.html
```

### 风格 B：按日期归档（整洁）

```
workspace/
├── daily-report.html          ← 当前工作版本（软链接或最新副本）
└── archive/
    ├── 2026-05-13/
    │   ├── daily-report_v1.html
    │   └── daily-report_v2.html
    └── 2026-05-14/
        └── daily-report_v1.html
```

## 保存流程

1. 用户点击「保存」（或退出编辑触发自动保存）
2. Claw 前端收集 iframe 中的 `document.documentElement.outerHTML`
3. 调用 Host API `POST /api/files/save`
4. Main process 解析 HTML meta 中的 `claw:save-dir`、`claw:version-format`、`claw:filename`
5. 按模板生成保存路径，写入文件
6. 返回保存路径，Claw 前端提示成功

## Host API 端点

```
POST /api/files/save
Content-Type: application/json

{
  "content": "<!DOCTYPE html>...",
  "originalPath": "/Users/sto/.stoclaw/openclaw/workspace/daily-report.html",
  "encoding": "utf-8"
}
```

响应：
```json
{
  "success": true,
  "savedPath": "/Users/sto/.stoclaw/openclaw/workspace/2026-05-13/daily-report_v2.html"
}
```
