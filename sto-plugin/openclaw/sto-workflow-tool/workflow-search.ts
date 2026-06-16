import type { StoApiClient } from "./sto-toolkit/http-client.js";
import { resolveSearchQuery, resolveTemplateId } from "./workflow-params.js";

export type TemplateSearchItem = {
	id: string;
	label: string;
	description?: string;
	matchScore?: number;
};

const DEFAULT_PAGE_SIZE = 10;
const MAX_PAGE_SIZE = 50;

export async function fetchWorkflowTemplates(
	client: StoApiClient,
	query: string,
	limit = DEFAULT_PAGE_SIZE,
): Promise<TemplateSearchItem[]> {
	const pageSize = Math.min(Math.max(limit, 1), MAX_PAGE_SIZE);
	const items = await client.fetchJson<TemplateSearchItem[]>("/agent/v1/workflow-templates", {
		method: "POST",
		body: JSON.stringify({
			query,
			page: 1,
			pageSize,
		}),
	});
	return items ?? [];
}

export async function resolveTemplateIdWithOptionalSearch(
	params: Record<string, unknown>,
	search: (query: string) => Promise<TemplateSearchItem[]>,
): Promise<{ templateId: string; resolvedViaSearch: boolean; matchedLabel?: string }> {
	try {
		return { templateId: resolveTemplateId(params), resolvedViaSearch: false };
	} catch {
		const query = resolveSearchQuery(params);
		if (!query) {
			throw new Error(
				"缺少 templateId 或 query：请先 search_workflow_templates，或在 get_workflow_schema 传入 query（用户自然语言描述）",
			);
		}
		const templates = await search(query);
		const first = templates[0];
		if (!first?.id) {
			throw new Error(`未找到匹配的工作流模板：${query}`);
		}
		return {
			templateId: first.id,
			resolvedViaSearch: true,
			matchedLabel: first.label,
		};
	}
}
