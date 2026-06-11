import type { TSchema } from "@sinclair/typebox";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/core";
import { stoToolError, toolResultFromEnvelope, type StoToolEnvelope } from "./envelope.js";

export type StoToolExecuteContext = {
	sessionKey?: string;
	agentId?: string;
	runId?: string;
};

export type DefineStoToolOptions<TParams> = {
	id: string;
	domain: string;
	resultType: string;
	label: string;
	description: string;
	parameters: TSchema;
	execute: (params: TParams, ctx: StoToolExecuteContext) => Promise<unknown>;
};

export function defineStoTool<TParams>(
	api: OpenClawPluginApi,
	options: DefineStoToolOptions<TParams>,
) {
	const { id, domain, resultType, label, description, parameters, execute } = options;

	api.registerTool({
		id,
		name: id,
		label,
		description,
		parameters,
		execute: async (params, ctx) => {
			api.logger.info?.(`[sto-builtin-tool] ${id} invoked domain=${domain}`);
			try {
				const data = await execute(params as TParams, {
					sessionKey: (ctx as { sessionKey?: string }).sessionKey,
					agentId: (ctx as { agentId?: string }).agentId,
					runId: (ctx as { runId?: string }).runId,
				});
				const envelope: StoToolEnvelope = {
					type: resultType,
					success: true,
					domain,
					data,
				};
				return toolResultFromEnvelope(envelope);
			} catch (err) {
				const message = err instanceof Error ? err.message : String(err);
				api.logger.warn?.(`[sto-builtin-tool] ${id} failed: ${message}`);
				return toolResultFromEnvelope(stoToolError(domain, message));
			}
		},
	});
}
