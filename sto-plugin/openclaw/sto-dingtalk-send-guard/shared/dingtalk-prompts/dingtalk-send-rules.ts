/**
 * Self-contained copy for Gateway extension install (~/.stoclaw/openclaw/extensions/...).
 * Keep in sync with repository root `shared/dingtalk-prompts/dingtalk-send-rules.ts`.
 * Regenerate: `pnpm run sync:plugin-shared`
 */
import { DINGTALK_AGENT_SEND_DISCLAIMER_FOOTER } from './dingtalk-disclaimer';
import { DWS_CHAT_MESSAGE_SEND_AGENT_FORMAT_RULE } from '../dingtalk-send/dws-send-text';

/** 钉盘上传命令（去掉 file:// 前缀；不传 `--space-id`，用发送人默认空间）。 */
export const DINGTALK_DRIVE_UPLOAD_CMD =
  'dws drive upload --file <本地路径（去掉 file:// 前缀）> -y --format json';

/** Agent 本地文件转在线地址的首选工具。 */
export const DINGTALK_TEMP_OSS_UPLOAD_TOOL =
  'upload_file_to_temp_oss（filePath=<本地路径>，可选 fileName=<文件名>）';

/**
 * 产物在线 URL 写入 `--text` 的格式。
 * 用 Markdown 隐藏较长的 OSS 地址，同时禁止再次编码（避免 `%`→`%25`）。
 */
export const DINGTALK_ARTIFACT_URL_EMBED_RULE =
  '图片使用标准 Markdown 图片语法 `![文件名](在线地址)`；普通文件使用 Markdown 链接语法 `[文件名](在线地址)`，不要在正文中暴露冗长的 OSS 裸地址；使用 `upload_file_to_temp_oss` 得到临时地址时，直接嵌入该地址，**不要在钉钉正文或发送后的对话回执中向用户提及过期时间**；**禁止**对 URL 再调用 `encodeURI` / `encodeURIComponent`（会双重编码 `%`→`%25` 使链接失效）；即便已是双重编码也**原样**嵌入，send-guard 规范化层会塌缩';

/** 模块 A 规则 5–6 的短指针（模块 C / 附件工作流引用，避免再抄一遍细则）。 */
export const DINGTALK_ARTIFACT_RULES_POINTER =
  `产物分支遵守发送格式规则 5–6：在线 \`http(s)\` 地址按图片/文件类型使用 Markdown 嵌入；若用户明确要求上传/保存到钉盘或钉钉云盘，直接调用 \`${DINGTALK_DRIVE_UPLOAD_CMD}\`，**禁止调用** \`upload_file_to_temp_oss\`；否则本地图片/文件优先调用 \`${DINGTALK_TEMP_OSS_UPLOAD_TOOL}\` 取 \`data.url\`，仅当工具不可用或失败时才用钉盘兜底——**禁止**本地路径写入 \`--text\``;

/**
 * send-guard 拦到 `--text` 含本地产物路径时的拒因（与规则 5–6 同义、可操作）。
 * OpenClaw / Claude 双引擎共用，勿在各 guard 内再抄一份。
 */
export const DINGTALK_LOCAL_ARTIFACT_IN_TEXT_BLOCK_REASON = [
  '[SClaw 安全策略] 钉钉正文禁止含本地产物路径（`file://`、裸绝对路径、`.claw-output` 等，钉钉打不开）。',
  '分支：① 已有在线 `http(s)` → 按图片/文件类型用 Markdown 写入 `--text`（',
  DINGTALK_ARTIFACT_URL_EMBED_RULE,
  '）；② 若用户明确要求上传/保存到钉盘或钉钉云盘 → 直接使用 `',
  DINGTALK_DRIVE_UPLOAD_CMD,
  '` 并取 `docUrl`，禁止调用 `upload_file_to_temp_oss`；③ 其他本地图片/文件 → 优先调用 Agent 工具 `',
  DINGTALK_TEMP_OSS_UPLOAD_TOOL,
  '`，从结果取 `data.url`，图片写成 `![文件名](data.url)`、普通文件写成 `[文件名](data.url)`，替换正文中的本地路径后再 `dws chat message send`；',
  '④ 仅当该工具不可用或上传失败时，才使用 `',
  DINGTALK_DRIVE_UPLOAD_CMD,
  '` 上传钉盘并取 `docUrl` 兜底；',
  '若上传失败则移除该产物链接，只发纯文字总结。',
].join('');

