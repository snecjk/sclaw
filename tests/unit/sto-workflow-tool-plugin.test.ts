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
		fetchJsonMock.mockResolvedValueOnce([
			{ id: "tpl_1", label: "对账", matchScore: 0.9 },
		]);

		const api = buildApi();
		register.register(api as never);
		const searchTool = registerTool.mock.calls.find(
			(c) => (c[0] as { id: string }).id === "search_workflow_templates",
		)?.[0] as { execute: Function };

		const result = await searchTool.execute("call_search", { query: "对账", limit: 5 });
		const envelope = JSON.parse(result.content[0].text);
		expect(envelope.type).toBe("workflow_templates_found");
		expect(envelope.success).toBe(true);
		expect(envelope.data.templates).toHaveLength(1);
		expect(envelope.data.templates[0].templateId).toBe("tpl_1");
		expect(fetchJsonMock).toHaveBeenCalledWith(
			"/agent/v1/workflow-templates",
			expect.objectContaining({
				method: "POST",
				body: JSON.stringify({ query: "对账", page: 1, pageSize: 5 }),
			}),
		);
	});

	it("search_workflow_templates returns permission error when API returns empty list", async () => {
		fetchJsonMock.mockResolvedValueOnce([]);

		const api = buildApi();
		register.register(api as never);
		const searchTool = registerTool.mock.calls.find(
			(c) => (c[0] as { id: string }).id === "search_workflow_templates",
		)?.[0] as { execute: Function };

		const result = await searchTool.execute("call_search", { query: "客户异常监控", limit: 10 });
		const envelope = JSON.parse(result.content[0].text);
		expect(envelope.success).toBe(false);
		expect(envelope.error.message).toMatch(/没有相关权限/);
		expect(envelope.error.message).toMatch(/客户异常监控/);
	});

	it("get_workflow_schema rejects missing templateId and query", async () => {
		const api = buildApi();
		register.register(api as never);
		const schemaTool = registerTool.mock.calls.find(
			(c) => (c[0] as { id: string }).id === "get_workflow_schema",
		)?.[0] as { execute: Function };

		const result = await schemaTool.execute("call_schema", {});
		const envelope = JSON.parse(result.content[0].text);
		expect(envelope.success).toBe(false);
		expect(envelope.error.message).toMatch(/缺少 templateId 或 query/);
		expect(fetchJsonMock).not.toHaveBeenCalled();
	}); 

	it("get_workflow_schema auto-searches templates when query is provided", async () => {
		fetchJsonMock
			.mockResolvedValueOnce([{ id: "tpl_2b794225", label: "云端agent测试-产物测试" }])
			.mockResolvedValueOnce({
				templateId: "tpl_2b794225",
				schemaHash: "hash_abc",
				schema: { fields: [], steps: [], nodeId: "n1", enabled: true },
			});

		const api = buildApi();
		register.register(api as never);
		const schemaTool = registerTool.mock.calls.find(
			(c) => (c[0] as { id: string }).id === "get_workflow_schema",
		)?.[0] as { execute: Function };

		const result = await schemaTool.execute("call_schema", {
			query: "云端agent测试-产物测试",
		});
		const envelope = JSON.parse(result.content[0].text);
		expect(envelope.type).toBe("workflow_schema_ready");
		expect(envelope.data.resolvedViaSearch).toBe(true);
		expect(fetchJsonMock).toHaveBeenNthCalledWith(
			1,
			"/agent/v1/workflow-templates",
			expect.objectContaining({ method: "POST" }),
		);
		expect(fetchJsonMock).toHaveBeenNthCalledWith(
			2,
			"/agent/v1/workflow-templates/tpl_2b794225/startup-schema",
			expect.objectContaining({ method: "GET" }),
		);
	});

	it("get_workflow_schema calls startup-schema with resolved templateId", async () => {
		fetchJsonMock.mockResolvedValueOnce({
			templateId: "tpl_2b794225",
			schemaHash: "hash_abc",
			schema: { fields: [], steps: [], nodeId: "n1", enabled: true },
		});

		const api = buildApi();
		register.register(api as never);
		const schemaTool = registerTool.mock.calls.find(
			(c) => (c[0] as { id: string }).id === "get_workflow_schema",
		)?.[0] as { execute: Function };

		const result = await schemaTool.execute("call_schema", { templateId: "tpl_2b794225" });
		const envelope = JSON.parse(result.content[0].text);
		expect(envelope.type).toBe("workflow_schema_ready");
		expect(envelope.data.confirmSteps).toBeDefined();
		expect(envelope.data.assistantReplyGuide).toMatch(/禁止/);
		expect(fetchJsonMock).toHaveBeenCalledWith(
			"/agent/v1/workflow-templates/tpl_2b794225/startup-schema",
			expect.objectContaining({ method: "GET" }),
		);
	});

	it("create_workflow rejects empty schemaHash before API call", async () => {
		const api = buildApi();
		register.register(api as never);
		const createTool = registerTool.mock.calls.find(
			(c) => (c[0] as { id: string }).id === "create_workflow",
		)?.[0] as { execute: Function };

		const result = await createTool.execute("call_create", {
			templateId: "tpl_1",
			schemaHash: "",
			values: {},
		});
		const envelope = JSON.parse(result.content[0].text);
		expect(envelope.success).toBe(false);
		expect(envelope.error.message).toMatch(/缺少 schemaHash/);
		expect(fetchJsonMock).not.toHaveBeenCalled();
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

		const result = await execTool.execute("call_exec", {
			workflowId: "wf_816b0847",
			templateName: "客户异常监控",
		});
		const envelope = JSON.parse(result.content[0].text);
		expect(envelope.type).toBe("workflow_execution_started");
		expect(envelope.data.runId).toBe("run_abc");
		expect(fetchJsonMock).toHaveBeenCalledWith(
			expect.stringContaining("/agent/v1/workflows/wf_816b0847/start"),
			expect.objectContaining({ method: "POST" }),
		);
	});
});
