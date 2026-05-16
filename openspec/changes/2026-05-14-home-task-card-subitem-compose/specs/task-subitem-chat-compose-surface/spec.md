# Capability: `task-subitem-chat-compose-surface`（本 change 新增）

## 新增需求

### Requirement: 子项会话与普通会话列表隔离

任务子项内产生的用户消息与助手回复 MUST 仅在该子项页的聊天内容区（及该子项绑定的会话 transcript）中呈现与管理。应用主路径中的**普通会话列表**（例如聊天页左侧会话列表或等价 UI）MUST NOT 为同一子项会话再展示一条用户可独立点击的并列会话项；若底层仍存在可被 `sessions.list` 返回的会话键，UI MUST 过滤或聚合，使用户感知上仅能从任务子项入口进入该对话。

#### Scenario: 子项发送后全局列表无并列项

- **WHEN** 用户在任务子项页完成一次由本能力触发的自动或手动发送并产生助手回复
- **THEN** 用户在聊天页打开普通会话列表时 MUST NOT 看到与子项对话重复的一条新会话标题或重复入口

### Requirement: 专用会话键与切换

每个 `(taskId, entryId)` MUST 映射到稳定唯一的 `sessionKey`（命名规则与 `design.md` 一致，且须通过 Gateway 实测验证）。子项页在展示或发送前 MUST `switchSession`（或等价动作）至该 `sessionKey`，且 MUST NOT 调用会创建「新的主会话列表项」且与全局列表可见性冲突的 `newSession` 行为，除非实现证明其不会违反「无并列项」条款。

#### Scenario: 进入子项后消息与发送归属正确会话

- **WHEN** 用户导航至 `/tasks/hq-reconciliation/2026-05-14`
- **THEN** 聊天存储中的当前会话键 MUST 对应该子项专用 `sessionKey`
- **AND** 随后发送的消息 MUST 写入该会话 transcript

### Requirement: 网关就绪前不得发送、就绪后按意图自动发送

当导航状态表明 **`entryBootstrap: 'created'`**（或等价）且存在未消费的自动发送意图（含该卡片绑定的 prompt 键）时：若网关状态不为就绪（与首页助手判定一致，例如非 `running`），系统 MUST NOT 调用 `sendMessage`；网关首次变为就绪后，系统 MUST 自动发起**一轮**发送，使用意图中绑定的卡片 prompt 文案；该轮 MUST 使用与既有 Chat 相同的发送链路。发送与流式接收 MUST 不经由 renderer 直连 Gateway HTTP。

当导航状态表明 **`entryBootstrap: 'reused'`**（或等价）时：系统 **MUST NOT** 因本次导航调用 `sendMessage` 进行自动代发，**无论**网关是否就绪。

#### Scenario: 新建路径 — 网关未就绪时等待

- **WHEN** 用户携带 `entryBootstrap: 'created'` 与有效自动发送意图进入子项页且网关未就绪
- **THEN** 系统 MUST NOT 在未就绪瞬间丢弃该意图并静默不发
- **AND** 系统 MUST 在网关就绪后自动完成该轮发送

#### Scenario: 新建路径 — 网关就绪后完成一轮

- **WHEN** 网关已就绪且 `entryBootstrap: 'created'` 的自动发送意图仍有效
- **THEN** 系统 MUST 发起发送并等待该轮运行至完成（`sending` 等与 run 结束相关的 store 状态满足 design 定义之「本轮完成」条件）

#### Scenario: 复用路径 — 不得自动发送

- **WHEN** 用户携带 `entryBootstrap: 'reused'` 进入子项页
- **THEN** 系统 MUST NOT 调用 `sendMessage` 发送该卡片默认 prompt
- **AND** 系统 MUST NOT 向输入区注入该默认 prompt 以模拟用户发送

### Requirement: 复用当日子项时滚动至会话底部

当导航状态为 **`entryBootstrap: 'reused'`**（或等价）时，子项页在 `switchSession` 且聊天历史加载完成后 **MUST** 将会话消息列表滚动至底部（或等价保证用户可见最后一条消息），除非消息列表为空（此时为 no-op）。**MUST NOT** 依赖用户手动滚动才能看到最新一条。

#### Scenario: 复用路径滚底

- **WHEN** 用户经首页卡片进入已存在的当日子项且路由状态为复用路径
- **THEN** 在历史加载完成后聊天主区 MUST 展示列表底部附近内容（最新消息在视口内或可立即滚动到达）

### Requirement: 自动发送意图一次性消费

**仅**在 **`entryBootstrap: 'created'`** 路径下：自动发送意图（含 prompt 键与来源卡片标识）MUST 在成功触发发送逻辑后**一次性消费**；用户刷新子项页 MUST NOT 在无新的首页卡片点击时重复自动发送同一 prompt。

**`entryBootstrap: 'reused'`** 路径 **MUST NOT** 产生可消费的自动发送意图。

#### Scenario: 刷新不重复自动发送（新建路径）

- **WHEN** 用户已完成一次由 `created` 路径触发的自动发送后刷新同一子项 URL（且无新的导航状态）
- **THEN** 系统 MUST NOT 再次自动发送同一默认 prompt

### Requirement: 子项未读与已读

当子项会话中出现**新的**助手可见输出且用户未满足已读条件时，系统 MUST 将该子项标记为未读并在侧栏显示红点徽标。已读条件 MUST 至少包含：用户已导航至该子项路由且聊天历史已加载完成（具体字段与时机与 `design.md` 一致）；满足后 MUST 清除未读状态。

#### Scenario: 有助手输出且用户未进入子项

- **WHEN** 子项会话本轮已完成且用户当前路由不是该子项页
- **THEN** 该子项 MUST 为未读且侧栏 MUST 显示行尾红点

#### Scenario: 进入子项后已读

- **WHEN** 用户导航至该子项页且历史加载完成
- **THEN** 该子项 MUST 清除未读状态且红点 MUST 消失
