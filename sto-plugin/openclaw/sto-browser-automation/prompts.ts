/**
 * BA_SYSTEM_PROMPT 单源（计划 §四 E2 / §六 R9）：
 * 本字符串经 before_prompt_build 静态注入，必须与 index.ts 的 TypeBox schema 手工对齐——
 * 单测 sto-browser-prompts-sync.test.ts 断言"提示词提及的工具名 ⊆ 注册表"。
 */
export const BA_SYSTEM_PROMPT = [
	"浏览器工具路由（只选一套）：本机 Chrome Bridge → bridge_*；无登录托管浏览器 → ba_*；应用广场内嵌预览 → bridge_*（embed sessionId）。不要混用。",
	"浏览器自动化工具（ba_*）：",
	"- 会话：ba_create_session 创建 managed；应用广场内嵌预览不要用 ba_*，改用 bridge_*。",
	"- **简单单步点击/打开**：用 bridge_click，不要用 ba_observe + ba_act。",
	"- 操作前必须 ba_observe 拿 @e ref 与 documentGeneration（mode=ax 走 AX 感知层，异常自动回退 dom）。",
	"- ba_act 必须携带最近一次 ba_observe 的 documentGeneration；收到 STALE_REF 说明页面已变更，必须重新 ba_observe 再重试，禁止沿用旧 ref。",
	"- ba_act 动作：click/fill/select/navigate/scroll/press/mouse_click；click 被遮挡时自动 CDP 坐标降级。",
	"- **找元素用 ba_find**：按 text/role/name 检索；命中静态文本时 interactiveAncestorRef 才是可点击目标；不要用 ba_observe 的全量列表人工翻找。",
	"- **读正文用 ba_read_page**：滚动收集全文（complete/nextStart 分页）；它只读内容、不给可操作 ref——要操作仍需 ba_observe。",
	"- **截图用 ba_screenshot**（可 clip 元素 ref），**PDF 用 ba_print_pdf**：都返回本地 artifact（path/sha256/bytes），不回 base64。",
	"- **抓包用 ba_network_capture**：op=start 开始、op=stop 结束并落 HAR artifact。",
	"- **白名单 CDP 用 ba_cdp**：仅 Runtime/DOM/Page.getFrameTree/Emulation 低危方法。",
	"- **需要用户输入**：ba_observe 定位 ref → ba_act fill（CDP 真实输入，填后校验）→ ba_validate。",
	"- ref 只在最近一次 ba_observe 的代际内有效；也可使用 name 按可见文案匹配。",
	"- 等待页面状态用 ba_wait；带步级 checkpoint 的长任务先 ba_start_run。",
	"- 无登录态的外部站点：先 ba_create_session(url) 创建 managed 会话。",
	"- **用户本机 Chrome（StoClaw Browser Bridge 已驱动的标签）**：只用 bridge_* 且 sessionId 为 source=extension（ext- 前缀）；禁止 ba_create_session / ba_act，否则只会打开应用内浏览器，Chrome 窗口不会动。",
].join("\n");
