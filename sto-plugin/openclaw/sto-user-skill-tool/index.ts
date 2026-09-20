import { Type } from "./typebox-shim.js";
import { definePluginEntry, type OpenClawPluginApi } from "./api.js";
import { defineStoTool } from "./define-sto-tool.js";
import {
	postSaveUserSkill,
	postDeleteUserSkill,
	scheduleOrphanSkillImportViaHost,
	type UserSkillToolPluginConfig,
} from "./host-api-client.js";
import {
	evaluateUserSkillWriteGuard,
	shouldScheduleOrphanImportAfterTool,
} from "./user-skill-write-guard.js";

const TAG = "sto-user-skill-tool";

const USER_SKILL_SYSTEM_PROMPT = [
	"用户技能保存（save_user_skill，硬性规则）：",
	"- 在会话中**创建或更新用户技能**时，必须调用 `save_user_skill`，传入完整 `skillMd`（含 YAML frontmatter 的 name + description）与 `slug`。",
	"- ⛔ **禁止**用 write / edit / apply_patch / Bash 把技能写到 `openclaw/skills`、`workspace/skills`、`skills-store`——系统会拦截；那样也不会进入「我的技能」。",
	"- 可选 `assets` 附加相对技能根的文件；禁止路径穿越（`..`）。",
	"- 用户明确要求删除技能时调用 delete_user_skill，传入准确 slug；目标不明时询问，禁止直接删除技能目录。",
	"- 同 slug 默认覆盖已有用户技能；系统预装白名单 slug 会被拒绝。",
].join("\n");

export default definePluginEntry({
	id: "sto-user-skill-tool",
	name: "StoClaw 用户技能保存工具",
	description: "将会话创建的技能写入 skills-store 用户目录，并拦截直接写技能目录",
	register(api: OpenClawPluginApi) {
		const cfg = (api.pluginConfig ?? {}) as UserSkillToolPluginConfig;
		api.logger.info?.(
			`[${TAG}] registering host=${cfg.hostApiHost ?? "127.0.0.1"}:${cfg.hostApiPort ?? 3210}`,
		);

		api.on("before_prompt_build", async () => ({
			appendSystemContext: USER_SKILL_SYSTEM_PROMPT,
		}));

		api.on(
			"before_tool_call",
			(event) => {
				const decision = evaluateUserSkillWriteGuard({
					toolName: event.toolName,
					params: (event.params ?? {}) as Record<string, unknown>,
				});
				if (decision.blocked) {
					api.logger.warn?.(
						`[${TAG}] blocked tool=${event.toolName} path=${decision.matchedPath ?? "(n/a)"}`,
					);
					return {
						block: true,
						blockReason: decision.reason,
					};
				}
			},
			{ priority: 120 },
		);

		api.on(
			"after_tool_call",
			(event) => {
				if (
					shouldScheduleOrphanImportAfterTool({
						toolName: event.toolName,
						params: (event.params ?? {}) as Record<string, unknown>,
					})
				) {
					void scheduleOrphanSkillImportViaHost(cfg, "openclaw-after-skill-path-tool").catch(
						(error) => {
							api.logger.warn?.(
								`[${TAG}] orphan import schedule failed: ${error instanceof Error ? error.message : String(error)}`,
							);
						},
					);
				}
			},
			{ priority: 120 },
		);

		defineStoTool(api, {
      id: "delete_user_skill", domain: "user-skill", resultType: "user_skill_deleted",
      label: "删除用户技能",
      description: "仅当用户明确要求删除技能时调用，传入准确 slug；目标不明时询问。只删除当前用户技能，保护预装和共享技能。",
      parameters: Type.Object({ slug: Type.String({ minLength: 1 }) }),
      execute: async (params) => {
        const payload = await postDeleteUserSkill(cfg, { slug: params.slug });
        return payload.data ?? payload;
      },
    });
		defineStoTool(api, {
			id: "save_user_skill",
			domain: "user-skill",
			resultType: "user_skill_saved",
			label: "保存用户技能",
			description: [
				"将会话创建/更新的技能写入当前登录用户的 skills-store（「我的技能」）。",
				"必须传入完整 SKILL.md 文本（含 name/description frontmatter）。",
				"禁止仅用 write 写到 openclaw/skills 或 workspace/skills（会被拦截）。",
			].join(" "),
			parameters: Type.Object({
				slug: Type.Optional(
					Type.String({
						description: "技能 slug（小写、连字符）；缺省时从 frontmatter name 推导",
					}),
				),
				skillMd: Type.String({
					description: "完整 SKILL.md 内容（必须含 YAML frontmatter）",
				}),
				name: Type.Optional(Type.String({ description: "可选显示名覆盖" })),
				description: Type.Optional(Type.String({ description: "可选描述覆盖" })),
				assets: Type.Optional(
					Type.Array(
						Type.Object({
							path: Type.String({ description: "相对技能根的文件路径" }),
							content: Type.String({ description: "文件内容" }),
							encoding: Type.Optional(
								Type.Union([Type.Literal("utf8"), Type.Literal("base64")], {
									description: "默认 utf8",
								}),
							),
						}),
					),
				),
				force: Type.Optional(
					Type.Boolean({
						description: "默认 true：覆盖已有同 slug 用户技能；false 则已存在时报错",
					}),
				),
			}),
			execute: async (params) => {
				const payload = await postSaveUserSkill(cfg, {
					slug: params.slug,
					skillMd: params.skillMd,
					name: params.name,
					description: params.description,
					assets: params.assets,
					force: params.force,
				});
				return payload.data ?? payload;
			},
		});
	},
});
