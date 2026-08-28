# 外部服务接入

通过 SClaw 的受控外部服务能力接入业务 API。

## 工作流程

1. 先执行 `pnpm sclaw:services -- search "<关键词>"` 搜索已注册服务。
2. 用户确认服务后执行 `pnpm sclaw:services -- bind <serviceId> [version] [alias]`。不得自行编造域名、服务 ID 或版本。
3. 执行 `pnpm sclaw:services -- list`，读取 `contracts/external-services.v1.json` 中已绑定服务的 `usageGuide`。
4. 业务代码只从 `src/sclaw/services.generated.ts` 使用服务客户端。
5. 没有 usageGuide 时，向用户确认 method、path、params 和 response 后再写业务调用。

## 安全边界

- 禁止把 Token、Cookie、SSO code 或密钥写入代码、JSON、URL和日志。
- 禁止手工修改托管代理、服务版本或真实域名。
- 本地访问由 `/proxy/<alias>` 代理；发布地址由发布环境配置选择。
- 升级必须由用户明确选择版本：`pnpm sclaw:services -- upgrade <alias> <version>`。
- 移除使用 `pnpm sclaw:services -- remove <alias>`。
