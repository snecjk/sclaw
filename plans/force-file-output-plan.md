# 强制写入文件方案规划

## 背景

模型输出长内容（代码、SQL、配置等）时，受限于 OpenClaw Gateway 的 `CHAT_HISTORY_TEXT_MAX_CHARS = 12000` 硬编码截断，导致内容被截断并追加 `...(truncated)...`。

目标：**通过约束模型将长内容写入本地文件，绕过聊天记录截断限制，同时提供更好的文件管理和预览体验。**

---

## 一、触发条件：哪些内容需要写入文件

### 1.1 基于内容类型的规则

| 内容类型 | 触发阈值 | 说明 |
|---|---|---|
| **SQL 查询** | ≥ 20 行 或 ≥ 800 字符 | SQL 是高频截断场景，阈值放低 |
| **代码脚本**（Python/JS/TS/Java/Go 等） | ≥ 30 行 或 ≥ 1500 字符 | 通用代码文件 |
| **配置文件**（JSON/YAML/XML/TOML/INI） | ≥ 50 行 或 ≥ 2000 字符 | 结构化配置 |
| **Shell/Batch 脚本** | ≥ 20 行 或 ≥ 800 字符 | 运维脚本 |
| **Markdown/纯文本文档** | ≥ 50 行 或 ≥ 3000 字符 | 长文档、报告 |
| **CSV/TSV/日志** | ≥ 30 行 或 ≥ 1500 字符 | 数据文件 |
| **HTML/CSS** | ≥ 30 行 或 ≥ 1500 字符 | Web 相关文件 |

### 1.2 例外情况（仍需提示）

以下情况**仍然建议写入文件**，但可以在回复中附上前 5-10 行作为预览：

- 用户明确说"直接发给我"或"在聊天里展示"
- 需要即时讨论、逐行 review 的代码

**回复模板**：
```
内容较长（共 {行数} 行），已写入文件：./.claw-output/{文件名}

前 10 行预览：
```sql
{前 10 行代码}
```

👉 [点击预览完整内容]
```

---

## 二、支持的文件类型

### 2.1 文件扩展名白名单

```
代码文件：
  .sql, .py, .js, .ts, .jsx, .tsx, .java, .go, .rs,
  .cpp, .c, .h, .cs, .rb, .php, .swift, .kt, .scala, .r, .m, .mm

配置文件：
  .json, .yaml, .yml, .xml, .toml, .ini, .conf, .properties, .env

文档/数据：
  .md, .txt, .csv, .tsv, .log

Web 文件：
  .html, .htm, .css, .scss, .less

Shell 脚本：
  .sh, .bash, .zsh, .fish, .ps1, .bat, .cmd
```

### 2.2 文件类型与预览方式映射

| 文件类型 | MIME 类型 | 预览方式 | 现有支持 |
|---|---|---|---|
| `.html`, `.htm` | `text/html` | iframe + Host API 服务 | ✅ 已支持 |
| `.pdf` | `application/pdf` | iframe + Host API 服务 | ✅ 已支持 |
| `.md` | `text/markdown` | iframe srcdoc（内置样式） | ✅ 已支持 |
| `.txt`, `.log`, `.csv`, `.tsv` | `text/plain` | 文本阅读器（需新增语法高亮） | ⚠️ fallback 到"外部打开" |
| 代码文件（`.sql`, `.py`, `.js`, `.ts`, `.json`, `.yaml` 等） | `text/plain` / `application/json` | 代码阅读器（语法高亮 + 行号） | ⚠️ fallback 到"外部打开" |
| Office 文档 | `application/vnd.*` | 系统默认程序打开 | ✅ fallback 到"外部打开" |

---

## 三、存储目录与命名规范

### 3.1 存储目录

- **根目录**：当前 Agent 的 workspace 目录
  - Main Agent: `~/.stoclaw/openclaw/workspace/`
  - 其他 Agent: `~/.stoclaw/openclaw/workspace-{agentId}/`
- **输出子目录**：`./.claw-output/`（相对于 workspace）
- **理由**：
  - 与 workspace 隔离，便于管理和清理
  - 路径相对，跨平台兼容
  - 用户可以在文件系统中直接找到

### 3.2 命名规范

1. **用户指定文件名**：优先使用用户在 prompt 中指定的文件名
   - 例："帮我写一个 daily_report.sql" → `./.claw-output/daily_report.sql`

2. **模型自动生成**：根据内容语义生成
   - 例：一段站点诊断 SQL → `./.claw-output/site_diagnosis_query.sql`
   - 例：一段用户配置 JSON → `./.claw-output/user_settings.json`

