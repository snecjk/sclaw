# @sto/sclaw-plugin-sso-auth

SClaw 独立站点的身份认证基础插件。本地预览复用当前 SClaw 登录态，发布后完成 STO SSO 登录、回跳换票和会话管理。

该插件只支持 `site` 应用。`assets` 应用由宿主提供身份，不应安装或导入本包。

## 入口

- `@sto/sclaw-plugin-sso-auth`：浏览器身份 API。
- `@sto/sclaw-plugin-sso-auth/runtime`：SClaw 静态插件注册入口。
- `@sto/sclaw-plugin-sso-auth/vite`：仅在 `vite serve` 生效的本地同源身份桥接。

本地预览由 SClaw Dev Server 注入服务端 Session 环境变量，浏览器只访问 `/__sto/sso-auth/bootstrap`。生产构建不会携带该本地桥接；发布 Site 优先使用 code-deploy 按 `sto-sso-auth/v1` 契约注入的公开配置。未注入公开配置时，插件会根据非本地域名推断发布环境，并使用内置的已批准 SSO 配置矩阵启动。

## 验证

```bash
npm test
npm run typecheck
npm run build
```

仓库根目录可运行 `node scripts/verify-sso-auth-package.mjs`，对真实 npm tarball 和临时 Site 模板执行安装、类型检查、构建及敏感标记扫描。
