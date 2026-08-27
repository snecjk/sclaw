# STO Policy 与 Site SSO 旧合并实施计划（已废止）

**状态：** 已拆分，禁止执行。

旧计划同时实施 Site SSO、Policy Client、Assets Host Bridge、本地代理和模板迁移，且依赖一个职责过宽的通用 Runtime 包。该执行路径已被废止。

请改用以下文档：

- Site SSO 设计：[`../specs/2026-08-27-sso-auth-plugin-design.md`](../specs/2026-08-27-sso-auth-plugin-design.md)
- Site SSO 实施计划：[`2026-08-27-sso-auth-plugin.md`](./2026-08-27-sso-auth-plugin.md)
- 前端应用插件系统：[`../specs/2026-08-27-frontend-app-plugin-system-design.md`](../specs/2026-08-27-frontend-app-plugin-system-design.md)

正式 Site SSO npm 包名为 `@sto/sclaw-plugin-sso-auth`。Policy Ontology 与 Assets Host Bridge 需要使用各自的独立计划。