3. **冲突处理**：文件已存在时，自动追加序号
   - `./.claw-output/daily_report.sql`
   - `./.claw-output/daily_report_1.sql`
   - `./.claw-output/daily_report_2.sql`

4. **时间戳模式**（可选）：对于日志类文件，支持时间戳后缀
   - `./.claw-output/app_log_20240521_143052.log`

---

## 四、消息交互格式

### 4.1 Assistant 回复模板

```
已生成 {文件类型} 文件：{文件路径}

文件概要：
- {功能描述 1}
- {功能描述 2}
- 共 {行数} 行

👉 [点击预览完整内容]
```

### 4.2 实际示例

**场景 1：SQL 查询**
```
已生成 SQL 文件：./.claw-output/site_diagnosis_photo.sql

文件概要：
- 关联 sto_diagnosis_photo_static 和 dim_sto_calendar 表
- 按 belong_org_code 分组聚合 8 个指标
- 包含周数据和月初数据两个 CTE
- 共 186 行

👉 [点击预览完整内容]
```

**场景 2：配置文件**
```
已生成配置文件：./.claw-output/api_gateway_routes.yaml

文件概要：
- 定义了 12 个 API 路由规则
- 包含认证、限流、重试策略
- 共 89 行

👉 [点击预览完整内容]
```

---

## 五、预览方式规划

### 5.1 现有预览基础设施

| 组件 | 能力 | 位置 |
|---|---|---|
| `FilePreviewViewer` | PDF/HTML/Markdown iframe 预览，其他文件 fallback 到"外部打开" | `src/components/file-preview/FilePreviewViewer.tsx` |
| `ChatPreviewPanel` | 右侧边栏，支持多文件 tab 切换 | `src/pages/Chat/ChatPreviewPanel.tsx` |
| `extractPreviewableRefs` | 从消息文本中提取可预览文件路径（**目前仅支持 `.html` 和 localhost URLs**） | `src/pages/Chat/message-utils.ts` |
| Host API `/api/files/serve` | 服务本地文件，绕过浏览器 `file://` 限制 | `electron/api/routes/files.ts` |
| Host API `/api/files/read` | 读取文件内容（用于 Markdown 预览） | `electron/api/routes/files.ts` |

### 5.2 需要增强的预览能力

#### 增强 1：扩展 `extractPreviewableRefs` 支持的文件类型

**当前**：只匹配 `.html` 文件路径和 localhost URLs

**目标**：匹配所有白名单中的文件扩展名

```typescript
// 当前正则（仅 .html）
/(/+(?:[^/\s]+\/)*[^/\s]+\.html?|[A-Za-z]:[\\/](?:[^/\s]+[\\/])*[^/\s]+\.html?)/g

// 目标正则（支持所有白名单扩展名）
/(/+(?:[^/\s]+\/)*[^/\s]+\.(?:sql|py|js|ts|jsx|tsx|java|go|rs|cpp|c|h|cs|rb|php|swift|kt|scala|r|m|mm|json|yaml|yml|xml|toml|ini|conf|properties|env|md|txt|csv|tsv|log|html|htm|css|scss|less|sh|bash|zsh|fish|ps1|bat|cmd)|[A-Za-z]:[\\/](?:[^/\s]+[\\/])*[^/\s]+\.(?:sql|py|js|ts|...))/gi
```

#### 增强 2：代码文件语法高亮预览

**方案 A：复用现有代码块渲染**
- 在 `FilePreviewViewer` 中新增一个 "Code Viewer" 模式
- 读取文件内容后，用现有的 Markdown/code block 渲染组件展示（带语法高亮）
- 优点：复用现有能力，无需额外依赖

**方案 B：Monaco Editor（VS Code 内核）**
- 集成 Monaco Editor 提供完整的代码预览体验
- 优点：支持代码折叠、搜索、跳转
- 缺点：包体积大，集成成本高

**推荐**：先采用**方案 A**，在 `FilePreviewViewer` 的 fallback 分支中增加一个 "代码预览" 模式：
- 读取文件内容
- 用 `pre` + 语法高亮渲染
- 提供"复制全部"、"在外部打开"按钮

#### 增强 3：消息中文件路径的渲染方式

**当前**：文件路径是纯文本，需要用户手动复制路径

**目标**：将文件路径渲染为可交互的 FileCard

```tsx
// 消息中的文件路径渲染为：
<FileCard
  fileName="site_diagnosis_photo.sql"
  filePath="./.claw-output/site_diagnosis_photo.sql"
  mimeType="text/plain"
  onPreview={() => openPreviewPanel(filePath)}
/>
```