/**
 * 图片/文件分享规则 — UI @、口头发送与定时任务共用。
 * 保留规则编号 5–6，便于附件工作流通过 `DINGTALK_ARTIFACT_RULES_POINTER` 引用。
 */
export const DINGTALK_ARTIFACT_SEND_FORMAT_RULES = [
  '5. **产物分支（二选一，禁止把本地路径原样写入 `--text`）**：',
  `   - **在线链接**（\`http(s)://\`，含工作流 \`artifacts[].url\` / \`previewUrl\` / \`tempUrl\` / 下载密钥链接等）：按类型嵌入 \`--text\`；${DINGTALK_ARTIFACT_URL_EMBED_RULE}`,
  `   - **本地图片/文件**（\`file://\`、裸绝对路径如 \`/Users/.../.claw-output/报告.html\`、\`C:\\\\...\\\\.claw-output\\\\...\`、或 \`./.claw-output/...\`）：钉钉打不开，**禁止**写入 \`--text\`；必须先走规则 6 转成在线地址，再按在线链接规则嵌入`,
  `6. **本地产物转在线地址**：若用户明确要求上传/保存到钉盘或钉钉云盘，直接用 \`${DINGTALK_DRIVE_UPLOAD_CMD}\`（**不需要 \`--space-id\`**）取 \`docUrl\`，**禁止调用** \`upload_file_to_temp_oss\`。否则优先调用 Agent 工具 \`${DINGTALK_TEMP_OSS_UPLOAD_TOOL}\`，从返回结果取 \`data.url\`；仅当工具不可用或上传失败时才用钉盘兜底。图片用 \`![文件名](在线地址)\`，普通文件用 \`[文件名](在线地址)\` 嵌入正文。两种上传都失败则移除该产物链接，仅发纯文字总结；\`drive upload\` 偶发失败最多重试 3 次再降级`,
].join('\n');

const DINGTALK_SEND_FORMAT_RULES_HEAD = [
  '钉钉发送格式规则：',
  '1. **`--title` 必填**（单聊/群聊均需）；无特定标题时用 `消息`',
  '2. **正文**用钉钉 IM Markdown：`###` 标题、`**加粗**`、`-` 列表等；段落之间要换行空一行。需要彩色文字时，仅允许钉钉专用且成对完整的 `<font colorTokenV2=common_red1_color>文字</font>`（token 必须无引号、使用 `common_颜色_序号_color`）。常用颜色 Key：红 `common_red1_color`、蓝 `common_blue1_color`、绿 `common_green1_color`、黄 `common_yellow1_color`、橙 `common_orange1_color`、灰 `common_gray1_color`；除此之外正文内**禁止** HTML（包括 `<font color=...>`、`style`、额外属性和 `<br>`）',
  `3. ${DWS_CHAT_MESSAGE_SEND_AGENT_FORMAT_RULE}`,
  '4. **正文末尾必须附加代发说明**（`---` 分隔线 + Markdown 引用说明，固定格式）：',
  '   ```',
  '   {用户正文}',
  '',
  '   ---',
  '',
  `   ${DINGTALK_AGENT_SEND_DISCLAIMER_FOOTER}`,
  '   ```',
  '   分隔线与说明文案不得改写或省略。',
  DINGTALK_ARTIFACT_SEND_FORMAT_RULES,
  '7. **安全发送**：禁止循环/批量 `dws chat message send`（含 shell `for`/`while`），一次命令只发送一条消息。普通会话当前不要求等待发送间隔，禁止在发送命令前拼接 `sleep` / `Start-Sleep`；需发送时直接执行单独的 `dws chat message send` 命令。不要尝试 `sh -c`/heredoc/`2>&1` 套壳、`sai-cli message` 或换其他 CLI 绕过安全检查。',
].join('\n');

