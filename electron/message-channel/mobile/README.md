# mobile

SClaw Mobile（申懂懂 App）渠道特有逻辑。

## 文件

- `history-facade.ts` — 历史列表 / 详情 RPC（由 `hub/startup` 在 `historyRpc` 事件上动态挂载）

绑定、入站、出站、共用 Hub WS 均在 `../hub/`；会话编排在 `../common/`。
