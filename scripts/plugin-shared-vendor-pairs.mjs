/**
 * OpenClaw 插件 vendored shared 文件映射。
 * `scripts/sync-plugin-shared.mjs` 与单测共用此清单。
 *
 * - `shared/dingtalk-prompts/`：提示词 SSOT
 * - `shared/dingtalk-send/`：发送执行（命令拼装、收件人、分享等）
 */
export const PLUGIN_SHARED_VENDOR_PAIRS = [
  {
    rootRel: 'shared/retired-skills.ts',
    vendorRel: 'sto-plugin/openclaw/sto-dynamic-agent-route/shared/retired-skills.ts',
  },
  {
    rootRel: 'shared/workspace-paths.ts',
    vendorRel: 'sto-plugin/openclaw/sto-dynamic-agent-route/shared/workspace-paths.ts',
  },
  // sto-dingtalk-send-guard · prompts
  {
    rootRel: 'shared/dingtalk-prompts/dingtalk-disclaimer.ts',
    vendorRel: 'sto-plugin/openclaw/sto-dingtalk-send-guard/shared/dingtalk-prompts/dingtalk-disclaimer.ts',
  },
  {
    rootRel: 'shared/dingtalk-prompts/dingtalk-send-rules.ts',
    vendorRel: 'sto-plugin/openclaw/sto-dingtalk-send-guard/shared/dingtalk-prompts/dingtalk-send-rules.ts',
  },
  {
    rootRel: 'shared/dingtalk-prompts/index.ts',
    vendorRel: 'sto-plugin/openclaw/sto-dingtalk-send-guard/shared/dingtalk-prompts/index.ts',
  },
  {
    rootRel: 'shared/dingtalk-prompts/scheduled-task/scheduled-task-core.ts',
    vendorRel: 'sto-plugin/openclaw/sto-dingtalk-send-guard/shared/dingtalk-prompts/scheduled-task/scheduled-task-core.ts',
  },
  {
    rootRel: 'shared/dingtalk-prompts/scheduled-task/scheduled-task-dingtalk.ts',
    vendorRel: 'sto-plugin/openclaw/sto-dingtalk-send-guard/shared/dingtalk-prompts/scheduled-task/scheduled-task-dingtalk.ts',
  },
  {
    rootRel: 'shared/dingtalk-prompts/scheduled-task/prompt-involves-workflow.ts',
    vendorRel: 'sto-plugin/openclaw/sto-dingtalk-send-guard/shared/dingtalk-prompts/scheduled-task/prompt-involves-workflow.ts',
  },
  {
    rootRel: 'shared/dingtalk-prompts/dingtalk-mention-context.ts',
    vendorRel: 'sto-plugin/openclaw/sto-dingtalk-send-guard/shared/dingtalk-prompts/dingtalk-mention-context.ts',
  },
  {
    rootRel: 'shared/dingtalk-prompts/dingtalk-oral-send-prompt.ts',
    vendorRel: 'sto-plugin/openclaw/sto-dingtalk-send-guard/shared/dingtalk-prompts/dingtalk-oral-send-prompt.ts',
  },
  // sto-dingtalk-send-guard · send
  {
    rootRel: 'shared/dingtalk-send/dingtalk-mention.ts',
    vendorRel: 'sto-plugin/openclaw/sto-dingtalk-send-guard/shared/dingtalk-send/dingtalk-mention.ts',
  },
  {
    rootRel: 'shared/dingtalk-send/dws-send-text.ts',
    vendorRel: 'sto-plugin/openclaw/sto-dingtalk-send-guard/shared/dingtalk-send/dws-send-text.ts',
  },
  {
    rootRel: 'shared/dingtalk-send/dingtalk-file-send.ts',
    vendorRel: 'sto-plugin/openclaw/sto-dingtalk-send-guard/shared/dingtalk-send/dingtalk-file-send.ts',
  },
  {
    rootRel: 'shared/dingtalk-send/dingtalk-share.ts',
    vendorRel: 'sto-plugin/openclaw/sto-dingtalk-send-guard/shared/dingtalk-send/dingtalk-share.ts',
  },
  // sto-scheduled-task-tool
  {
    rootRel: 'shared/dingtalk-prompts/scheduled-task/scheduled-task-core.ts',
    vendorRel: 'sto-plugin/openclaw/sto-scheduled-task-tool/shared/scheduled-task-core.ts',
  },
  {
    rootRel: 'shared/dingtalk-send/dingtalk-mention.ts',
    vendorRel: 'sto-plugin/openclaw/sto-scheduled-task-tool/shared/dingtalk-send/dingtalk-mention.ts',
  },
];
