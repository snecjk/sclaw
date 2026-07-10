# SQLite 本地数据库方案

## 目标

为 StoClaw 新增一套独立于现有 `electron-store` / JSON / JSONL 的本地 SQLite 能力，专门承接新的结构化数据需求。

本方案默认规则：

- SQLite 仅运行在 Main Process
- `node:sqlite` 负责底层数据库连接
- `Kysely` 负责类型安全的 query builder
- Renderer 不直接访问数据库
- Renderer 继续通过 `src/lib/host-api.ts` / `src/lib/api-client.ts` 走 IPC
- Repository 负责 SQL 与事务
- 业务编排继续放在 `electron/services/*`，不在 `electron/db` 内再套一层 service

## 建议目录

```text
electron/
  db/
    connection.ts
    kysely-sqlite.ts
    models/
      tables/
        demo-record-table.ts
      domain/
        demo-record.ts
      dto/
        demo-record.dto.ts
    pragmas.ts
    migrator.ts
    migrations/
      0001-initial-schema.ts
    repositories/
      demo-record-repository.ts
    types.ts
```

## 数据库存放位置

数据库文件位于：

```text
app.getPath('userData')/sqlite/stoclaw.sqlite
```

这样不会污染源码目录，也和现有 Electron 用户数据保持一致。

## 通用规范

### 1. 主键规范

- 默认使用 `TEXT PRIMARY KEY`
- 新业务优先使用 UUID 字符串

### 2. 时间字段

所有业务表统一保留：

```sql
created_at TEXT NOT NULL,
updated_at TEXT NOT NULL,
deleted_at TEXT
```

说明：

- 使用 UTC ISO8601 字符串，便于与当前代码风格保持一致
- `deleted_at` 用于软删除

### 3. 版本与来源字段

建议所有可演进业务表统一保留：

```sql
version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
created_by TEXT,
updated_by TEXT
```

### 4. JSON 扩展字段

当表中有可变结构数据时，使用：

```sql
some_json TEXT CHECK (some_json IS NULL OR json_valid(some_json))
```

### 5. 布尔与枚举

- 布尔值统一为 `INTEGER NOT NULL CHECK (col IN (0, 1))`
- 枚举统一为 `TEXT NOT NULL CHECK (...)`

### 6. 外键与性能

启动时统一执行：

- `PRAGMA journal_mode = WAL`
- `PRAGMA foreign_keys = OFF`
- `PRAGMA busy_timeout = 5000`
- `PRAGMA synchronous = NORMAL`

## 首版 schema

当前首版 migration 只保留最小集合：

- `schema_migrations`
- `app_demo_records`

其中 `app_demo_records` 仅作为演示表，方便后续按你的真实业务继续扩展 migration。

## 标准 CRUD 示例

模型组织：

- 表字段定义（Kysely table types）放在 `electron/db/models/tables/*`
- 业务对象放在 `electron/db/models/domain/*`
- CRUD 输入输出 interface 放在 `electron/db/models/dto/*`
- `repository` 只负责查询与数据映射
- `electron/services/*` 直接组合 `repository`

Repository 示例：

```ts
import { getDemoRecordRepository } from '@electron/db';

const repository = getDemoRecordRepository();

const created = await repository.create({
  name: 'demo row',
  description: 'first sqlite record',
  status: 'active',
  payload: { module: 'demo', tags: ['sqlite', 'crud'] },
  actor: 'system',
});

const found = await repository.getById(created.id);

const rows = await repository.list({
  status: 'active',
  limit: 20,
  offset: 0,
});

const updated = await repository.update(created.id, {
  name: 'demo row updated',
  payload: { module: 'demo', tags: ['sqlite', 'update'] },
  actor: 'system',
});

await repository.softDelete(created.id, 'system');
await repository.hardDelete(created.id);
```

业务层使用示例：

```ts
import { getDemoRecordRepository } from '@electron/db';

const repository = getDemoRecordRepository();

const record = await repository.create({
  name: 'service demo',
  payload: { scene: 'main-process' },
});

const list = await repository.list({ status: 'active' });

await repository.update(record.id, {
  description: 'updated inside electron/services/*',
});

await repository.softDelete(record.id, 'service-user');
```

## 适用边界

适合迁入 SQLite 的新需求：

- 结构化业务实体
- 需要唯一约束的数据
- 需要条件查询、排序、分页的数据
- 需要外键和完整性约束的数据

不建议直接塞进 SQLite 的内容：

- API Key / Secret 明文
- 单纯 UI 开关类轻量设置
- 原始大体积对话 transcript 文件本体

这三类仍应分别走安全存储、`electron-store`、文件系统。
