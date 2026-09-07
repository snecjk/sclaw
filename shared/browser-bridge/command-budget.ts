/**
 * 浏览器命令超时预算的单一事实源。
 *
 * 规则：按动作的预算是生效值，插件 config 里的 commandTimeoutMs 只是天花板。
 * 之前是 `cfg.commandTimeoutMs ?? 按动作预算`，注入的 30s 会盖过 snapshot 的
 * 45s 预算，快照在慢页面上必然假超时。
 *
 * 所有预算都必须严格小于 STREAM_CLOSE_TIMEOUT_MS，否则模型看到的是"流断了"
 * 而不是"工具超时了"——前者没有可归因的错误，后者才有。
 */

/** claude-agent-sdk 的 CLAUDE_CODE_STREAM_CLOSE_TIMEOUT（见 claude-sdk-runtime.ts）。 */
export const STREAM_CLOSE_TIMEOUT_MS = 300_000;

/** 单次浏览器命令的硬上限；余量留给结果回传与收尾，保证工具先于流超时。 */
export const COMMAND_TIMEOUT_CEILING_MS = 240_000;

const ACTION_BUDGET_MS: Record<string, number> = {
	read_page: 45_000,
	screenshot: 45_000,
	snapshot: 45_000,
};

const DEFAULT_ACTION_BUDGET_MS = 25_000;

export function resolveCommandTimeoutMs(action: string, configuredCeilingMs?: number): number {
	const budget = ACTION_BUDGET_MS[action] ?? DEFAULT_ACTION_BUDGET_MS;
	const configured =
		typeof configuredCeilingMs === "number" && Number.isFinite(configuredCeilingMs) && configuredCeilingMs > 0
			? configuredCeilingMs
			: COMMAND_TIMEOUT_CEILING_MS;
	return Math.min(budget, configured, COMMAND_TIMEOUT_CEILING_MS);
}
