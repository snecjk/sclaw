export function resolveSearchQuery(params: Record<string, unknown>): string | null {
	for (const key of ["query", "searchQuery", "keyword"] as const) {
		const value = params[key];
		if (typeof value === "string") {
			const trimmed = value.trim();
			if (trimmed) return trimmed;
		}
	}
	return null;
}

export function resolveTemplateId(params: Record<string, unknown>): string {
	for (const key of ["templateId", "id", "template_id"] as const) {
		const value = params[key];
		if (typeof value === "string") {
			const trimmed = value.trim();
			if (trimmed && trimmed !== "undefined") return trimmed;
		}
	}
	throw new Error(
		"缺少 templateId：必须先调用 search_workflow_templates，再将其返回的 templates[].id 作为 templateId 传入",
	);
}

export function resolveSchemaHash(params: Record<string, unknown>): string {
	const value = params.schemaHash;
	if (typeof value === "string") {
		const trimmed = value.trim();
		if (trimmed) return trimmed;
	}
	throw new Error(
		"缺少 schemaHash：必须先调用 get_workflow_schema 获取 schemaHash，禁止传空字符串",
	);
}
