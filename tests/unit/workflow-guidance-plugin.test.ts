import { describe, expect, it } from "vitest";
import {
	buildSchemaConfirmationGuidance,
	collectWorkflowConfirmStepTitles,
} from "../../sto-plugin/sto-workflow-tool/workflow-guidance.js";

describe("workflow-guidance plugin", () => {
	it("collects confirm step titles from schema", () => {
		expect(
			collectWorkflowConfirmStepTitles({
				steps: [
					{ id: "s1", title: "数据取数", mode: "confirm", order: 1 },
					{ id: "s2", title: "数据处理", mode: "confirm", order: 2 },
				],
				fields: [],
			}),
		).toEqual(["数据取数", "数据处理"]);
	});

	it("builds assistant guidance without field keys", () => {
		const guidance = buildSchemaConfirmationGuidance("产物测试", {
			steps: [{ id: "s1", title: "数据取数", mode: "confirm", order: 1 }],
			fields: [],
		});
		expect(guidance.confirmSteps).toEqual(["数据取数"]);
		expect(guidance.assistantReplyGuide).toContain("禁止");
		expect(guidance.nextStep).toContain("分步参数表单");
	});
});
