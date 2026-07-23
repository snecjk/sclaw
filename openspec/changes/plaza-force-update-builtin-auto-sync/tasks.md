## 1. 类型与字段透传

- [x] 1.1 在 `src/types/skill-plaza.ts` 与主进程 `SkillSummary` 增加 `forceUpdate?` / `isBuiltin?`（Requirement: 广场列表透传强制更新与内置标记）
- [x] 1.2 在 `normalizeSkillSummary` / `convertPlazaListResponse` 从 `force_update` / `is_builtin` 映射上述字段，缺省 false（Requirement: 广场列表透传强制更新与内置标记）

## 2. PlazaSkillAutoSync

- [x] 2.1 新增 `electron/services/plaza-skill-auto-sync.ts`（或 `skills/` 下同级），实现 `schedule(skills: SkillSummary[])`：筛选强制更新与内置补装候选（Requirement: 强制更新技能在列表叠加本地态后自动更新；Requirement: 远端内置技能未安装时自动安装）
- [x] 2.2 候选规则：跳过本地预装白名单 / `stoclaw-preinstalled` / 预装 marker；`forceUpdate` 仅已装且 `isRemoteVersionNewer`；`isBuiltin` 仅未装（Requirement: 强制更新技能在列表叠加本地态后自动更新；Requirement: 远端内置技能未安装时自动安装）
- [x] 2.3 使用 in-flight Set + `SkillManager.install`；批末单次 Gateway/reconcile 通知；错误仅 warn（Requirement: 自动同步去重与批末刷新）

## 3. 挂载点

- [x] 3.1 在 `SkillPlazaService.getPlazaSkills` 完成 `overlayLocalState` 后 `void schedule(skills)`，不阻塞返回（Requirement: 强制更新技能在列表叠加本地态后自动更新；Requirement: 远端内置技能未安装时自动安装）

## 4. 验证

- [x] 4.1 单测：候选筛选（强制更新 / 内置 / 预装跳过 / 版本已对齐）（Requirement: 强制更新技能在列表叠加本地态后自动更新；Requirement: 远端内置技能未安装时自动安装）
- [x] 4.2 运行相关 `pnpm exec vitest`；必要时 `pnpm run typecheck`（Requirement: 自动同步去重与批末刷新）
