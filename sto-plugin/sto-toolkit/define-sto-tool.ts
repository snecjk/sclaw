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
		execute: async (toolCallId, params) => {
			const paramsPreview = (() => {
				try {
					const text = JSON.stringify(params);
					return text.length > 600 ? `${text.slice(0, 600)}…` : text;
				} catch {
					return "(unserializable)";
				}
			})();
			api.logger.warn?.(
				`[sto-builtin-tool] ${id} invoked domain=${domain} toolCallId=${toolCallId} params=${paramsPreview}`,
			);
			try {
				const data = await execute(params as TParams, {});
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
