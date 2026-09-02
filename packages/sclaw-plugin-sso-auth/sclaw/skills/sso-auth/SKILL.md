---
name: sso-auth
description: Use when developing authentication-aware pages or data requests in a SClaw Site application that has the STO SSO Auth plugin installed.
---

# STO Site SSO Auth

SSO 是平台基础能力。业务页面只消费已初始化的身份，不实现登录协议。

## 使用方式

- 应用启动由生成的插件注册文件负责，不要在页面组件中再次启动认证。
- 业务代码需要当前身份时，通过 `getSsoAuth()` 读取 `getUser()` 或 `getToken()`。
- 接口返回未授权时调用 `handleUnauthorized()`，不要自行清 Cookie 或拼登录地址。
- 登出使用 `logout()`。

## 强制边界

- 不得在业务代码中读取、写入或解析 `stoToken` Cookie。
- 不得构造 SSO Login URL、Callback URL，或直接调用换票接口。
- 不得把 Token 放入 URL、源码、日志、埋点、localStorage 或页面内容。
- 不得复制模板中旧的 `sso.ts`、`sso-api.ts`、`sso-config.ts`、`auth-token.ts` 或 `session.ts` 实现。
- Assets 应用不得安装、导入或启动本插件；Assets 身份由宿主能力提供。
- 修改认证基础设施、环境映射或插件配置前必须由平台团队确认。