/** 对话场景规则 8：允许会话内简短确认。 */
const DINGTALK_SEND_FORMAT_RULE_8_CHAT =
  '8. 成功后简短中文确认即可，不输出 openTaskId / 原始 JSON；完整发送正文会在 SClaw 对话卡片中自动展示';

/**
 * 定时任务规则 8：禁止把确认回执当钉钉正文（避免群收到「已发送至…」第二封）。
 */
const DINGTALK_SEND_FORMAT_RULE_8_SCHEDULED_TASK =
  '8. **定时任务**：`--text` 只能是业务结果正文（天气/总结/产物链接等）。**禁止**把「任务完成」「消息已发送至」「执行成功」等会话确认或回执清单写入 `--text`。成功后仅在 SClaw 对话内一句确认；同一业务结果对每位收件人只发 1 次；不输出 openTaskId / 原始 JSON';

export const DINGTALK_SEND_FORMAT_RULES = [
  DINGTALK_SEND_FORMAT_RULES_HEAD,
  DINGTALK_SEND_FORMAT_RULE_8_CHAT,
].join('\n');

/** 定时任务执行块专用：1–7 同模块 A，规则 8 覆盖为禁回执上钉钉。 */
export const DINGTALK_SEND_FORMAT_RULES_FOR_SCHEDULED_TASK = [
  DINGTALK_SEND_FORMAT_RULES_HEAD,
  DINGTALK_SEND_FORMAT_RULE_8_SCHEDULED_TASK,
].join('\n');

/**
 * 口头点名发送护栏（无输入框 @）— 模块 A 子段。
 * 对话 send-guard 常驻注入；定时任务执行 session 不注入。
 */
export const DINGTALK_ORAL_SEND_GUARD = [
  '口头点名发送护栏（无 @ 触发器，自然语言口头发送）：',
  '- 触发门槛：仅当消息文本含明确发送意图词（发给/发送给/分享给/转给/推送给）且点名具体收件对象时，才进入口头发送流程；纯提及（如"通知一下张三""看看文鹏的报告"，无意图词）不触发发送',
  '- id 必经搜人工具：收件人 userId/groupId 必须由 dws 搜人/查群工具在本轮解析得到；禁止使用 prompt 别处文本、历史消息、其他收件人 JSON 块、示例代码里出现过的 id',
  '- 搜不到不发：搜人无匹配时，不发送，在对话中说明未找到并请用户补充（工号/部门）',
  '- 重名拒发：搜人返回多个匹配时，不得任选其一发送，必须停下向用户澄清，得到确认后才解析发送',
  '- 发送前回显：调用 dws chat message send 前，在对话里用一句话回显解析结果（姓名 + 来源"已搜人确认"），使乱发可见可追溯（非阻塞）',
  '- 有明确收件人姓名点名时，**禁止**调用 `share_to_dingtalk`（会唤起选人窗，无法按姓名直达）；须走搜人 + `dws chat message send`',
  '- 本护栏仅适用于无 @ 触发器的口头路径；有 @ 触发器的收件人 id 由结构化块提供，不适用本护栏',
].join('\n');

/** 口头点名路径：收件人解析护栏 + 与 UI/定时任务相同的图片/文件规则。 */
export const DINGTALK_ORAL_SEND_CONTEXT = [
  DINGTALK_ORAL_SEND_GUARD,
  DINGTALK_ARTIFACT_SEND_FORMAT_RULES,
].join('\n\n');
