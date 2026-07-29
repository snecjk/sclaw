import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { RETIRED_SKILLS_SYSTEM_PROMPT } from "./shared/retired-skills.js";
import { buildWorkspaceArtifactOutputRule } from "./shared/workspace-paths.js";
import { definePluginEntry, type OpenClawPluginApi } from "./api.js";

const DEFAULT_SSO_AUTH_PATH = "~/.stoclaw/openclaw/sso-auth.json";
const TAG = "sto-dynamic-agent-route";

type StoContextConfig = {
	ssoAuthPath?: string;
};

type SsoAuthInfo = {
	userName?: string;
	realName?: string;
	companyCode?: string;
	companyName?: string;
	departmentCode?: string;
	departmentName?: string;
};

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
		companyCode: typeof parsed.companyCode === "string" ? parsed.companyCode : undefined,
		companyName: typeof parsed.companyName === "string" ? parsed.companyName : undefined,
		departmentCode: typeof parsed.departmentCode === "string" ? parsed.departmentCode : undefined,
		departmentName: typeof parsed.departmentName === "string" ? parsed.departmentName : undefined,
	};
}

/** Resolve absolute workspace path for an agent from openclaw.json (project agents included). */
async function resolveAgentWorkspaceAbsolutePath(agentId: string | undefined): Promise<string | null> {
	const id = (agentId ?? "").trim().toLowerCase() || "main";
	try {
		const configPath = join(homedir(), ".stoclaw", "openclaw", "openclaw.json");
		const raw = await readFile(configPath, "utf-8");
		const config = JSON.parse(raw) as {
			agents?: {
				defaults?: { workspace?: string };
				list?: Array<{ id?: string; workspace?: string }>;
			};
		};
		const entry = config.agents?.list?.find(
			(item) => (item?.id ?? "").trim().toLowerCase() === id,
		);
		const workspace =
			(typeof entry?.workspace === "string" && entry.workspace.trim())
			|| (typeof config.agents?.defaults?.workspace === "string"
				? config.agents.defaults.workspace.trim()
				: "");
		if (!workspace) return null;
		return resolveTildePath(workspace);
	} catch {
		return null;
	}
}

export default definePluginEntry({
	id: "sto-dynamic-agent-route",
	name: "申通运行上下文",
	description: "注入当前登录用户、组织信息、工作区产物规则及废弃技能约束。",
	register(api: OpenClawPluginApi) {
		const pluginCfg = (api.pluginConfig ?? {}) as StoContextConfig;
		const ssoAuthPath = pluginCfg.ssoAuthPath?.trim() || DEFAULT_SSO_AUTH_PATH;

		api.logger.info?.(`[${TAG}] plugin registering — ssoAuthPath=${ssoAuthPath}`);

		api.on("before_prompt_build", async (_event, ctx) => {
			api.logger.debug?.(
				`[${TAG}] before_prompt_build: fired — agentId=${ctx.agentId ?? "(none)"}, sessionKey=${ctx.sessionKey ?? "(none)"}`,
			);

			const appendBlocks: string[] = [RETIRED_SKILLS_SYSTEM_PROMPT];

			// 产物文件引用规范：注入本会话 workspace 的绝对 .claw-output，
			// 防止会话产物写到项目根目录而不是子目录。
			const workspaceAbsolutePath = await resolveAgentWorkspaceAbsolutePath(ctx.agentId);
			appendBlocks.push([
				"产物文件引用规范（重要）：",
				buildWorkspaceArtifactOutputRule(undefined, { workspaceAbsolutePath }),
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
