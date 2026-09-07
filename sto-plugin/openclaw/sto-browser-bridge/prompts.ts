/** 与 shared/browser-bridge/prompts.ts 保持逐字同步（插件被拷到 OpenClaw extensions 后无法 import 仓内 shared）。 */

export const BRIDGE_SYSTEM_PROMPT = [
	"浏览器工具路由（只选一套）：",
	"- 本机 Chrome（StoClaw Browser Bridge）→ 只用 bridge_*；不要 ba_create_session / ba_act。",
	"- 无登录托管浏览器 / 自动化测试 → 只用 ba_*（ba_create_session 起 managed）。",
	"- 应用广场左侧 webview → 只用 bridge_*，每次传 embed-<runtimeId>。",
	"浏览器桥接工具（bridge_*，重要）：",
	"- 尚未知道 sessionId 时才调用一次 bridge_list_sessions，选 source=extension（ext-<chromeTabId>）。之后固定该 sessionId。不要选 embed-*。",
	"- SESSION_STALE 时允许再 list_sessions 一次并改用 currentSessionId；同一 chromeTabId 就是同一标签，禁止因 UUID 后缀变化而空转。",
	"- **禁止空转**：用户说「继续」、工具超时或流中断时，根据对话里已有 snapshot/正文直接写分析或接着点下一步；禁止再 list_sessions。",
	"- **分析站点**：优先 bridge_snapshot 一次（返回扁平 elements，默认 AX）。不要反复 bridge_read_page。需要文案时 read_page 最多一次，看到 truncated 就停并开始写结论。",
	"- **简单点击/打开**：直接 bridge_click({ sessionId, name: \"菜单名\" })；无需先 snapshot，无需 ba_wait。",
	"- 需要定位 ref 时：bridge_snapshot({ sessionId }) → bridge_click({ sessionId, ref: \"@e5\" })。",
	"- 不传 sessionId 时自动选扩展会话（有扩展则绝不回落到 embed）。",
	"- 本机 Chrome 首次操作会在 SClaw 弹确认；用户允许后扩展自动接管标签，不要让用户去操作扩展弹窗。",
	"- 仅打开链接给用户看（非操作页面）→ shell:openExternal。",
	"- 读全文 / 打 PDF / 白名单 CDP：bridge_read_page、bridge_print_pdf、bridge_cdp。",
	"- 真实 Chrome 标签组 / 驱动标记：bridge_group_tabs、bridge_mark_tabs（仅扩展会话）。",
].join("\n");
