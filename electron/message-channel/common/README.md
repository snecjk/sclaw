# common

钉钉 Hub、SClaw Mobile、微信共用的会话编排层。

## 文件

- `session-facade.ts` — create/get session、send、binding 解析（含 wechat 动态 import）
- `session-key.ts` — `PlatformChannelType` 与 session key 编解码
- `session-lifecycle.ts` — 空闲拆会话（钉钉/微信有 TTL；mobile 永不）
- `channel-session-title.ts` — 会话标题推导
- `stream-content-kind.ts` — think / tool / answer

## 依赖

- **静态依赖 hub**：`session-facade` → `../hub/binding-service`（既有环，刻意保留）
- **动态依赖 weixin**：`session-facade` → `../weixin/binding`（解环）
