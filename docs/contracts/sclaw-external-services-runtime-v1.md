# SClaw External Services Runtime v1 契约

## 配置事实来源

应用通过 `contracts/external-services.v1.json` 保存已绑定服务的固定发布版本。文件包含服务标识、应用内 alias、daily/stage/online 三套公开 baseUrl、认证方式和可选 SDK/AI 使用说明，但不得包含 stoToken、Cookie、SSO code、API Key 或本地 Session Secret。

`src/sclaw/services.generated.ts` 和 `contracts/dev-proxy.v1.json` 都是由 SClaw 根据该配置生成的受管文件。发布前会校验三者一致性；配置非法或生成物漂移时禁止推送和部署。

未包含外部服务配置和受管生成物的旧应用视为“未启用该能力”，发布校验直接通过；只要出现任一外部服务配置或受管代理，就必须满足完整一致性校验。

## 环境解析

| 运行场景 | 服务地址来源 | 身份来源 |
|---|---|---|
| Site 本地预览 | 固定使用 `daily`，请求 `/proxy/<alias>/...` | 当前登录 SClaw 用户 |
| Assets 本地预览 | 固定使用 `daily`，请求 `/proxy/<alias>/...` | 当前登录 SClaw 用户 |
| Site 发布 | `window.__STO_SSO_AUTH_CONFIG__.deployEnv` | Site SSO Auth |
| Assets 发布 | `window.__SCLAW_APP_CONFIG__.deployEnv` | iframe 宿主 Token Bridge（第一期不实现） |

应用开发者选择发布环境时只影响发布配置，Agent 和服务绑定配置均不得覆盖该值。

## 调用边界

- 业务代码只从 `src/sclaw/services.generated.ts` 获取服务客户端。
- 请求 path 必须是以 `/` 开头的相对路径，禁止传入绝对 URL或协议相对 URL。
- `auth.type: "stoToken"` 仅允许绑定 `sto.cn` 或其子域名。
- `auth.type: "none"` 必须显式禁用 stoToken 注入。
- 本地 Vite 代理只代理 daily 地址，且保留 `dev-proxy.v1.json` 中的人工配置。
- Site 与 Assets 的发布域名必须预先加入目标服务的 CORS 白名单。

## Assets 第一期限制

Assets 发布后由 iframe 宿主负责身份。若应用绑定了 stoToken 服务，发布确认页会显示非阻断提示；宿主尚未提供 Token Bridge 时，运行时必须抛出 `AUTH_RUNTIME_UNAVAILABLE`，不得自行执行 SSO 跳转或从 URL 捕获 Token。
