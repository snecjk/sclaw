---
name: nl-page-from-sai
description: >-
  自然语言建页若需要业务接口，先引导用户指定 sai-cli 指令；指定后 help，
  并用 ensure-dev-proxy 注册域名。页面/action 只写 /proxy/<key>/...；
  开发走 Vite proxy，生产由 request.ts 按合约还原为真实域名（禁止把 /proxy 当生产路径）。
version: 0.1.3
---

# 自然语言建页 → 引导指定 CLI 接口

## 何时启用

用户用自然语言新建/改造页面，且该页**需要调用业务接口**（搜索、列表、分页、看板取数等），但用户**还没说出**要用哪条 sai-cli 指令或接口。

## 正确做法

1. **先引导用户指定 CLI**，不要先猜接口去改 `action-registry`
   示例：
   「这个页面需要接业务数据。请指定要用的 sai-cli 指令（例如：一口价运费查询 / `product module action`）。你指定后，我再按该指令的参数和返回字段生成搜索、列表和分页。」

2. **用户说不清命令名时**（可选辅助）
   - 可执行 `sai-cli discover "<业务词>"`
   - 把候选列给用户，**请用户指定一条**（回复序号或 path）
   - 仍以用户指定为准，Agent 不得擅自拍板绑真接口

3. **用户已指定后**
   - `sai-cli help <product> <module> <action>`
   - 从 help 得到真实 HTTP 地址（若有）后，**必须**先注册开发代理，再写相对 path：
     ```bash
     node scripts/ensure-dev-proxy.mjs "https://example-api.sto.cn/api/xxx"
     ```
     命令输出 `relativeUrl`（如 `/proxy/example-api-sto-cn/api/xxx`）写入 `contracts/action-registry.v1.json` 的 `url` 或页面请求 path
   - **禁止**把 `https://...` 绝对地址写进页面或 action（本地预览会 CORS）
   - **禁止**假设生产静态站点存在 `/proxy/...` 路由：生产构建里 `src/lib/request.ts` 会按 `contracts/dev-proxy.v1.json` 把 `/proxy/<key>/...` **自动还原**成 `target + path`
   - 用 help 的参数说明、示例、`outputFields` 生成 `docs/api`、页面（及菜单，若用户提了）
   - 新增了 proxy 域名后提示用户**刷新/重启预览**（Vite 需加载新 proxy）

4. **用户只要壳、明确先不接真接口**
   - 可用 mock 出页，并说明：之后指定 CLI 再接入

## 环境约定（强制）

| 环境 | `/proxy/<key>/...` 行为 |
|------|-------------------------|
| 本地 / Claw 预览 (`import.meta.env.DEV`) | 原样请求，由 Vite `server.proxy` 转发 |
| 生产构建 / 发布平台 | `request.ts` 查 `dev-proxy.v1.json`，改写为 `https://<target>/...`，**不得**请求发布域名下的 `/proxy/...` |

## 预览 CORS / 直连报错时

若控制台出现 `blocked by CORS` 或直连 `*.sto.cn` 失败：

1. 从报错里取出绝对 URL
2. 运行 `node scripts/ensure-dev-proxy.mjs "<绝对URL>"`
3. 把 action-registry / 页面里对应 url 改成输出的 `relativeUrl`（`/proxy/...`）
4. 重启预览后再试

若**生产环境** Network 里仍出现 `https://page-*.sto.cn/proxy/...` 404：说明未走 `request.ts` 的解析，或 `dev-proxy.v1.json` 缺对应 key——修好请求封装与合约，不要在生产网关再挂一套 `/proxy`。

## 禁止

- 未获用户指定（或明确「先 mock」）就编造 URL / CLI / 字段并绑定真实取数
- 页面或 action 使用绝对业务域名（开发必须走 `/proxy/<key>/...`）
- 把 `/proxy` 当成生产可用路径，或为生产静态站单独配置 `/proxy` 路由来「兼容」泄漏
- 用 discover 结果静默选型而不让用户指定

## 与其它技能

- 字段与契约 → `api-contract`
- 页面验收 → `ui-checklist`
