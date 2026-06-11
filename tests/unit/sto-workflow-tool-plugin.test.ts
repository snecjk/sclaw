import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fetchJsonMock = vi.fn();

vi.mock("../../sto-plugin/sto-workflow-tool/sto-toolkit/http-client.js", () => ({
	createStoApiClient: () => ({
		fetchJson: fetchJsonMock,
		getBaseUrl: () => "https://sto.example.com",
	}),
}));

import register from "../../sto-plugin/sto-workflow-tool/index.js";

describe("sto-workflow-tool plugin", () => {
	const registerTool = vi.fn();
	const on = vi.fn();
	let fetchMock: ReturnType<typeof vi.fn>;

	beforeEach(() => {
		vi.clearAllMocks();
		fetchJsonMock.mockReset();
		fetchMock = vi.fn();
		globalThis.fetch = fetchMock as unknown as typeof fetch;
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	function buildApi(pluginConfig: Record<string, unknown> = {}) {
		return {
			pluginConfig: {
				baseUrl: "https://sto.example.com",
				ssoAuthPath: "/tmp/sso-auth.json",
				...pluginConfig,
			},
			logger: { info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
			registerTool,
			on,
		};
	}

	it("registers five workflow tools and before_prompt_build", async () => {
		const api = buildApi();
		register.register(api as never);
		expect(registerTool).toHaveBeenCalledTimes(5);
		expect(on).toHaveBeenCalledWith("before_prompt_build", expect.any(Function));
	});

	it("search_workflow_templates returns workflow_templates_found envelope", async () => {
		fetchJsonMock.mockResolvedValueOnce({
			matchedItems: [{ id: "tpl_1", label: "对账", matchScore: 0.9 }],
			recommendedItems: [],
		});

		const api = buildApi();
		register.register(api as never);
		const searchTool = registerTool.mock.calls.find(
			(c) => (c[0] as { id: string }).id === "search_workflow_templates",
		)?.[0] as { execute: Function };

		const result = await searchTool.execute({ query: "对账", limit: 5 }, {});
		const envelope = JSON.parse(result.content[0].text);
		expect(envelope.type).toBe("workflow_templates_found");
		expect(envelope.success).toBe(true);
		expect(envelope.data.templates).toHaveLength(1);
	});

	it("execute_workflow returns workflow_execution_started envelope", async () => {
		fetchJsonMock.mockResolvedValueOnce({
			runId: "run_abc",
			workflowId: "wf_816b0847",
			status: "running",
			startedAt: "2026-06-11T00:00:00Z",
		});

		const api = buildApi();
		register.register(api as never);
		const execTool = registerTool.mock.calls.find(
			(c) => (c[0] as { id: string }).id === "execute_workflow",
		)?.[0] as { execute: Function };

		const result = await execTool.execute(
			{ workflowId: "wf_816b0847", templateName: "客户异常监控" },
			{},
		);
		const envelope = JSON.parse(result.content[0].text);
		expect(envelope.type).toBe("workflow_execution_started");
		expect(envelope.data.runId).toBe("run_abc");
		expect(fetchJsonMock).toHaveBeenCalledWith(
			expect.stringContaining("/agent/v1/workflows/wf_816b0847/start"),
			expect.objectContaining({ method: "POST" }),
		);
	});
});
