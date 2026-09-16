# dingtalk

钉钉渠道说明目录。**可运行实现不在本目录**，而在：

- `../hub/` — Hub 绑定、WS、ingress、delivery、Host API routes
- `../common/` — session-facade / session-key / lifecycle

钉钉与 Mobile 共用 Hub，故传输层不放在 `dingtalk/`，避免 Mobile 反向依赖钉钉目录。

## 参考

- 伞说明：[`../README.md`](../README.md)
- 迁移计划：[`docs/钉钉Hub与Mobile迁入message-channel计划.md`](../../../docs/钉钉Hub与Mobile迁入message-channel计划.md)
