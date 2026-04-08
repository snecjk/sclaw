import { writeFile, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import register from "./index.js";

const PROVIDER_ID = "sto-dynamic-agent-route";

describe("sto-dynamic-agent-route plugin", () => {
	const hooks: Record<string, Function> = {};
	let registerProviderCalls: unknown[] = [];

	function buildApi(pluginConfig: Record<string, unknown> = {}) {
		registerProviderCalls = [];
		for (const key of Object.keys(hooks)) delete hooks[key];

		return {
			pluginConfig,
			config: {},
			id: "sto-dynamic-agent-route",
			name: "申通动态模型路由",
			logger: { info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
			on: vi.fn((hookName: string, handler: Function) => {
				hooks[hookName] = handler;
			}),
			registerProvider: vi.fn((provider: unknown) => {
				registerProviderCalls.push(provider);
			}),
		};
	}

	let originalFetch: typeof globalThis.fetch;

	beforeEach(() => {
		vi.clearAllMocks();
		originalFetch = globalThis.fetch;
		globalThis.fetch = vi.fn() as unknown as typeof globalThis.fetch;
	});

	afterEach(() => {
		globalThis.fetch = originalFetch;
		vi.restoreAllMocks();
	});

	it("registers a provider and before_model_resolve hook", () => {
		const api = buildApi();
		register.register(api as any);

		expect(api.registerProvider).toHaveBeenCalledTimes(1);
		expect(api.registerProvider).toHaveBeenCalledWith(
			expect.objectContaining({ id: PROVIDER_ID, label: "STO Dynamic Route" }),
		);
		expect(api.on).toHaveBeenCalledTimes(1);
		expect(api.on).toHaveBeenCalledWith("before_model_resolve", expect.any(Function));
	});

	describe("provider catalog", () => {
		it("returns null when required config is missing", async () => {
			const api = buildApi({});
			register.register(api as any);

			const provider = registerProviderCalls[0] as any;
			const result = await provider.catalog.run({});
			expect(result).toBeNull();
		});

		it("returns provider config when fully configured", async () => {
			const api = buildApi({
				providerBaseUrl: "https://api.example.com/v1",
				providerApiKey: "sk-test-key",
				defaultModel: "qwen-72b",
			});
			register.register(api as any);

			const provider = registerProviderCalls[0] as any;
			const result = await provider.catalog.run({});

			expect(result).toEqual({
				provider: {
					baseUrl: "https://api.example.com/v1",
					api: "openai-completions",
					apiKey: "sk-test-key",
					models: [
						expect.objectContaining({
							id: "qwen-72b",
							name: "qwen-72b",
						}),
					],
				},
			});
		});
	});

	describe("provider wrapStreamFn", () => {
		let tempDir: string;

		beforeEach(async () => {
			tempDir = join(tmpdir(), `sto-test-${Date.now()}`);
			await mkdir(tempDir, { recursive: true });
		});

		afterEach(async () => {
			await rm(tempDir, { recursive: true, force: true });
		});

		it("injects SSO auth headers from sso-auth.json", async () => {
			const ssoPath = join(tempDir, "sso-auth.json");
			await writeFile(
				ssoPath,
				JSON.stringify({ userName: "test-user", stoToken: "tok-123", nested: { a: 1 } }),
			);

			const api = buildApi({ ssoAuthPath: ssoPath });
			register.register(api as any);

			const provider = registerProviderCalls[0] as any;
			const mockStreamFn = vi.fn().mockResolvedValue({ text: "ok" });
			const wrappedFn = provider.wrapStreamFn({ streamFn: mockStreamFn });

			const model = { id: "test-model" };
			const context = {};
			await wrappedFn(model, context, { headers: { Existing: "header" } });

			expect(mockStreamFn).toHaveBeenCalledWith(model, context, {
				headers: expect.objectContaining({
					Existing: "header",
					"X-Sto-User-Name": "test-user",
					"X-Sto-Token": "tok-123",
				}),
			});
		});

		it("sends request without SSO headers when file does not exist", async () => {
			const api = buildApi({ ssoAuthPath: join(tempDir, "nonexistent.json") });
			register.register(api as any);

			const provider = registerProviderCalls[0] as any;
			const mockStreamFn = vi.fn().mockResolvedValue({ text: "ok" });
			const wrappedFn = provider.wrapStreamFn({ streamFn: mockStreamFn });

			await wrappedFn({ id: "m" }, {}, {});

			expect(mockStreamFn).toHaveBeenCalledWith({ id: "m" }, {}, { headers: {} });
			expect(api.logger.warn).toHaveBeenCalledWith(
				expect.stringContaining("failed to read SSO auth"),
			);
		});

		it("handles partial SSO auth (only userName present)", async () => {
			const ssoPath = join(tempDir, "sso-auth.json");
			await writeFile(ssoPath, JSON.stringify({ userName: "alice" }));

			const api = buildApi({ ssoAuthPath: ssoPath });
			register.register(api as any);

			const provider = registerProviderCalls[0] as any;
			const mockStreamFn = vi.fn().mockResolvedValue({ text: "ok" });
			const wrappedFn = provider.wrapStreamFn({ streamFn: mockStreamFn });

			await wrappedFn({ id: "m" }, {}, {});

			expect(mockStreamFn).toHaveBeenCalledWith({ id: "m" }, {}, {
				headers: expect.objectContaining({ "X-Sto-User-Name": "alice" }),
			});
		});

		it("injects agent context headers captured from before_model_resolve hook", async () => {
			const ssoPath = join(tempDir, "sso-auth.json");
			await writeFile(ssoPath, JSON.stringify({ userName: "bob", stoToken: "t" }));

			const api = buildApi({
				routeApiUrl: "https://route.example.com/api/resolve",
				providerBaseUrl: "https://api.example.com/v1",
				providerApiKey: "sk-test",
				defaultModel: "qwen-72b",
				ssoAuthPath: ssoPath,
			});
			register.register(api as any);

			// Simulate the before_model_resolve hook firing first (captures agent context).
			vi.mocked(globalThis.fetch).mockResolvedValue(
				new Response(JSON.stringify({ shouldOverride: false }), { status: 200 }),
			);
			await hooks.before_model_resolve(
				{ prompt: "test" },
				{ agentId: "my-agent", channelId: "discord", sessionKey: "sess-xyz" },
			);

			// Now call wrapStreamFn — it should include agent context headers.
			const provider = registerProviderCalls[0] as any;
			const mockStreamFn = vi.fn().mockResolvedValue({ text: "ok" });
			const wrappedFn = provider.wrapStreamFn({ streamFn: mockStreamFn });

			await wrappedFn({ id: "m" }, {}, {});

			const calledHeaders = mockStreamFn.mock.calls[0][2].headers;
			expect(calledHeaders).toMatchObject({
				"X-Sto-Agent-Id": "my-agent",
				"X-Sto-Channel-Id": "discord",
				"X-Sto-Session-Key": "sess-xyz",
				"X-Sto-User-Name": "bob",
				"X-Sto-Token": "t",
			});
		});
	});

	describe("before_model_resolve hook", () => {
		const defaultPluginConfig = {
			routeApiUrl: "https://route.example.com/api/resolve",
			routeApiKey: "route-key-123",
			providerBaseUrl: "https://api.example.com/v1",
			providerApiKey: "sk-test-key",
			defaultModel: "qwen-72b",
		};

		const hookEvent = { prompt: "hello world" };
		const hookCtx = { agentId: "agent-1", channelId: "telegram", sessionKey: "sess-abc" };

		it("returns override when routing API returns shouldOverride: true", async () => {
			const api = buildApi(defaultPluginConfig);
			register.register(api as any);

			vi.mocked(globalThis.fetch).mockResolvedValue(
				new Response(JSON.stringify({ shouldOverride: true }), { status: 200 }),
			);

			const result = await hooks.before_model_resolve(hookEvent, hookCtx);

			expect(result).toEqual({
				providerOverride: PROVIDER_ID,
				modelOverride: "qwen-72b",
			});
		});

		it("uses custom model from routing API response", async () => {
			const api = buildApi(defaultPluginConfig);
			register.register(api as any);

			vi.mocked(globalThis.fetch).mockResolvedValue(
				new Response(JSON.stringify({ shouldOverride: true, model: "gpt-4o-mini" }), {
					status: 200,
				}),
			);

			const result = await hooks.before_model_resolve(hookEvent, hookCtx);

			expect(result).toEqual({
				providerOverride: PROVIDER_ID,
				modelOverride: "gpt-4o-mini",
			});
		});

		it("returns undefined when routing API returns shouldOverride: false", async () => {
			const api = buildApi(defaultPluginConfig);
			register.register(api as any);

			vi.mocked(globalThis.fetch).mockResolvedValue(
				new Response(JSON.stringify({ shouldOverride: false }), { status: 200 }),
			);

			const result = await hooks.before_model_resolve(hookEvent, hookCtx);

			expect(result).toBeUndefined();
		});

		it("returns undefined and logs warning on non-200 response", async () => {
			const api = buildApi(defaultPluginConfig);
			register.register(api as any);

			vi.mocked(globalThis.fetch).mockResolvedValue(
				new Response("Internal Server Error", { status: 500 }),
			);

			const result = await hooks.before_model_resolve(hookEvent, hookCtx);

			expect(result).toBeUndefined();
			expect(api.logger.warn).toHaveBeenCalledWith(
				expect.stringContaining("routing API returned 500"),
			);
		});

		it("returns undefined and logs warning on network error", async () => {
			const api = buildApi(defaultPluginConfig);
			register.register(api as any);

			vi.mocked(globalThis.fetch).mockRejectedValue(new Error("ECONNREFUSED"));

			const result = await hooks.before_model_resolve(hookEvent, hookCtx);

			expect(result).toBeUndefined();
			expect(api.logger.warn).toHaveBeenCalledWith(
				expect.stringContaining("routing check failed"),
			);
		});

		it("returns undefined and logs warning on timeout", async () => {
			const api = buildApi({ ...defaultPluginConfig, timeoutMs: 1 });
			register.register(api as any);

			vi.mocked(globalThis.fetch).mockRejectedValue(new DOMException("Aborted", "AbortError"));

			const result = await hooks.before_model_resolve(hookEvent, hookCtx);

			expect(result).toBeUndefined();
			expect(api.logger.warn).toHaveBeenCalledWith(
				expect.stringContaining("routing check failed"),
			);
		});

		it("skips fetch when routeApiUrl is not configured", async () => {
			const api = buildApi({ providerBaseUrl: "https://api.example.com/v1" });
			register.register(api as any);

			const result = await hooks.before_model_resolve(hookEvent, hookCtx);

			expect(result).toBeUndefined();
			expect(globalThis.fetch).not.toHaveBeenCalled();
		});

		it("sends Authorization header when routeApiKey is configured", async () => {
			const api = buildApi(defaultPluginConfig);
			register.register(api as any);

			vi.mocked(globalThis.fetch).mockResolvedValue(
				new Response(JSON.stringify({ shouldOverride: false }), { status: 200 }),
			);

			await hooks.before_model_resolve(hookEvent, hookCtx);

			expect(globalThis.fetch).toHaveBeenCalledWith(
				"https://route.example.com/api/resolve",
				expect.objectContaining({
					method: "POST",
					headers: expect.objectContaining({
						Authorization: "Bearer route-key-123",
					}),
				}),
			);
		});

		it("omits Authorization header when routeApiKey is not configured", async () => {
			const api = buildApi({ ...defaultPluginConfig, routeApiKey: undefined });
			register.register(api as any);

			vi.mocked(globalThis.fetch).mockResolvedValue(
				new Response(JSON.stringify({ shouldOverride: false }), { status: 200 }),
			);

			await hooks.before_model_resolve(hookEvent, hookCtx);

			const fetchCall = vi.mocked(globalThis.fetch).mock.calls[0];
			const headers = (fetchCall[1] as any).headers as Record<string, string>;
			expect(headers).not.toHaveProperty("Authorization");
		});

		it("sends correct request body with prompt and context", async () => {
			const api = buildApi(defaultPluginConfig);
			register.register(api as any);

			vi.mocked(globalThis.fetch).mockResolvedValue(
				new Response(JSON.stringify({ shouldOverride: false }), { status: 200 }),
			);

			await hooks.before_model_resolve(hookEvent, hookCtx);

			const fetchCall = vi.mocked(globalThis.fetch).mock.calls[0];
			const body = JSON.parse((fetchCall[1] as any).body as string);
			expect(body).toEqual({
				prompt: "hello world",
				agentId: "agent-1",
				channelId: "telegram",
				sessionKey: "sess-abc",
			});
		});
	});
});
