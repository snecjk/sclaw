---
name: long-output-saver
description: 强制将长代码、SQL、配置文件等输出写入本地文件，避免聊天消息因长度限制被截断。
metadata:
  { "openclaw": { "emoji": "📄", "autoEnable": true } }
---

# Long Output Saver

## 目标

当需要向用户展示长内容时，**必须使用 `write` 工具写入文件**，禁止直接在聊天消息中输出完整内容。

## 绝对禁止

- ❌ 直接在聊天消息中输出超过阈值的完整代码 / 配置 / 文档
- ❌ 以"用户要求直接展示"为由忽略此规范

## 触发阈值

| 内容类型 | 阈值 |
|---|---|
| SQL 查询 | ≥ 20 行 或 ≥ 800 字符 |
| 代码脚本（Python/JS/TS/Java/Go 等） | ≥ 30 行 或 ≥ 1500 字符 |
| 配置文件（JSON/YAML/XML/TOML 等） | ≥ 50 行 或 ≥ 2000 字符 |
| Shell/Batch/PowerShell 脚本 | ≥ 20 行 或 ≥ 800 字符 |
| Markdown / 纯文本文档 | ≥ 50 行 或 ≥ 3000 字符 |
| CSV / TSV / 日志文件 | ≥ 30 行 或 ≥ 1500 字符 |
| HTML / CSS / SCSS / Less | ≥ 30 行 或 ≥ 1500 字符 |

## 输出规范

1. **存储路径**：写入当前 workspace 的 `./.claw-output/` 目录。
2. **文件名**：
   - 优先使用用户指定的文件名
   - 无指定时根据内容语义命名（如 `daily_report.sql`、`api_routes.yaml`）
   - 文件已存在时自动追加序号（`_1`、`_2`）
3. **回复格式**：
   - 提供文件路径（如 `./.claw-output/daily_report.sql`）
   - 给出内容摘要（不超过 5 个 bullet points）
   - 说明用户可以点击路径预览完整内容
   - 可附上前 5–10 行作为预览
4. **强制规则**：
   - 即使用户说"直接发给我"或"在聊天里展示"，仍然必须写入文件
   - 不允许以任何理由在聊天中输出超过阈值的完整内容

## 示例

### ❌ 错误做法

```
用户：帮我写一个查询站点诊断数据的 SQL

（直接在回复中贴出 200 行 SQL）
```

### ✅ 正确做法

```
用户：帮我写一个查询站点诊断数据的 SQL

回复：
已生成 SQL 文件：./.claw-output/site_diagnosis_query.sql

文件概要：
- 关联 sto_diagnosis_photo_static 和 dim_sto_calendar 表
- 按 belong_org_code 分组聚合 8 个指标
- 包含周数据和月初数据两个 CTE
- 共 186 行

前 10 行预览：
```sql
WITH weekTime AS
(
    SELECT week_beg_date AS last_date
    FROM sto_pub.dim_sto_calendar
    WHERE cal_date = '${bizdate}'
)
,monthTime AS
...
```

👉 [点击预览完整内容]
```

## 为什么这样做？

聊天历史有硬编码的字符上限（12000 字符），长内容会被截断并显示 `...(truncated)...`。写入文件可以：
- 绕过长度限制，完整保存内容
- 支持语法高亮预览
- 文件可复用、可版本管理
- 用户可以在外部编辑器中打开
