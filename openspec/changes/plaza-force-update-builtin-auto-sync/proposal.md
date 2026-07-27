# Why

技能广场远端接口新增 `force_update`（是否强制更新）与 `is_builtin`（是否内置技能）。产品要求：

1. **强制更新**：每次请求远端广场列表时，若技能标记强制更新且本地已安装版本落后于远端，客户端 MUST 自动更新，无需用户点击。
2. **内置技能**：远端标记为内置且本地未安装时，MUST 自动安装；本地 `preinstalled-manifest` 继续负责打包预装，二者职责分离（内置字段只补远端市场包）。

若仍依赖用户手动点「安装/更新」，关键技能无法保证全员到位，运营侧无法用字段闭环。

# What Changes

- 透传广场 API 字段 `force_update` / `is_builtin` 到 `SkillSummary`（`forceUpdate` / `isBuiltin`）。
- 新增主进程 `PlazaSkillAutoSync`：在 `SkillPlazaService.getPlazaSkills` 完成本地态叠加后，异步调度自动安装/强制更新。
- 自动同步走现有 `SkillManager.install`（规范库 + 引擎适配器），批末收敛 Gateway 刷新，避免 N 次 reload。
- 不替代本地预装链路；对 `stoclaw-preinstalled` / 预装白名单技能跳过强制更新与重复内置安装。
- 首版不做自动同步 toast；列表刷新后自然显示「已安装」。

# Capabilities

## New Capabilities

- `skills-plaza-auto-sync`: 技能广场列表返回后，基于 `forceUpdate` / `isBuiltin` 与本地安装态异步自动安装或强制更新。

## Modified Capabilities

- None（广场列表归一化与安装仍属现有广场服务 / SkillManager；本 change 以新能力描述自动同步边界）。

# Impact

- `electron/services/skill-plaza-service.ts`：字段透传 + 调度 auto-sync。
- 新增 `electron/services/plaza-skill-auto-sync.ts`（或 `electron/services/skills/plaza-skill-auto-sync.ts`）。
- 类型：`src/types/skill-plaza.ts` 与主进程 `SkillSummary` 对齐。
- 复用 `SkillManager.install`、`skill-version` 比对、`readPreinstalledManifestSlugs`。
- 无 Renderer 必改 UI；无 dark-mode 新控件；不改 OpenClaw 插件打包脚本。
