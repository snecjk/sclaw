# host

Host API helpers shared by channel product surfaces (not Hub/Weixin transport).

| 文件 | 职责 |
| --- | --- |
| `list.ts` | `/api/channels/accounts` 列表：OC 配置视图 + Hub 钉钉合并 + 微信 Host Worker 合并 |

微信扫码路由在 `../weixin/routes.ts`；通用 config CRUD 仍在 `electron/api/routes/channels.ts` 薄壳。
