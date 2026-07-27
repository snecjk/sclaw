# Context

技能广场列表由 `SkillPlazaService.getPlazaSkills` 拉取 STO `GET /agent/v1/skills/plaza`，经 snake→camel 归一化与 `overlayLocalState` 叠加本地安装态（`skills-store` 优先）。安装/更新统一走 `SkillManager`。本地预装由 `ensurePreinstalledSkillsInstalled` + `resources/skills/preinstalled-manifest.json` 在启动时完成。

远端新增 `force_update` / `is_builtin` 后，需要在「每次拉广场列表」时静默补齐，且不与本地预装抢真源。

# Goals / Non-Goals

**Goals:**

- 列表接口返回不阻塞；自动同步后台执行。
- `forceUpdate`：已装且远端版本更新 → `install({ force: true })`。
- `isBuiltin`：未装 → `install({ force: false })`；已装不因内置重复装。
- 本地预装白名单 / `stoclaw-preinstalled` 跳过强制更新与内置补装。
- 批处理去重 + 批末单次 Gateway 通知。

**Non-Goals:**

- 不替换 `preinstalled-manifest` 本地预装。
- 不在首版加自动同步 toast / 进度条。
- 不改变手动安装/更新按钮语义。
- 不在 Renderer 发起自动安装（避免漏触发）。

# Decisions

## Decision: 主进程在 getPlazaSkills 归一化后调度（方案 1）

Rationale: 与版本比对、本地态同一处；凡走 Host API 拉广场列表都会触发；不依赖前端记住调用。

Alternative considered: Renderer 拉完列表再调 auto-sync API。多一跳且非广场页易漏，放弃。

Alternative considered: 仅登录 `activateUserWorkspace` 扫一次。不满足「每次请求远端列表」，放弃。

## Decision: fire-and-forget + 模块内 in-flight

`getPlazaSkills` 先返回 `PlazaListResult`，再 `void PlazaSkillAutoSync.schedule(skills)`。模块用 Set 记录 in-flight slug；`SkillManager` 已有 per-slug `installLocks`。

Rationale: 列表延迟不变；并发刷新幂等。

Alternative considered: await 全部安装再返回。用户感知卡顿，放弃。

## Decision: is_builtin 与本地预装职责分离

`isBuiltin` 仅处理远端市场包；若 slug ∈ `readPreinstalledManifestSlugs()` 或本地 source/marker 为预装，则跳过内置自动安装与强制更新。

Rationale: 产品选择 B；避免双写与预装覆盖策略冲突。

Alternative considered: 远端内置完全替代本地预装。迁移成本高、离线首启不可用，放弃。

## Decision: force_update 仅升级已安装

未安装的 `forceUpdate` 不自动安装；安装由 `isBuiltin` 或用户操作负责。

Rationale: 字段语义清晰。

## Decision: 批末单次引擎刷新

Auto-sync 批量完成后调用一次 reconcile / `notifyGatewayAfterSkillBatch`（或等价批末钩子），避免每个 slug 一次 reload。

Rationale: 降低 Gateway 抖动。

Alternative considered: 依赖每次 `fanOut` 的 `onAfterBatch`。N 技能 ≈ N 次 debounce 仍可能抖，批末更稳。

# Risks / Trade-offs

| Risk | Mitigation |
|------|------------|
| [Risk] 列表频繁刷新重复下载 | in-flight Set + 版本已对齐跳过 + installLocks |
| [Risk] Gateway 刷新风暴 | 批末单次 notify |
| [Risk] 与登录云同步并行 | 双方均「已装跳过」；同 slug 锁串行 |
| [Risk] 预装被远端 force 覆盖 | 预装白名单 / stoclaw-preinstalled 跳过 |
| [Risk] 列表页短暂仍显示未更新 | 下次列表/本地刷新校正；首版可接受 |

# Documentation

- OpenSpec 本 change；实现后如 README 描述广场安装行为则同步三语 README。
