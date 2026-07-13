# 钉钉入口提示词：压缩初始上下文（终版）

> 状态：已落地（相对 A1 常驻嵌入方案的修正）  
> 日期：2026-07-09  
> 目标：**压缩初始上下文**，而非「维护去重但仍常驻」

## 结论分工

| 内容 | 策略 |
|------|------|
| `dws` CLI 用法 | **主提示词不写**；靠已安装的 **dws skill**（目录短描述常驻，正文按需） |
| `@` / Recipients | **宿主按需注入**（`sto-dingtalk-send-guard` + `buildDingTalkMentionSystemContext`） |
| 口头点名发送（无 `@`） | **宿主按需注入**（`DINGTALK_ORAL_SEND_PROMPT`：搜人 + dws send，禁 share） |
| `share_to_dingtalk` | **宿主按需注入**（仅选人窗意图，且无 @、也不像口头点名时） |
| AGENTS / CLAUDE / TOOLS | **无钉钉政策/选型大段** |

## 宿主注入条件（不用模型判断）

1. **有 pending `@` / Recipients** → 注入 mention 规则块  
2. **无 pending，且用户原文像「发给文鹏 / 发一条…给某人」** → 注入 **口头 dws 发送规则**（搜人 + `dws chat message send`，禁止 `share_to_dingtalk`）  
3. **无 pending，且像「分享到钉钉 / 选人发送…」**（且不像口头点名） → 注入 `DINGTALK_SHARE_TOOL_PROMPT`  
4. 其它轮次 → **不注入**钉钉 StoClaw 规则  

口头「给文鹏发消息」无 `@`：走第 2 条，由宿主注入 dws 发送规则。

## 相对 A1 的变更

- A1 的 `<!-- include:shared/dingtalk-policy.md -->` **已从入口移除**（常驻展开达不到压缩目标）  
- `expandContextIncludes` 仍保留，供后续其它片段复用  
- `resources/context/shared/dingtalk-policy.md` **已删除**（规则改由宿主按需注入）

## 关键代码

- `resources/context/AGENTS.stoclaw.md` / `CLAUDE.md` / `TOOLS.stoclaw.md`：删除钉钉常驻段  
- `shared/dingtalk-oral-send-prompt.ts` + plugin 副本：口头发送意图与注入文案  
- `sto-plugin/openclaw/sto-dingtalk-send-guard/index.ts`：@ / 口头 dws / share 按需  
- `sto-plugin/claude/.../runtime-options.ts` + `claude-adapter`：Claude 路径传入 userPrompt  
- `share-to-dingtalk.ts`：`looksLikeDingTalkShareIntent`  
