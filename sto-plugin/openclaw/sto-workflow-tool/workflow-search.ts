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

/** Shown when POST /workflow-templates returns success with an empty list. */
export const WORKFLOW_TEMPLATES_NO_ACCESS_MESSAGE =
	"未查询到可访问的工作流模板，您可能没有相关权限。请联系管理员申请工作流访问权限。";

export function assertWorkflowTemplatesFound(
	items: TemplateSearchItem[],
	query?: string,
): void {
	if (items.length > 0) return;
	const suffix = query?.trim() ? `（搜索：${query.trim()}）` : "";
	throw new Error(`${WORKFLOW_TEMPLATES_NO_ACCESS_MESSAGE}${suffix}`);
}

export async function fetchWorkflowTemplates(
	client: StoApiClient,
	query: string,
	limit = DEFAULT_PAGE_SIZE,
): Promise<TemplateSearchItem[]> {
	// POST /agent/v1/workflow-templates — 官方推荐模板列表（分页搜索）
	// 仅返回 scope=system 的系统模板，后端服务层会过滤掉 personal 模板
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
		assertWorkflowTemplatesFound(templates, query);
		const first = templates[0]!;
		return {
			templateId: first.id,
			resolvedViaSearch: true,
			matchedLabel: first.label,
		};
	}
}
