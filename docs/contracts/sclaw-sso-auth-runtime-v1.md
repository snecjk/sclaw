# SClaw SSO Auth Runtime v1 部署契约

## 适用范围

该契约仅用于 `pageType: "site"` 的独立站点。Assets 托管应用不注入、不安装也不启动 `@sto/sclaw-plugin-sso-auth`。

## 发布配置

部署平台必须在 Site 业务脚本执行前注入：

```html
<script>
window.__STO_SSO_AUTH_CONFIG__ = {
  protocolVersion: 'sto-sso-auth/v1',
  applicationId: 'resolved-by-code-deploy',
  pageType: 'site',
  runtimeMode: 'published',
  deployEnv: 'daily',
  sso: {
    environment: 'daily',
    systemCode: 'STO_CLAW_APP',
    loginOrigin: 'https://baseinfo-usercenterserviceapi-hq-test.sto.cn',
    apiOrigin: 'https://baseinfo-usercenterapi-test.sto.cn'
  }
};
</script>
```

环境映射固定如下：

| 发布环境 | SSO 环境 | Login Origin | API Origin |
|---|---|---|---|
| `daily` | `daily` | `https://baseinfo-usercenterserviceapi-hq-test.sto.cn` | `https://baseinfo-usercenterapi-test.sto.cn` |
| `stage` | `pre` | `https://pre-baseinfo-usercenterservice-api-hq.sto.cn` | `https://pre-baseinfo-usercenterapi.sto.cn` |
| `online` | `prod` | `https://baseinfo-usercenterserviceapi.sto.cn` | `https://baseinfo-usercenterapi.sto.cn` |

## 安全要求

- 配置只能包含公开信息，禁止包含 Token、Cookie、回跳 Code、npm 凭证或本地 Session Secret。
- Origin、Callback Path、Method、System Code 和认证 Header 不允许由浏览器 Query 或业务页面覆盖。
- 发布配置是环境的唯一权威来源；Hostname 和 `VITE_SSO_ENV` 只能作为旧应用兼容策略，不能覆盖有效配置。
- 配置缺失、字段未知、环境不匹配或 Origin 非 HTTPS 时，Site 必须在挂载业务页面前失败。
- code-deploy 仓库的实际注入改造应使用独立实施计划完成。
