# common

钉钉 Hub、SClaw Mobile、微信共用的会话编排层。

## 文件

- `session-facade.ts` — create/get session、send、binding 解析（含 wechat 动态 import）
- `session-key.ts` — `PlatformChannelType` 与 session key 编解码
- `session-lifecycle.ts` — 空闲拆会话（钉钉/微信有 TTL；mobile 永不）
- `session-new-flow.md` — **是否新开对话**完整流程说明（入口 / forceNew / 空闲 / 策略 C）
- `channel-session-title.ts` — 会话标题推导
- `stream-content-kind.ts` — think / tool / answer

## 依赖

- **静态依赖 hub**：`session-facade` → `../hub/binding-service`（既有环，刻意保留）
- **动态依赖 weixin**：`session-facade` → `../weixin/binding`（解环）

## 文档

- [是否新开对话流程](./session-new-flow.md)