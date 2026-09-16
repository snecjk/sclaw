# message-channel

IM 渠道子系统目录（Host 编排 + 各渠道传输实现）。

## 当前状态

| 渠道 | 位置 | 状态 |
| --- | --- | --- |
| 微信 | `weixin/` | Phase 1 MVP（Host Worker + iLink transport） |
| 钉钉 | 实现仍在 `electron/channels/`；本伞下仅 `dingtalk/README.md` 占位 | **待微信渠道稳定上线后再迁入** |

## 约定

- 微信与钉钉在编排层汇合：复用 `electron/channels` 的 `session-facade`；微信出站不复用钉钉 `delivery`（typing + commit）。
- 不要在 `dingtalk/` 于迁入完成前添加可执行业务代码。
- 技术方案：[`docs/微信渠道-Host-Worker技术方案.md`](../../docs/微信渠道-Host-Worker技术方案.md)
- 微信 Worker 契约：`shared/weixin-runtime-protocol.ts`
- Phase 0 Spike：`weixin/runtime/spike/README.md`
