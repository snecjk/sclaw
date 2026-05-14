# Tasks：`2026-05-14-home-task-card-subitem-compose`

> 每项实现完成后勾选；须与对应 `### Requirement:` 名称可追溯。若实现触碰 gateway 事件、runtime send/receive、delivery 或 fallback，须执行 `pnpm run comms:replay` 与 `pnpm run comms:compare`（见 `openspec/config.yaml`）。

## 1. 路由与注册表

- [ ] 1.1 实现 `/tasks/:taskId` 与 `/tasks/:taskId/:entryId` 的合法/非法分支及重定向，满足 **Requirement: 任务列表稳定路由与任务键枚举**。
- [ ] 1.2 实现子项 `entryId`（本地日 `YYYY-MM-DD`）注册表持久化与排序，满足 **Requirement: 子项注册表持久化与顺序**。

## 2. 首页卡片与子项引导

- [ ] 2.1 已启用卡片点击：创建或复用当日子项、导航并写入一次性自动发送意图，满足 **Requirement: 首页概览卡与任务键对应并驱动子项创建**。
- [ ] 2.2 为每张已启用卡片配置 i18n 默认 prompt，满足 **Requirement: 国际化与可维护性** 中默认 prompt 条款。

## 3. 侧栏

- [ ] 3.1 主任务折叠、动态子项 `NavLink`、选中态与行尾未读红点（Danger 语义），满足 **Requirement: 侧栏「任务列表」分组与动态子项导航** 与 **Requirement: 子项未读与已读**。

## 4. 子项聊天面与网关

- [ ] 4.1 子项页聊天主区、`switchSession` 至专用 `sessionKey`、就绪后自动发送与本轮完成判定，满足 **Requirement: 专用会话键与切换**、**Requirement: 网关就绪前不得发送、就绪后自动发送**、**Requirement: 任务子项详情页信息结构（聊天为主）**。
- [ ] 4.2 自动发送意图一次性消费与防刷新重发，满足 **Requirement: 自动发送意图一次性消费**。
- [ ] 4.3 发送路径仅 host-api / 既有 Chat store，满足 **Requirement: 任务子项详情页信息结构（聊天为主）** 中发送条款。

## 5. 全局会话列表

- [ ] 5.1 过滤或隐藏任务子项专用 `sessionKey`，满足 **Requirement: 子项会话与普通会话列表隔离**。

## 6. 验证与文档

- [ ] 6.1 必要单元/组件或 E2E 覆盖：同日复用、网关延迟发送、未读/已读、列表无并列项（按项目测试惯例选型）。
- [ ] 6.2 审阅 `README.md`、`README.zh-CN.md`、`README.ja-JP.md` 是否需追加路由或行为一句说明。
- [ ] 6.3 若本轮改动触及 comms 路径：运行 `pnpm run comms:replay` 与 `pnpm run comms:compare`。
