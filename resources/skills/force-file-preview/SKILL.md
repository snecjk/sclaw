---
name: force-file-preview
description: >
  【最高优先级全局约束】Agent 通过任何工具（write、edit、apply_patch、shell 命令等）生成、创建、修改、导出或保存文件后，
  必须在最终回复中使用 [file-preview: <完整路径>] 标记输出文件路径。sto-claw 会自动识别该标记并提供内置预览。
  此 skill 优先级高于其他一切文件输出相关约束，无论哪个 skill 实际执行了文件操作，最终输出格式必须以本 skill 为准。
trigger: >
  任何涉及文件操作、文件输出、文件生成、文件创建、文件保存、文件写入、文件导出、文件修改、文件编辑、文件下载、文件制作的场景。
  包括但不限于：生成、创建、制作、导出、保存、写入、修改、编辑、输出、下载、产、写、存、转、渲任何文件、文档、报告、代码、图片、数据、配置、PPT、PDF、Excel、Word、HTML、SQL、日志等。
metadata:
  openclaw:
    emoji: "📎"
    autoEnable: true
    priority: 100
---

# 强制文件预览标记

## 核心规则（不可违背）

1. **只要通过工具创建了文件，最终回复必须包含 `[file-preview: <路径>]`**
2. **只有真实存在的文件路径才能使用此标记**
3. **非文件内容绝对禁止使用此标记**

---

## ✅ 何时必须使用 `[file-preview: ...]`

Agent 通过任何工具实际创建或修改了文件后：
- 使用 `write` / `edit` / `apply_patch` 等工具写入了文件
- 使用 `shell` 命令生成了文件（如 `echo ... > file.txt`）
- 任何导致磁盘上出现新文件的操作

### 正确示例

```
报告已生成！

[file-preview: /Users/sto/.openclaw/workspace/weekly-report.html]
```

```
SQL 文件已保存：

[file-preview: ./.claw-output/daily_report.sql]
```

---

## ❌ 何时绝对禁止使用 `[file-preview: ...]`

以下情况**一律不得**使用 `[file-preview: ...]` 标记：

| 禁止场景 | 错误示例 | 正确处理 |
|---------|---------|---------|
| 纯文本/概念性内容 | `[file-preview: 内容]` | 直接写"内容" |
| 目录路径 | `[file-preview: /path/to/dir/]` | 直接写目录路径，不加标记 |
| URL/链接 | `[file-preview: https://...]` | 直接写 URL |
| 代码片段 | `[file-preview: function foo() {...}]` | 用代码块包裹 |
| 未实际创建的文件 | `[file-preview: 即将生成的文件]` | 先创建文件，再标记真实路径 |
| 文件名的纯文本提及 | `[file-preview: report.html]` | 直接写文件名 |

### 禁止示例（绝对不要这样做）

```
❌ [file-preview: 内容]
❌ [file-preview: /path/to/directory/]
❌ [file-preview: https://example.com/file.pdf]
❌ [file-preview: 这里是一段代码]
```

---

## 判断标准

使用 `[file-preview: ...]` 前必须同时满足：
1. **Agent 确实执行了文件创建/修改操作**（通过工具或命令）
2. **标记内是真实存在的文件路径**（绝对路径或相对路径均可）
3. **路径指向的是文件，不是目录**

---

## 与其他 skill 的关系

此 skill 为**最高优先级全局约束**。如果其他 skill（如 ppt-generator、cli-report-generator、long-output-saver 等）的输出规范与本 skill 冲突，**以本 skill 为准**。

其他 skill 要求：
- "在回复中输出文件绝对路径" → **替换为** "使用 `[file-preview: <路径>]` 标记输出"
- "sto-claw 会自动识别消息中的文件路径" → **替换为** "sto-claw 通过 `[file-preview: ...]` 标记识别文件"
