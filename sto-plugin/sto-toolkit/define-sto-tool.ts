import type { TSchema } from "./typebox-shim.js";
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
	const logTag = domain === "workflow" ? "sto-workflow-tool" : "sto-builtin-tool";

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
				`[${logTag}] ${id} invoked toolCallId=${toolCallId} params=${paramsPreview}`,
			);
			try {
				const data = await execute(params as TParams, {});
				if (id === "get_workflow_schema" && data && typeof data === "object") {
					const schemaData = data as {
						templateId?: string;
						schemaHash?: string;
						schema?: { fields?: unknown[]; steps?: unknown[] };
					};
					api.logger.warn?.(
						`[${logTag}] ${id} ok templateId=${schemaData.templateId ?? "(none)"} schemaHash=${schemaData.schemaHash ?? "(none)"} fields=${schemaData.schema?.fields?.length ?? 0} steps=${schemaData.schema?.steps?.length ?? 0}`,
					);
				}
				const envelope: StoToolEnvelope = {
					type: resultType,
					success: true,
					domain,
					data,
				};
				return toolResultFromEnvelope(envelope);
			} catch (err) {
				const message = err instanceof Error ? err.message : String(err);
				api.logger.warn?.(`[${logTag}] ${id} failed: ${message}`);
				return toolResultFromEnvelope(stoToolError(domain, message));
			}
		},
	});
}
