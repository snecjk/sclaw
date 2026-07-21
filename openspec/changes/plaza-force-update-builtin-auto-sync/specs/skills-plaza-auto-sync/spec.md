## ADDED Requirements

### Requirement: 广场列表透传强制更新与内置标记
系统 MUST 将远端广场技能的 `force_update` / `is_builtin` 归一化为 `SkillSummary.forceUpdate` / `SkillSummary.isBuiltin`（缺省为 false）。主进程与 Renderer 类型定义 MUST 保持字段一致。

#### Scenario: 远端返回新字段
- **WHEN** 广场列表 API 某技能含 `"force_update": true` 与 `"is_builtin": true`
- **THEN** 归一化后的该技能 MUST 具有 `forceUpdate === true` 且 `isBuiltin === true`

#### Scenario: 远端省略新字段
- **WHEN** 广场列表 API 某技能未返回上述字段
- **THEN** 归一化结果 MUST 将对应布尔字段视为 false（或不触发自动同步）

### Requirement: 强制更新技能在列表叠加本地态后自动更新
每次 `getPlazaSkills`（或等价、已叠加本地安装态的广场列表路径）完成后，系统 MUST 异步检查：对 `forceUpdate === true`、本地已安装、且远端版本新于本地安装版本的技能，调用 `SkillManager.install` 并 `force: true`。列表 HTTP/Host 响应 MUST NOT 等待该更新完成。对本地预装（manifest 白名单或 `stoclaw-preinstalled` / 预装 marker）技能，系统 MUST NOT 因 `forceUpdate` 自动覆盖。

#### Scenario: 已装且版本落后
- **WHEN** 列表中技能 `forceUpdate` 为 true、本地已安装、且远端 version 新于本地 installedVersion
- **THEN** 系统 SHALL 异步强制重新安装该技能到规范库并投影引擎，且列表响应已先返回

#### Scenario: 版本已对齐
- **WHEN** 技能 `forceUpdate` 为 true 但本地版本不落后于远端
- **THEN** 系统 MUST NOT 因强制更新再次下载安装

#### Scenario: 未安装仅有 forceUpdate
- **WHEN** 技能 `forceUpdate` 为 true 但本地未安装
- **THEN** 系统 MUST NOT 仅因 `forceUpdate` 自动安装（除非同时满足内置自动安装条件）

### Requirement: 远端内置技能未安装时自动安装
对 `isBuiltin === true` 且本地未安装的技能，系统 MUST 在广场列表叠加本地态后异步调用 `SkillManager.install`（`force: false`），且 MUST NOT 替代本地 `preinstalled-manifest` 预装链路。若 slug 已由本地预装白名单或预装 source/marker 覆盖，系统 MUST 跳过内置自动安装。

#### Scenario: 远端内置且未安装
- **WHEN** 列表中技能 `isBuiltin` 为 true 且本地未安装，且不属于本地预装覆盖范围
- **THEN** 系统 SHALL 异步安装该技能，列表响应不阻塞

#### Scenario: 远端内置但已安装
- **WHEN** 技能 `isBuiltin` 为 true 且本地已安装
- **THEN** 系统 MUST NOT 仅因内置标记重复安装（升级由 `forceUpdate` 或用户更新负责）

### Requirement: 自动同步去重与批末刷新
自动同步模块 MUST 对同一 slug 的并发调度去重，并 MUST 在一批自动安装/更新结束后收敛引擎刷新（避免每个技能各触发一次 Gateway 重载风暴）。失败 MUST 记录日志且 MUST NOT 导致广场列表接口失败。

#### Scenario: 短时间重复拉列表
- **WHEN** 用户短时间内多次触发广场列表且同一 slug 仍需自动同步
- **THEN** 系统 MUST NOT 并行启动多个针对该 slug 的安装事务

#### Scenario: 批量自动更新多个技能
- **WHEN** 单次列表结果中有多个技能需要自动安装或强制更新
- **THEN** 系统 SHALL 在该批完成后以收敛方式通知引擎刷新，而非无节制地逐技能强制重载
