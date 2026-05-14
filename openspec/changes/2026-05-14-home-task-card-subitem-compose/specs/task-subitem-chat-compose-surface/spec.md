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

### Requirement: 网关就绪前不得发送、就绪后自动发送

当存在未消费的「自动发送」意图且网关状态不为就绪（与首页助手判定一致，例如 `running`）时，系统 MUST NOT 调用 `sendMessage`（或等价发送）。网关首次变为就绪后，系统 MUST 自动发起**一轮**发送，使用意图中绑定的默认 prompt；该轮 MUST 使用与既有 Chat 相同的发送链路（含 `question:split` 等行为若仍适用）。发送与流式接收 MUST 不经由 renderer 直连 Gateway HTTP。

#### Scenario: 网关未就绪时等待

- **WHEN** 用户携带自动发送意图进入子项页且网关未就绪
- **THEN** 系统 MUST NOT 丢弃该意图在未就绪瞬间静默不发
- **AND** 系统 MUST 在网关就绪后自动完成该轮发送

#### Scenario: 网关就绪后完成一轮

- **WHEN** 网关已就绪且自动发送意图仍有效
- **THEN** 系统 MUST 发起发送并等待该轮运行至完成（`sending` 等与 run 结束相关的 store 状态满足 design 定义之「本轮完成」条件）

### Requirement: 自动发送意图一次性消费

自动发送意图（含默认 prompt 与来源卡片标识）MUST 在成功触发发送逻辑后**一次性消费**；用户刷新子项页 MUST NOT 在无新的用户操作（例如新的卡片点击）时无限重复自动发送。第二次及以后同日复用进入若由新的卡片点击触发，则 MUST 由新的意图实例驱动。

#### Scenario: 刷新不重复自动发送

- **WHEN** 用户已完成一次由意图触发的自动发送后刷新同一子项 URL
- **THEN** 系统 MUST NOT 再次自动发送同一默认 prompt，除非用户再次从首页卡片触发意图

### Requirement: 子项未读与已读

当子项会话中出现**新的**助手可见输出且用户未满足已读条件时，系统 MUST 将该子项标记为未读并在侧栏显示红点徽标。已读条件 MUST 至少包含：用户已导航至该子项路由且聊天历史已加载完成（具体字段与时机与 `design.md` 一致）；满足后 MUST 清除未读状态。

#### Scenario: 有助手输出且用户未进入子项

- **WHEN** 子项会话本轮已完成且用户当前路由不是该子项页
- **THEN** 该子项 MUST 为未读且侧栏 MUST 显示行尾红点

#### Scenario: 进入子项后已读

- **WHEN** 用户导航至该子项页且历史加载完成
- **THEN** 该子项 MUST 清除未读状态且红点 MUST 消失