FileCard 样式：
- 左侧：文件类型图标（根据扩展名）
- 中间：文件名 + 文件大小
- 右侧："预览"按钮 + "打开"按钮

---

## 六、约束实现方式

### 6.1 方式 A：Agent Bootstrap 文件（推荐作为 MVP）

OpenClaw 的 Agent 在启动时会读取 workspace 中的 bootstrap 文件（`AGENTS.md`、`SOUL.md`、`TOOLS.md` 等），这些文件的内容会作为系统提示的一部分注入到模型上下文中。

**实施步骤**：
1. 在 `AGENTS.md` 或 `SOUL.md` 模板中增加一段约束说明
2. StoClaw 在创建/初始化 Agent 时，将这段约束写入 bootstrap 文件

**约束文本草案**：

```markdown
## 长内容输出规范

当用户要求你生成以下类型内容时，如果预计超过阈值，**必须使用 `write` 工具写入文件**，不要在聊天消息中直接输出完整内容。

### 触发阈值

| 内容类型 | 阈值 |
|---|---|
| SQL 查询 | ≥ 20 行 或 ≥ 800 字符 |
| 代码脚本（Python/JS/TS/Java/Go 等） | ≥ 30 行 或 ≥ 1500 字符 |
| 配置文件（JSON/YAML/XML 等） | ≥ 50 行 或 ≥ 2000 字符 |
| Shell/Batch 脚本 | ≥ 20 行 或 ≥ 800 字符 |
| Markdown/纯文本文档 | ≥ 50 行 或 ≥ 3000 字符 |
| CSV/TSV/日志 | ≥ 30 行 或 ≥ 1500 字符 |

### 输出规范

1. **存储路径**：写入当前 workspace 的 `./.claw-output/` 目录
2. **文件名**：
   - 优先使用用户指定的文件名
   - 无指定时根据内容语义命名（如 `daily_report.sql`）
   - 文件已存在时自动追加序号（`_1`, `_2`）
3. **回复格式**：
   - 提供文件路径（如 `./.claw-output/daily_report.sql`）
   - 给出内容摘要（不超过 5 行）
   - 说明用户可以点击预览
4. **例外处理**：用户明确说"直接发给我"时，仍需写入文件，但可在回复中附上前 5-10 行作为预览，并说明完整内容已保存到文件

### 示例

用户：帮我写一个查询站点诊断数据的 SQL

❌ 错误做法：直接在回复中贴出 200 行 SQL

✅ 正确做法：
```
已生成 SQL 文件：./.claw-output/site_diagnosis_query.sql

文件概要：
- 关联 sto_diagnosis_photo_static 和 dim_sto_calendar 表
- 按 belong_org_code 分组聚合 8 个指标
- 共 186 行

👉 点击预览完整内容
```
```

### 6.2 方式 B：独立 Skill（推荐作为长期方案）

创建一个 `long-output-saver` skill，提供更结构化的约束和工具模板。

**Skill 结构**：
```
resources/skills/long-output-saver/
├── SKILL.md          # Skill 定义和约束说明
└── manifest.json     # Skill 元数据
```

**优点**：
- 可独立版本管理
- 可动态启用/禁用
- 可针对不同 Agent 单独配置

**缺点**：
- 需要创建新的 skill 包
- OpenClaw 需要识别和加载该 skill

### 6.3 方式 C：代码层兜底（辅助手段）

在 UI 渲染层增加兜底检测：

```typescript
// 在消息渲染时检测
if (messageContainsLongCodeBlock(text)) {
  showSuggestionBanner(
    "检测到长代码块（{行数} 行）。建议让模型将内容写入文件，以获得更好的阅读和预览体验。"
  );
}
```

**定位**：不是强制约束，而是用户引导。当模型偶尔"忘记"使用 `write` 工具时，给用户一个提示。

---

## 七、实施路线图

### Phase 1：MVP（最小可行方案）

**目标**：解决当前截图中的 SQL 截断问题

**工作量**：约 2-3 天

**任务清单**：

