# STO Policy 与 Site SSO 旧合并设计（已废止）

**状态：** 已拆分，禁止作为当前实现依据。

该文档原先将 Site SSO、Policy HTTP、Assets Host Bridge 和通用插件宿主放在同一个 npm 包设计中，职责过宽，容易造成误解。现已按能力边界拆分：

- Site SSO：[`2026-08-27-sso-auth-plugin-design.md`](./2026-08-27-sso-auth-plugin-design.md)
- 前端应用插件系统：[`2026-08-27-frontend-app-plugin-system-design.md`](./2026-08-27-frontend-app-plugin-system-design.md)
- SSO Auth 实施计划：[`../plans/2026-08-27-sso-auth-plugin.md`](../plans/2026-08-27-sso-auth-plugin.md)

正式 Site SSO npm 包名为 `@sto/sclaw-plugin-sso-auth`。Policy Ontology 与 Assets Host Bridge 需要分别设计和实施，不能继续沿用旧合并方案。
