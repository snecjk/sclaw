---
name: backend-dev
description: 本地全栈后端开发规程（Hono + Drizzle + SQLite）
---

# backend-dev

面向业务用户的本地全栈应用：出问题应由工作台自动修复，不要让用户看终端。

## 1. 全栈心智模型

```
src/pages/*.tsx     ← 业务页（登录/CRUD，走 /proxy/appBackend）
server/routes/      ← 可改：API
server/runtime/     ← 禁改：平台壳
drizzle/schema.ts   ← 可改：表结构（改完必 migrate）
.data/app.db        ← 本地数据，永不提交/不同步
```

- 前端访问本应用后端：**只写** `/proxy/appBackend/...`（runtime 会写 `contracts/dev-proxy.v1.json` 的 `appBackend`）
- 禁止写死 `http://127.0.0.1:<port>`
- 密钥：工作台 Secrets 注入 env；代码里读 `process.env.KEY`，禁止写进源码

## 2. 数据库纪律

1. 改 `drizzle/schema.ts`
2. `npm run db:migrate`（或工作台 Migrate）
3. `GET /api/health` 或 `/proxy/appBackend/api/health` 应 `{"ok":true}`
4. 禁止手改 `.data/app.db`；禁止方言专用 SQL（为以后 SQLite→PG 留余地）

初始表：`users` / `sessions` / `todos`。业务表在 schema 上追加即可。

## 3. 五件套用法（本模板已落地子集）

### auth
- `POST /api/auth/register|login|logout`，`GET /api/auth/me`
- Cookie session；未登录业务接口返回 401
- 路由：`server/routes/auth.ts`；会话：`server/auth/session.ts`

### db
- Drizzle + better-sqlite3，路径 `.data/app.db`（或 `DATABASE_URL`）
- 示例 CRUD：`server/routes/todos.ts`

### secrets
- 声明：`contracts/secrets.v1.json`（仅 key）
- 取值：`process.env.SESSION_SECRET` 等（工作台注入）

### files / realtime
- 本迭代模板未内置完整路由；需要时在 `server/routes/` 新增，勿改 `server/runtime/`

## 4. 联调自检（改完必跑）

```bash
npm run db:migrate
npm run smoke          # health + 注册登录 + todos CRUD
```

失败时：把 smoke 输出原样留给工作台自动修复（业务用户不会手动粘贴）。新增 API 时扩展 `server/scripts/smoke.ts`。

## 5. 拒识边界

- 不改 `server/runtime/`
- 不装白名单外依赖（走工作台 packages 审计）
- 不直连 `https://*.sto.cn`（走 ensure-dev-proxy）
- 不把密钥、`.data/`、`.env` 提交进 git
