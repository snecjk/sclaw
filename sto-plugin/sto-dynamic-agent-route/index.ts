import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { definePluginEntry, type OpenClawPluginApi } from "./api.js";

const PROVIDER_ID = "sto-dynamic-agent-route";
const DEFAULT_TIMEOUT_MS = 3000;
const DEFAULT_SSO_AUTH_PATH = "~/.openclaw/sso-auth.json";
const TAG = "sto-dynamic-agent-route";

type StoDynamicRouteConfig = {
	routeApiUrl?: string;
	routeApiKey?: string;
	providerBaseUrl?: string;
	providerApiKey?: string;
	defaultModel?: string;
	timeoutMs?: number;
	ssoAuthPath?: string;
};

type RouteApiRequest = {
	prompt: string;
	agentId?: string;
	channelId?: string;
	sessionKey?: string;
};

type RouteApiResponse = {
	shouldOverride: boolean;
	model?: string;
};

type SsoAuthInfo = {
	userName?: string;
	stoToken?: string;
};

// Bridge for passing agent context from before_model_resolve hook to wrapStreamFn.
// The execution order within a single agent run is deterministic:
//   before_model_resolve → model resolution → wrapStreamFn → LLM call
// This variable captures the latest hook context so wrapStreamFn can inject it as headers.
let lastHookAgentContext: { agentId?: string; channelId?: string; sessionKey?: string } = {};

function resolveTildePath(filePath: string): string {
	if (filePath.startsWith("~/") || filePath.startsWith("~\\")) {
		return resolve(homedir(), filePath.slice(2));
	}
	return resolve(filePath);
}

async function readSsoAuth(ssoAuthPath: string): Promise<SsoAuthInfo> {
	const resolved = resolveTildePath(ssoAuthPath);
	const raw = await readFile(resolved, "utf-8");
	const parsed = JSON.parse(raw) as Record<string, unknown>;
	return {
		userName: typeof parsed.userName === "string" ? parsed.userName : undefined,
		stoToken: typeof parsed.stoToken === "string" ? parsed.stoToken : undefined,
	};
}

