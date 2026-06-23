import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { definePluginEntry, type OpenClawPluginApi } from "./api.js";

const PROVIDER_ID = "sto-dynamic-agent-route";
const DEFAULT_MODEL_ID = "sto-route-model";
const DEFAULT_TIMEOUT_MS = 10000;
const DEFAULT_SSO_AUTH_PATH = "~/.stoclaw/openclaw/sso-auth.json";
const TAG = "sto-dynamic-agent-route";

type StoDynamicRouteConfig = {
	routeApiUrl?: string;
	providerBaseUrl?: string;
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
	realName?: string;
	stoToken?: string;
	companyCode?: string;
	companyName?: string;
	departmentCode?: string;
	departmentName?: string;
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
		realName: typeof parsed.realName === "string" ? parsed.realName : undefined,
		stoToken: typeof parsed.stoToken === "string" ? parsed.stoToken : undefined,
		companyCode: typeof parsed.companyCode === "string" ? parsed.companyCode : undefined,
		companyName: typeof parsed.companyName === "string" ? parsed.companyName : undefined,
		departmentCode: typeof parsed.departmentCode === "string" ? parsed.departmentCode : undefined,
		departmentName: typeof parsed.departmentName === "string" ? parsed.departmentName : undefined,
	};
}

export default definePluginEntry({
	id: "sto-dynamic-agent-route",
	name: "申通动态模型路由",
	description: "申通动态模型路由插件，通过远程路由接口在 before_model_resolve 时动态切换模型 provider。",
	register(api: OpenClawPluginApi) {
		const pluginCfg = (api.pluginConfig ?? {}) as StoDynamicRouteConfig;
		const routeApiUrl = pluginCfg.routeApiUrl?.trim();
		const providerBaseUrl = pluginCfg.providerBaseUrl?.trim();
		const timeoutMs = pluginCfg.timeoutMs ?? DEFAULT_TIMEOUT_MS;
		const ssoAuthPath = pluginCfg.ssoAuthPath?.trim() || DEFAULT_SSO_AUTH_PATH;

		const ENV_VAR = "STO_DYNAMIC_ROUTE_API_KEY";

		api.logger.info?.(
			`[${TAG}] plugin registering — routeApiUrl=${routeApiUrl ?? "(not set)"}, providerBaseUrl=${providerBaseUrl ?? "(not set)"}, ssoAuthPath=${ssoAuthPath}`,
		);

		// Register the OpenAI-completions compatible provider.
		// The provider is only active when providerBaseUrl and defaultModel are configured.
		api.registerProvider({
			id: PROVIDER_ID,
			label: "STO Dynamic Route",
			envVars: [ENV_VAR],
			auth: [],
			catalog: {
				order: "simple",
				run: async (ctx) => {
					if (!providerBaseUrl) {
						api.logger.debug?.(
							`[${TAG}] catalog: provider inactive — missing providerBaseUrl=${!providerBaseUrl}`,
						);
						return null;
					}
					api.logger.debug?.(
						`[${TAG}] catalog: returning provider config — baseUrl=${providerBaseUrl}`,
					);
					return {
						provider: {
							baseUrl: providerBaseUrl,
							api: "openai-completions" as const,
							apiKey: "default",
							models: [
								{
									id: DEFAULT_MODEL_ID,
									name: DEFAULT_MODEL_ID,
									reasoning: false,
									input: ["text" as const, "image" as const],
									cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
									contextWindow: 128_0000,
									maxTokens: 16_3840,
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
					const modelOverride = result.model?.trim() || DEFAULT_MODEL_ID;
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


			// Inject current SSO user info into the system prompt so the model knows
			// the default organization/site context and does not ask the user for it.
			api.on("before_prompt_build", async (_event, ctx) => {
				api.logger.debug?.(
					`[${TAG}] before_prompt_build: fired — agentId=${ctx.agentId ?? "(none)"}, sessionKey=${ctx.sessionKey ?? "(none)"}`,
				);

				const appendBlocks: string[] = [];

				// 产物文件引用规范：所有会话（含定时任务/工作流总结）统一约束，
				// 防止模型把云端运行时路径当作可访问链接输出给用户。
				appendBlocks.push([
					"产物文件引用规范（重要）：",
					"- 当回复中引用用户可查看或下载的本地产物文件（HTML 报告、PDF、表格、文档等）时，必须输出绝对路径，并优先使用 file:// URL 的 Markdown 链接格式：[文件名](file:///绝对路径)。",
					"- 严禁输出相对路径链接（如 [report.md](report.md)、outputs/...、./.claw-output/...、./...）；必须写成绝对路径。",
					"- Windows 路径必须规范为 file:///C:/...（使用正斜杠），不要输出 file://C:\\... 或反斜杠版本。",
					"- 如果执行结果仅提供 http(s) 可访问地址（如 OSS 链接）且没有本地绝对路径，则使用该 http(s) 链接；不要伪造 file:// 路径。",
					"- 严禁向用户输出运行环境内部且用户不可访问的伪本地路径（如 /runtime/、/tmp/）作为 file:// 链接。",
				].join("\n"));

				try {
					const ssoAuth = await readSsoAuth(ssoAuthPath);
					if (ssoAuth.userName) {
						const lines: string[] = [];
						lines.push("当前登录用户信息（已认证）：");
						if (ssoAuth.userName) lines.push(`- 用户名：${ssoAuth.userName}`);
						if (ssoAuth.realName) lines.push(`- 真实姓名：${ssoAuth.realName}`);
						if (ssoAuth.companyCode) lines.push(`- 网点编码（companyCode）：${ssoAuth.companyCode}`);
						if (ssoAuth.companyName) lines.push(`- 网点名称（companyName）：${ssoAuth.companyName}`);
						if (ssoAuth.departmentCode) lines.push(`- 组织编码（departmentCode）：${ssoAuth.departmentCode}`);
						if (ssoAuth.departmentName) lines.push(`- 组织名称（departmentName）：${ssoAuth.departmentName}`);
						lines.push("");
						lines.push("⚠️ 重要：当调用任何技能、工具或工作流时，如果参数要求提供网点编码（companyCode）或组织编码（departmentCode），而用户没有明确指定其他网点/组织，必须直接使用上述当前登录用户的网点编码和组织编码，禁止向用户询问。不要在对话中要求用户提供这些信息。");
						appendBlocks.push(lines.join("\n"));
						api.logger.debug?.(`[${TAG}] before_prompt_build: injected SSO user context for ${ssoAuth.userName}`);
					} else {
						api.logger.debug?.(`[${TAG}] before_prompt_build: no SSO auth found, skipping SSO context injection`);
					}
				} catch (err) {
					api.logger.warn?.(`[${TAG}] before_prompt_build: failed to read SSO auth (${String(err)}), skipping SSO context injection`);
				}

				return { appendSystemContext: appendBlocks.join("\n\n") };
			});

		api.logger.info?.(`[${TAG}] plugin registered successfully`);
	},
});