| # | 任务 | 文件 | 优先级 |
|---|---|---|---|
| 1 | 在 `AGENTS.md` 模板中加入长内容输出规范 | `electron/utils/agent-config.ts` 或 bootstrap 模板 | P0 |
| 2 | 扩展 `extractPreviewableRefs` 支持 `.sql`, `.py`, `.js`, `.ts`, `.json`, `.md` 等 | `src/pages/Chat/message-utils.ts` | P0 |
| 3 | 在 `FilePreviewViewer` 中为代码文件增加文本预览模式（读取内容 + 基础渲染） | `src/components/file-preview/FilePreviewViewer.tsx` | P0 |
| 4 | 确保 `write` 工具写入 `./.claw-output/` 的文件能被 Host API `/api/files/serve` 正常服务 | `electron/api/routes/files.ts` | P0 |
| 5 | 验证端到端流程：模型写文件 → 消息显示路径 → 用户点击预览 → 右侧边栏展示 | 集成测试 | P0 |

### Phase 2：体验优化

**目标**：提升文件预览和交互体验

**工作量**：约 3-5 天

**任务清单**：

| # | 任务 | 文件 | 优先级 |
|---|---|---|---|
| 6 | 消息中的文件路径自动渲染为 `FileCard` 组件（带图标、文件名、预览按钮） | `src/pages/Chat/ChatMessage.tsx` 或 Markdown 渲染器 | P1 |
| 7 | `FilePreviewViewer` 代码预览模式增加语法高亮（复用现有 code block 高亮逻辑） | `src/components/file-preview/FilePreviewViewer.tsx` | P1 |
| 8 | 支持文件拖拽到聊天输入框作为附件引用 | `src/pages/Chat/ChatInput.tsx` | P2 |
| 9 | `.claw-output/` 目录自动清理策略（保留最近 N 天或 N 个文件） | `electron/` 定时任务或 Gateway 配置 | P2 |

### Phase 3：自动化增强

**目标**：更智能的约束和检测

**工作量**：约 5-7 天

**任务清单**：

| # | 任务 | 文件 | 优先级 |
|---|---|---|---|
| 10 | 创建 `long-output-saver` skill，替代 bootstrap 文件中的硬编码约束 | `resources/skills/long-output-saver/` | P2 |
| 11 | UI 层检测长代码块，主动提示用户使用文件输出 | `src/pages/Chat/ChatMessage.tsx` | P2 |
| 12 | 支持文件版本历史（同一文件多次生成时保留版本记录） | `electron/` 文件管理模块 | P3 |
| 13 | 文件收藏/固定功能（用户可将常用文件固定到侧边栏） | `src/stores/` + UI 组件 | P3 |

---

## 八、风险与应对

| 风险 | 影响 | 应对措施 |
|---|---|---|
| 模型"忘记"使用 `write` 工具，仍直接输出长内容 | 仍触发截断 | Phase 1 的 bootstrap 约束 + Phase 3 的 UI 兜底提示 |
| `write` 工具执行失败（权限不足、路径错误） | 文件未生成 | tool result 返回错误信息，模型可重试或告知用户 |
| 用户找不到生成的文件 | 体验差 | 消息中明确显示相对路径 + 提供"在文件夹中打开"按钮 |
| `.claw-output/` 目录文件过多 | 磁盘占用 | Phase 2 增加自动清理策略 |
| 多平台路径兼容性问题 | Windows/macOS/Linux 路径差异 | 使用相对路径 `./.claw-output/`，由 OpenClaw 解析为绝对路径 |

---

## 九、与现有系统的关系

### 9.1 与 `CHAT_HISTORY_TEXT_MAX_CHARS` 修改的关系

本方案**不排斥**调大 `CHAT_HISTORY_TEXT_MAX_CHARS`（如从 12K 调到 100K）。两者可以并存：

- **调大截断阈值**：作为兜底，防止模型偶尔直接输出时的截断
- **强制写入文件**：作为最佳实践，让长内容有更好的管理和预览体验

### 9.2 与 `maxTokens` 的关系

写入文件**不解决**模型 `maxTokens` 触顶的问题。如果 `maxTokens = 8192`，模型仍可能在生成到 8192 token 时停止。但：

- 写入文件后，已生成的内容是完整的（保存在磁盘上）
- 用户可以看到"模型已生成 8192 tokens 的内容"，并决定是否需要继续生成
- 这与直接输出到聊天中被截断有本质区别：文件中的内容是完整的

---

## 十、结论

**本方案可行，且优于单纯调大截断阈值。**

理由：
1. 绕过 `CHAT_HISTORY_TEXT_MAX_CHARS` 硬编码限制
2. 生成文件可复用、可管理、可版本化
3. 提升用户体验（右侧预览、语法高亮、外部打开）
4. 符合编程助手产品的最佳实践（如 Cursor、Windsurf 等都采用文件输出模式）

**推荐实施顺序**：先执行 Phase 1（MVP），验证模型是否能稳定遵循 `write` 工具约束，再逐步推进 Phase 2 和 Phase 3。