export default definePluginEntry({
	id: "sto-dynamic-agent-route",
	name: "申通动态模型路由",
	description: "申通动态模型路由插件，通过远程路由接口在 before_model_resolve 时动态切换模型 provider。",
	register(api: OpenClawPluginApi) {
		const pluginCfg = (api.pluginConfig ?? {}) as StoDynamicRouteConfig;
		const routeApiUrl = pluginCfg.routeApiUrl?.trim();
		const routeApiKey = pluginCfg.routeApiKey?.trim();
		const providerBaseUrl = pluginCfg.providerBaseUrl?.trim();
		const providerApiKey = pluginCfg.providerApiKey?.trim();
		const defaultModel = pluginCfg.defaultModel?.trim();
		const timeoutMs = pluginCfg.timeoutMs ?? DEFAULT_TIMEOUT_MS;
		const ssoAuthPath = pluginCfg.ssoAuthPath?.trim() || DEFAULT_SSO_AUTH_PATH;

		const ENV_VAR = "STO_DYNAMIC_ROUTE_API_KEY";

		api.logger.info?.(
			`[${TAG}] plugin registering — routeApiUrl=${routeApiUrl ?? "(not set)"}, providerBaseUrl=${providerBaseUrl ?? "(not set)"}, defaultModel=${defaultModel ?? "(not set)"}, ssoAuthPath=${ssoAuthPath}`,
		);

		// Register the OpenAI-completions compatible provider.
		// The provider is only active when providerBaseUrl, providerApiKey, and defaultModel are configured.
		api.registerProvider({
			id: PROVIDER_ID,
			label: "STO Dynamic Route",
			envVars: [ENV_VAR],
			auth: [],
			catalog: {
				order: "simple",
				run: async (ctx) => {
					if (!providerBaseUrl || !providerApiKey || !defaultModel) {
						api.logger.debug?.(
							`[${TAG}] catalog: provider inactive — missing providerBaseUrl=${!providerBaseUrl}, providerApiKey=${!providerApiKey}, defaultModel=${!defaultModel}`,
						);
						return null;
					}
					api.logger.debug?.(
						`[${TAG}] catalog: returning provider config — baseUrl=${providerBaseUrl}, model=${defaultModel}`,
					);
					return {
						provider: {
							baseUrl: providerBaseUrl,
							api: "openai-completions" as const,
							apiKey: providerApiKey,
							models: [
								{
									id: defaultModel,
									name: defaultModel,
									reasoning: false,
									input: ["text" as const],
									cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
									contextWindow: 128_000,
									maxTokens: 16_384,
								},
							],
						},
					};
				},
			},
			// Inject SSO auth info + agent context as HTTP headers on every model request.
			wrapStreamFn: (ctx) => {
				api.logger.debug?.(
					`[${TAG}] wrapStreamFn: wrapping stream for model=${ctx.modelId}, provider=${ctx.provider}`,
				);
				const underlying = ctx.streamFn;
				return async (model, context, options) => {
					const extraHeaders: Record<string, string> = {};

					// Inject agent context captured from before_model_resolve hook.
					if (lastHookAgentContext.agentId) {
						extraHeaders["X-Sto-Agent-Id"] = lastHookAgentContext.agentId;
					}
					if (lastHookAgentContext.channelId) {
						extraHeaders["X-Sto-Channel-Id"] = lastHookAgentContext.channelId;
					}
					if (lastHookAgentContext.sessionKey) {
						extraHeaders["X-Sto-Session-Key"] = lastHookAgentContext.sessionKey;
					}

					// Inject SSO auth info (userName, stoToken) from local file.
					const resolvedSsoPath = resolveTildePath(ssoAuthPath);
					api.logger.debug?.(`[${TAG}] wrapStreamFn: reading SSO auth from ${resolvedSsoPath}`);
					try {
						const ssoAuth = await readSsoAuth(ssoAuthPath);
						if (ssoAuth.userName) {
							extraHeaders["X-Sto-User-Name"] = ssoAuth.userName;
						}
						if (ssoAuth.stoToken) {
							extraHeaders["X-Sto-Token"] = ssoAuth.stoToken;
						}
						api.logger.debug?.(
							`[${TAG}] wrapStreamFn: SSO auth loaded — userName=${ssoAuth.userName ?? "(not set)"}, stoToken=${ssoAuth.stoToken ? "(set)" : "(not set)"}`,
						);
					} catch (err) {
						api.logger.warn?.(
							`[${TAG}] wrapStreamFn: failed to read SSO auth from ${resolvedSsoPath} (${String(err)}), sending request without SSO headers`,
						);
					}

					api.logger.info?.(
						`[${TAG}] wrapStreamFn: forwarding request to model=${model.id} with ${Object.keys(extraHeaders).length} extra headers [${Object.keys(extraHeaders).join(", ")}]`,
					);

					const streamFn =
						underlying ??
						(() => {
							throw new Error(
								`${TAG}: no underlying stream function available`,
							);
						});
					return streamFn(model, context, {
						...options,
						headers: {
							...options?.headers,
							...extraHeaders,
						},
					});
				};
			},
		});

		// Register the before_model_resolve hook.
		// Calls the remote routing API to decide whether to override to our provider.
		// Also captures agent context for wrapStreamFn to use as HTTP headers.
		api.on("before_model_resolve", async (event, ctx) => {
			api.logger.debug?.(
				`[${TAG}] before_model_resolve: fired — agentId=${ctx.agentId ?? "(none)"}, channelId=${ctx.channelId ?? "(none)"}, prompt="${event.prompt}"}"`,
			);

			if (ctx.trigger != "user") {
				api.logger.info(`[${ctx.trigger}] using default model.`)
				return undefined;
			}


			// Capture agent context for wrapStreamFn to inject as headers later.
			lastHookAgentContext = {
				agentId: ctx.agentId,
				channelId: ctx.channelId,
				sessionKey: ctx.sessionKey,
			};

			if (!routeApiUrl) {
				api.logger.debug?.(
					`[${TAG}] before_model_resolve: routeApiUrl not configured, skipping routing check`,
				);
				return undefined;
			}

			const body: RouteApiRequest = {
				prompt: event.prompt,
				agentId: ctx.agentId,
				channelId: ctx.channelId,
				sessionKey: ctx.sessionKey,
			};

			const headers: Record<string, string> = {
				"Content-Type": "application/json",
			};
			if (routeApiKey) {
				headers["Authorization"] = `Bearer ${routeApiKey}`;
			}

			const ssoAuth = await readSsoAuth(ssoAuthPath);
			if (ssoAuth.userName) {
				headers["X-Sto-User-Name"] = ssoAuth.userName;
			}
			if (ssoAuth.stoToken) {
				headers["X-Sto-Token"] = ssoAuth.stoToken;
			}

			api.logger.info?.(
				`[${TAG}] before_model_resolve: calling routing API at ${routeApiUrl} (timeout=${timeoutMs}ms)`,
			);

			try {
				const resp = await fetch(routeApiUrl, {
					method: "POST",
					headers,
					body: JSON.stringify(body),
					signal: AbortSignal.timeout(timeoutMs),
				});

				api.logger.debug?.(
					`[${TAG}] before_model_resolve: routing API responded with status=${resp.status}`,
				);

				if (!resp.ok) {
					api.logger.warn?.(
						`[${TAG}] before_model_resolve: routing API returned ${resp.status}, using default model`,
					);
					return undefined;
				}

				const result = (await resp.json()) as RouteApiResponse;

				api.logger.info?.(
					`[${TAG}] before_model_resolve: routing API result — shouldOverride=${result.shouldOverride}, model=${result.model ?? "(none)"}`,
				);

				if (result.shouldOverride) {
					const modelOverride = result.model?.trim() || defaultModel;
					if (!modelOverride) {
						api.logger.warn?.(
							`[${TAG}] before_model_resolve: routing API returned shouldOverride but no model specified and no defaultModel configured`,
						);
						return undefined;
					}
					api.logger.info?.(
						`[${TAG}] before_model_resolve: overriding to provider=${PROVIDER_ID}, model=${modelOverride}`,
					);
					return {
						providerOverride: PROVIDER_ID,
						modelOverride,
					};
				}

				api.logger.debug?.(
					`[${TAG}] before_model_resolve: no override requested, using default model`,
				);
				return undefined;
			} catch (err) {
				api.logger.warn?.(
					`[${TAG}] before_model_resolve: routing check failed (${String(err)}), using default model`,
				);
				return undefined;
			}
		});

		api.logger.info?.(`[${TAG}] plugin registered successfully`);
	},
});
