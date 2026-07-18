# Purpose

定义主进程中引擎无关的技能生命周期编排边界:以中立规范库为唯一事实真源,通过统一的引擎适配器把技能的安装、更新、卸载、启用对称下发到所有已注册引擎,并以幂等 reconcile 维持最终一致。

# Requirements

### Requirement: 技能事实真源位于引擎无关的中立规范库
系统 SHALL 以 `~/.stoclaw/skills-store/`(含 `global/`、`users/{userCode}/skills/`、`agents/{agentId}/skills/`)及其 `manifest.json` 作为技能包与元数据的唯一事实真源。各引擎的运行目录与引擎配置(如 `openclaw/skills`、`skills-disabled`、`openclaw.json`、`.claude/skills`)MUST 被视为从规范库重建的投影产物,而非真源。

#### Scenario: 安装一个市场技能
- **WHEN** 编排器安装一个技能
- **THEN** 系统 SHALL 先把技能包写入规范库对应作用域目录并更新 `manifest.json`,再据此投影到各引擎运行目录

#### Scenario: 引擎运行目录被外部删除后再次 reconcile
- **WHEN** 某引擎运行目录中的技能副本丢失或损坏,而规范库中该技能仍存在且启用
- **THEN** 下一次 reconcile SHALL 依据规范库重建该引擎的技能副本

### Requirement: 技能生命周期由单一编排器统管
安装、更新、卸载、启用/禁用 MUST 通过单一 `SkillManager` 编排器执行;下载、解压、目录 hoist、SKILL.md frontmatter 规整、版本比对、规范库与 manifest 写入等引擎无关逻辑 MUST 只在编排器中实现,MUST NOT 在各引擎适配器中重复实现。

#### Scenario: 更新一个已安装技能
- **WHEN** 请求将一个技能更新到更高版本
- **THEN** 编排器 SHALL 复用安装流程(强制覆盖)完成版本比对、规范库替换与 manifest 更新,并把新版本投影到各引擎

### Requirement: 引擎通过统一适配器接口接入
每个引擎 MUST 通过实现统一的 `EngineSkillAdapter` 接口接入,并在适配器注册表中注册;编排器 SHALL 在每次生命周期变更后遍历已注册适配器下发投影。新增引擎 MUST 仅通过新增一个适配器实现,移除某引擎链路 MUST 仅通过从注册表移除其适配器实现,且 MUST NOT 影响规范库或其它引擎的技能状态。

#### Scenario: 从注册表移除一个引擎适配器
- **WHEN** 某引擎适配器从注册表移除
- **THEN** 后续的安装/卸载/reconcile SHALL 不再向该引擎投影,而规范库与其余已注册引擎的技能状态 SHALL 保持不变

#### Scenario: 卸载技能时对称清理
- **WHEN** 编排器卸载一个技能
- **THEN** 系统 SHALL 从规范库删除该技能及其 manifest 条目,并遍历所有已注册适配器移除各引擎中的对应副本

### Requirement: 生命周期变更即时对称下发到所有引擎
安装、更新、卸载、启用/禁用 SHALL 在规范库写入成功后即时下发到所有已注册引擎,MUST NOT 依赖后续对话或延迟任务才在某一引擎生效。

#### Scenario: 市场安装后当前 Claude 会话即时可用
- **WHEN** 用户在技能市场安装一个技能且存在进行中的引擎上下文
- **THEN** 系统 SHALL 在安装操作内即时把该技能投影到 OpenClaw 与 Claude 两引擎的运行目录

### Requirement: 启用态与技能配置以 manifest 为单一真源
技能的启用/禁用状态与 `apiKey`/`env` 配置 MUST 以规范库 `manifest.json` 为单一真源;各适配器 SHALL 将该状态与配置投影到各自引擎所需的格式(如 OpenClaw 的目录位置与 `openclaw.json` 条目)。

#### Scenario: 禁用一个技能
- **WHEN** 用户禁用一个技能
- **THEN** 系统 SHALL 将 manifest 中该技能标记为禁用,并投影使其从各引擎的启用集合中移除(OpenClaw 移入 `skills-disabled`、Claude 移除镜像)

### Requirement: 幂等 reconcile 维持最终一致并处理 agent 级技能
编排器 SHALL 提供幂等的 `reconcile` 操作,依据规范库为给定用户与 agent 上下文计算期望技能集合,并对齐目标引擎(补齐缺失、更新变化、移除多余的受管副本);reconcile MUST 可安全重复执行且在无差异时不产生变更。reconcile SHALL 在 Claude 对话开始前、用户工作区激活时、启动引导时被调用。

#### Scenario: Claude 对话开始前对齐技能
- **WHEN** 一个 Claude 对话开始且指定了 agentId
- **THEN** 编排器 SHALL 对 Claude 引擎执行 reconcile,使全局启用技能与该 agent 的 agent 级技能均镜像到 Claude 运行目录

#### Scenario: 重复 reconcile 无副作用
- **WHEN** 在无技能变更的情况下连续执行两次 reconcile
- **THEN** 第二次 reconcile SHALL 不产生任何文件写入或删除

### Requirement: 适配器投影失败不回滚真源并由 reconcile 自愈
规范库写入 MUST 作为生命周期操作的事务边界;当某引擎适配器投影失败时,系统 SHALL 记录失败的技能与引擎、MUST NOT 回滚规范库,并 SHALL 依赖后续 reconcile 使该引擎恢复一致。

#### Scenario: 某引擎投影失败
- **WHEN** 安装期间某一引擎的投影抛出错误
- **THEN** 系统 SHALL 保留规范库中已写入的技能与 manifest、记录该引擎的失败,并在下一次 reconcile 时补齐该引擎的副本

### Requirement: 非受管的引擎技能目录受冲突保护
当某引擎运行目录中已存在同名技能但缺少本编排链路写入的受管标记(marker)时,适配器 MUST 跳过该技能、MUST NOT 覆盖或删除该目录,并 SHALL 将其记为冲突以便诊断。

#### Scenario: Claude 运行目录存在用户手放的同名技能
- **WHEN** `.claude/skills/{slug}` 已存在且不含受管 marker,而规范库中存在同名启用技能
- **THEN** reconcile SHALL 跳过该技能且不修改该目录,并将其计入跳过的冲突列表

### Requirement: 一次性迁移现有安装数据到规范库
系统 SHALL 提供一次性迁移:当规范库不存在时,从现有 `~/.stoclaw/openclaw/users/{code}/skills`、`~/.stoclaw/openclaw/skills`(含预装标记)与 `lock.json` 构建规范库与 manifest,并在完成后写入迁移完成标记;迁移完成后 SHALL 执行一次全引擎 reconcile 以据规范库重建各引擎投影。迁移 MUST NOT 在部分失败时破坏现有可用的引擎运行目录。

#### Scenario: 首次启动执行迁移
- **WHEN** 应用启动且 `~/.stoclaw/skills-store/` 尚不存在但存在旧安装数据
- **THEN** 系统 SHALL 构建规范库与 manifest、写入迁移完成标记,并执行一次全引擎 reconcile

#### Scenario: 迁移已完成后再次启动
- **WHEN** 迁移完成标记已存在
- **THEN** 系统 SHALL 跳过迁移而直接使用现有规范库
