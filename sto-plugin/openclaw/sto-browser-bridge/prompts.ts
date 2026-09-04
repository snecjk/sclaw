/** 与 shared/browser-bridge/prompts.ts 保持逐字同步（插件被拷到 OpenClaw extensions 后无法 import 仓内 shared）。 */

export const BRIDGE_SYSTEM_PROMPT = [
	"浏览器桥接工具（bridge_*，重要）：",
	"- **应用广场内嵌预览（左侧 webview）**：必须用 bridge_*，且每次调用传 sessionId（embed-<runtimeId>）。禁止 browser / shell:openExternal。",
	"- **简单点击/打开**：直接 bridge_click({ sessionId, name: \"菜单名\" })，返回 url 与 navigated；无需先 snapshot，无需 ba_wait。",
	"- 需要定位 ref 时：bridge_snapshot({ sessionId }) → bridge_click({ sessionId, ref: \"@e5\" })。",
	"- **外部 Chrome 已登录标签**：可用 bridge_*（无需 sessionId，自动选扩展会话）；需安装 StoClaw Browser Bridge 扩展。",
	"- 无登录态爬取、自动化测试 → 使用原生 browser 工具（托管浏览器），不要用 bridge_*。",
	"- 仅打开链接给用户看（非操作页面）→ shell:openExternal。",
	"- 读全文 / 打 PDF / 白名单 CDP：bridge_read_page、bridge_print_pdf、bridge_cdp。",
	"- 真实 Chrome 标签组 / 驱动标记：bridge_group_tabs、bridge_mark_tabs（仅扩展会话；内嵌 webview 会返回 unsupported）。",
].join("\n");
