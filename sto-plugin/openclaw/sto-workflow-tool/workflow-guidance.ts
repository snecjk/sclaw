type SchemaStep = { id: string; title: string; mode?: string; order?: number };
type SchemaField = { group?: string; groupTitle?: string; label?: string; order?: number };
type SchemaLike = { steps?: SchemaStep[]; fields?: SchemaField[] };

export function collectWorkflowConfirmStepTitles(schema: SchemaLike): string[] {
	const confirmStepIds = new Set(
		(schema.steps ?? [])
			.filter((step) => step.mode === "confirm" || !step.mode)
			.map((step) => step.id),
	);

	const fromSteps = (schema.steps ?? [])
		.filter((step) => confirmStepIds.has(step.id))
		.sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
		.map((step) => step.title.trim())
		.filter(Boolean);

	if (fromSteps.length > 0) return fromSteps;

	const seen = new Set<string>();
	const fromGroups: string[] = [];
	for (const field of [...(schema.fields ?? [])].sort(
		(a, b) => (a.order ?? 0) - (b.order ?? 0),
	)) {
		const title = field.groupTitle?.trim() || field.label?.trim();
		if (!title || seen.has(title)) continue;
		seen.add(title);
		fromGroups.push(title);
	}
	return fromGroups;
}

export function buildSchemaConfirmationGuidance(
	templateName: string,
	schema: SchemaLike,
): {
	confirmSteps: string[];
	assistantReplyGuide: string;
	nextStep: string;
} {
	const confirmSteps = collectWorkflowConfirmStepTitles(schema);
	const stepList = confirmSteps.length
		? confirmSteps.map((title, index) => `${index + 1}. ${title}`).join("\n")
		: "（客户端将分步展示参数确认）";

	const assistantReplyGuide = [
		`工作流「${templateName}」的参数由客户端分步表单展示，无需在对话中列举字段 key 或默认值表格。`,
		"你的回复：最多 3～5 句业务说明，概括需确认的环节：",
		stepList,
		"禁止：输出字段英文名/常量名、参数对照表、Markdown 表格复述 schema。",
		"若客户端已弹出表单，可只写「请在下方表单中逐步确认」。",
	].join("\n");

	const nextStep = [
		"停止调用工具。客户端将自动展示分步参数表单。",
		"回复仅允许业务摘要（见 confirmSteps），禁止列字段 key/默认值表。",
		"ParameterForm 标记可由客户端自动注入，无需在正文重复参数明细。",
	].join(" ");

	return { confirmSteps, assistantReplyGuide, nextStep };
}
