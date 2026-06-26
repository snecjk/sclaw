# sto-distinctive-design-guard 验证指南

`sto-distinctive-design-guard` 负责把 HTML 产物默认路由到 `sto-distinctive-design` 技能：

| 层 | 机制 | 作用 |
|----|------|------|
| L1 | `before_prompt_build` / Claude `systemPromptAppend` | 每轮注入短路由（先 read 技能 → write → lint） |
| L2 | `before_tool_call` / Claude `PreToolUse` | 未读 SKILL.md 时 **block** 对 `.html` 的 write/edit |
| L3 | `after_tool_call` / Claude `PostToolUse` | HTML 写入后跑 `lint.py`，P0 违规反馈给模型 |

---

## 1. 文件是否已安装（OpenClaw 插件）

登录后应用会把插件同步到扩展目录。检查：

```bash
ls ~/.stoclaw/openclaw/extensions/sto-distinctive-design-guard/
```

应存在至少：

- `openclaw.plugin.json`（`id` 为 `sto-distinctive-design-guard`）
- `index.ts`
- `guard-core.ts`

开发态源码在仓库：`sto-plugin/openclaw/sto-distinctive-design-guard/`。

---

## 2. openclaw.json 是否已启用

```bash
# macOS / Linux
cat ~/.stoclaw/openclaw/openclaw.json | python3 -m json.tool | rg -n "sto-distinctive-design-guard" -A6
```

期望：

- `plugins.allow` 数组包含 `"sto-distinctive-design-guard"`
- `plugins.entries["sto-distinctive-design-guard"]` 类似：

```json
{
  "enabled": true,
  "config": {
    "enabled": true,
    "enforceRead": true,
    "lintEnabled": true
  }
}
```

`syncStoPluginsToOpenClaw()` 在 **SSO 登录成功** 后写入；若刚升级应用，**重新登录一次** 或重启应用触发同步。

---

## 3. 依赖技能是否在位

Guard 的 L2/L3 依赖已安装的 `sto-distinctive-design`：

```bash
ls ~/.stoclaw/openclaw/skills/sto-distinctive-design/SKILL.md
ls ~/.stoclaw/openclaw/skills/sto-distinctive-design/lint.py
```

应用 **设置 → 技能** 中应能看到 `sto-distinctive-design` 为已启用（`preinstalled-manifest.json` 里 `autoEnable: true`）。

---

## 4. 行为验证（推荐，最直观）

在聊天里让 Agent **直接** 生成 HTML（不要先提「按 STO 设计规范」）：

> 帮我生成一份网点日报 HTML，写到 .claw-output/test-guard.html

### 期望 L2 门禁生效

- 第一次 `write` `.html` 应被 **拒绝**，提示必须先 read：
  `~/.stoclaw/openclaw/skills/sto-distinctive-design/SKILL.md`
- Agent 随后 read 技能，再 write，应能成功

### 期望 L1 路由已注入

若 Agent 在 block 之前就尝试 read 技能，说明 L1 提示已生效（理想路径）。

### 期望 L3 lint（技能已读后）

若故意写出违规 HTML（如 Inter 字体、2 列 KPI 网格），`lint.py` 应报 P0；日志或 tool 结果里可见 lint 输出。

---

## 5. 日志验证

Gateway / 主进程日志中搜索：

```text
sto-distinctive-design-guard
```

常见行：

| 日志 | 含义 |
|------|------|
| `plugin registering — enforceRead=true, lintEnabled=true` | 插件已加载 |
| `blocked tool=write ... HTML write without sto-distinctive-design` | L2 拦截成功 |
| `lint passed for ...` | L3 通过 |
| `lint failed (exit=1) for ...` | L3 发现 P0 |

Claude 引擎会话另搜：

```text
[claude-runtime] building extension: sto-distinctive-design-guard
```

---

## 6. Claude Agent SDK 引擎

使用 Claude 运行时（非 OpenClaw Gateway）时，guard 通过 `electron/engines/claude-runtime-extensions.ts` 注入，**不**走 OpenClaw 扩展目录，但行为应对齐：

- 系统提示含 `【HTML 产物默认规范 · P0】`
- `Write` / `Edit` 未读技能前被拒绝

验证方式同 **§4**，并确认日志中有 `sto-distinctive-design-guard` extension 构建记录。

---

## 7. 临时关闭或降级

编辑 `~/.stoclaw/openclaw/openclaw.json`：

```json
"sto-distinctive-design-guard": {
  "enabled": true,
  "config": {
    "enabled": true,
    "enforceRead": false,
    "lintEnabled": false
  }
}
```

| 配置 | 效果 |
|------|------|
| `enabled: false`（entry 级） | 整个插件禁用 |
| `config.enforceRead: false` | 关闭 L2 写前门禁，保留 L1 提示 |
| `config.lintEnabled: false` | 关闭 L3 lint |

改完后重启 Gateway / 应用。

---

## 8. 例外（不应被 block）

- 用户点名 `.pptx` / `.docx` / `.xlsx` / `.pdf` / `.csv` → 走对应 Anthropic 技能
- `bash` 执行 `generate_report.py`（`cli-report-generator` 无人值守流水线）
- 本会话已 read `sto-distinctive-design/SKILL.md` 后的 HTML write

---

## 9. 故障排查

| 现象 | 可能原因 | 处理 |
|------|----------|------|
| 仍能不经 read 直接 write HTML | 插件未装 / `plugins.entries` 未启用 | §1–2，重新登录 |
| block 后 read 了仍无法 write | read 路径不在 `~/.stoclaw/.../skills/` 下 | 用标准技能路径 read |
| lint 从不执行 | `lintEnabled: false` 或技能目录缺 `lint.py` | §3、§7 |
| 只有 OpenClaw 生效、Claude 不生效 | 旧版未含 Claude extension | 确认已升级含 guard 的版本 |

---

## 相关路径

| 项 | 路径 |
|----|------|
| OpenClaw 插件源码 | `sto-plugin/openclaw/sto-distinctive-design-guard/` |
| Claude SDK 适配 | `sto-plugin/claude/sto-distinctive-design-guard/sdk/` |
| 技能规范 | `resources/skills/sto-distinctive-design/` |
| 配置写入 | `electron/utils/openclaw-auth.ts` → `syncStoPluginsToOpenClaw` |
| 单元测试 | `tests/unit/sto-distinctive-design-guard.test.ts` |
