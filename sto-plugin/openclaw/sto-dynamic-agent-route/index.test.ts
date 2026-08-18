import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OpenClawPluginApi } from "./api.js";
import register from "./index.js";

type HookResult = { appendSystemContext?: string } | undefined;
type HookHandler = (
	...args: Array<Record<string, unknown>>
) => HookResult | Promise<HookResult>;

describe("sto-dynamic-agent-route runtime-context plugin", () => {
	const hooks: Record<string, HookHandler> = {};
	let tempDir: string;

	function buildApi(pluginConfig: Record<string, unknown> = {}) {
		for (const key of Object.keys(hooks)) delete hooks[key];
		return {
			pluginConfig,
			config: {},
			id: "sto-dynamic-agent-route",
			name: "申通运行上下文",
			logger: { info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
			on: vi.fn((hookName: string, handler: HookHandler) => {
				hooks[hookName] = handler;
			}),
			registerProvider: vi.fn(),
		};
	}

	beforeEach(async () => {
		vi.clearAllMocks();
		tempDir = join(tmpdir(), `sto-context-test-${Date.now()}`);
		await mkdir(tempDir, { recursive: true });
	});

	afterEach(async () => {
		await rm(tempDir, { recursive: true, force: true });
		vi.restoreAllMocks();
	});

	it("registers only the prompt-context hook", () => {
		const fetchSpy = vi.spyOn(globalThis, "fetch");
		const api = buildApi({
			providerBaseUrl: "https://legacy-model.example.com",
			routeApiUrl: "https://legacy-route.example.com",
		});
		register.register(api as unknown as OpenClawPluginApi);

		expect(api.on).toHaveBeenCalledTimes(1);
		expect(api.on).toHaveBeenCalledWith("before_prompt_build", expect.any(Function));
		expect(api.registerProvider).not.toHaveBeenCalled();
		expect(hooks.before_model_resolve).toBeUndefined();
		expect(fetchSpy).not.toHaveBeenCalled();
	});

	it("injects workspace, retired-skill, and authenticated organization context", async () => {
		const ssoPath = join(tempDir, "sso-auth.json");
		await writeFile(
			ssoPath,
			JSON.stringify({
				userName: "test-user",
				realName: "Test User",
				companyCode: "430000",
				companyName: "Test Company",
				departmentCode: "430001",
				departmentName: "Test Department",
			}),
		);
		const api = buildApi({ ssoAuthPath: ssoPath });
		register.register(api as unknown as OpenClawPluginApi);

		const result = await hooks.before_prompt_build(
			{ prompt: "hello", messages: [] },
			{ agentId: "agent-1", sessionKey: "session-1", trigger: "user" },
		);

		expect(result?.appendSystemContext).toContain("已废弃技能与插件");
		expect(result?.appendSystemContext).toContain("产物文件引用规范");
		expect(result?.appendSystemContext).toContain("当前登录用户信息（已认证）");
		expect(result?.appendSystemContext).toContain("用户名：test-user");
		expect(result?.appendSystemContext).toContain("网点编码（companyCode）：430000");
		expect(result?.appendSystemContext).toContain("组织编码（departmentCode）：430001");
	});

	it("retains policy context when the auth file is missing", async () => {
		const api = buildApi({ ssoAuthPath: join(tempDir, "missing.json") });
		register.register(api as unknown as OpenClawPluginApi);

		const result = await hooks.before_prompt_build(
			{ prompt: "hello", messages: [] },
			{ agentId: "agent-1", sessionKey: "session-1", trigger: "user" },
		);

		expect(result?.appendSystemContext).toContain("已废弃技能与插件");
		expect(result?.appendSystemContext).toContain("产物文件引用规范");
		expect(result?.appendSystemContext).not.toContain("当前登录用户信息（已认证）");
		expect(api.logger.warn).toHaveBeenCalledWith(
			expect.stringContaining("failed to read SSO auth"),
		);
	});
});
