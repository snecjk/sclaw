# PC 企业应用模板

本模板 = **公司发布平台 Vite 工程底座** + **STO PC 应用壳层** + **请求封装**。

## 默认布局

1. **应用顶栏**：STO Logo、应用名和当前用户
2. **打开页签**：固定首页，其他页面支持打开和关闭
3. **静态侧栏**：由 `src/layouts/nav-config.ts` 声明 Assets 页面
4. **正文区域**：统一的页面标题、内容卡片和空状态组件

## 请求封装

```ts
import { http, request } from '@/lib/request';

// 约定：业务 path 写成 /proxy/<key>/...
// - 开发：Vite server.proxy 转发
// - 生产：request.ts 按 contracts/dev-proxy.v1.json 还原为真实域名
await http.get('/proxy/some-key/api/xxx');
await http.post('/proxy/some-key/api/xxx', { id: 1 });

// URL 若带 ?stoToken=...，启动时写入 sessionStorage，
// 后续请求自动附加 Header：stoToken / stotoken
```

开发环境**禁止**浏览器直连 `https://*.sto.cn`（会 CORS）。新接口域名先注册代理：

```bash
node scripts/ensure-dev-proxy.mjs "https://baseinfo-chatbotapi-test.sto.cn/api/robot/page"
# → 写入 contracts/dev-proxy.v1.json
# → relativeUrl: /proxy/baseinfo-chatbotapi-test-sto-cn/api/robot/page（写入页面/action）
# → absoluteUrl: https://baseinfo-chatbotapi-test.sto.cn/api/robot/page（生产由 request 自动还原）
```

`vite.config.ts` 只在 **dev server** 读取该契约生成 `server.proxy`。
生产构建**没有** `/proxy` 路由；`src/lib/request.ts` + `src/lib/resolve-api-url.ts` 负责改写。

## 目录

| 路径 | 说明 |
|---|---|
| `src/theme/` | STO 主题 Token、antd 主题与 CSS 变量 |
| `src/layouts/` | 顶栏、页签、静态侧栏与页面容器 |
| `src/components/` | 页面标题、内容卡片和空状态等页面原语 |
| `src/pages/` | 首页、组件示例、占位业务页 |
| `src/lib/request.ts` | fetch 封装（cookie + stoToken + 生产 proxy 还原） |
| `src/lib/resolve-api-url.ts` | `/proxy/<key>` ↔ 真实域名 |
| `src/lib/auth-token.ts` | URL / session stoToken |
| `contracts/dev-proxy.v1.json` | 代理合约：key → target（dev + prod 共用） |
| `scripts/ensure-dev-proxy.mjs` | 引入新绝对 URL 时自动登记 proxy |
| `src/catalog/` `src/runtime/` `src/pages/*.page.json` | 保留的 A2UI 能力（可选扩展） |
| `vite.config.ts` | 公司发布平台构建约定（产物 `build/`）+ dev proxy |

## 本地运行

```bash
npm install
npm run dev
```

## 构建

```bash
npm run build        # vite build
npm run typecheck    # 可选：tsc -b
```

产物输出到 `build/`。
