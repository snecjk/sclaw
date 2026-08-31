# 定时任务 `created_by` 历史登录名兼容

> 状态：**已编码**  
> 日期：2026-08-25  
> 关联：`electron/scheduled-tasks/`、`electron/utils/auth-store.ts`、`docs/定时任务云端同步与历史归属.md`

历史上 sai 曾把 `Code` 写成登录名，本地 `schedule_tasks.created_by` 会出现工号或登录名（同一个人）。现网找人 / 鉴权 / 调度 / 本地 sync **只比 `created_by === user.code`**。SSO 把 `Code` 修好成工号后，`created_by = cjw` 的行会从「我的任务」消失。

**选定方案：登录时刷本地 + 本次升级强制重登一次。** 已认证入口把「当前登录名」写成的任务 `created_by` 改成当前工号，并标 `pending`。CRUD / 调度 / 云端本地 list **不改判定**，继续只认工号。`schedule_task_runs` **不刷历史**；只保证本票之后新产生的 run 带上 `created_by` / `updated_by`。

发版不会改存量 sai。token 未过期则冷启动仍读旧 sai（`Code` 仍是登录名），刷库跳过，新建也仍写登录名。**本票不采用软提示、不赌 token 自然过期。** 升级后主进程一次性 `clearAuthUser()`，用户必须重新登录，sai 写成 `Code=工号` 后再刷库。接受离线 / SSO 不可达时被锁出、本地 cron 暂停，直到能登上。

**必须同一 PR / 同一发布：**

1. `auth-store.ts` 的 `buildSaiCliSsoAuthPayload` 把 `Code` 从 `user.userName` 改成 `user.code`（当前仍是未提交 diff）。
2. 登录时刷 `schedule_tasks` 历史登录名 → 工号。
3. 升级后一次性强制登出（§五.5）。

SSO 单独上线，cjw 行立刻消失。禁止先合 SSO、后合本刷库。没有强制重登，刷库对存量 sai 无效。

身份只从当前 `getAuthState()` 读。不要解析 JWT、不要读第二份 store。强制重登之后，运行时 sai 才是 `Code=工号`、`UserName=登录名`。若两者仍都是登录名（`code === userName`），刷库条件不成立，跳过。

---

## 一、问题

| SSO 字段 | 含义 | 例 |
|----------|------|----|
| `userInfo.Code` → `user.code` | 梧桐工号 | `2155991233` |
| `userInfo.UserName` → `user.userName` | 登录名 | `cjw` |

现网限制（保持不变）：

- **增**：`created_by` / `updated_by` = `user.code`。
- **查 / 改 / 删 / 启用 / 触发**：`trim(created_by) === code`；未登录拒绝；空 `created_by` 当孤儿可认领。
- **调度**：`setOwnerUserCode(code)` 后只 list 该工号。
- **认领**：只补 `created_by IS NULL`（或空白），不抢已有值。
- **云端**：隔离走 token 的 `owner_user_id`（工号），不看 `created_by`。本地 push / sync-status / pull 的过滤仍按 `created_by = code`。

因此 `created_by = cjw` 不是 NULL，认领不碰；`update` 也不改已有 `created_by`，脏值不会自己痊愈。调度 `refreshSchedule` 看不到这些行，`next_run_at` 也不再重算。

---

## 二、为什么刷本地，不在代码里认登录名

曾考虑过读路径别名：`isOwnedByCurrentUser` 额外认当前 `userName`，list / 调度 / push 各查两次，**不改历史列**。已否决，只作对照：

| | 读路径认登录名（否决） | 登录时刷成本人工号（采用） |
|--|------------------------|----------------------------|
| 改动 | service、scheduler、push/pull 全部打补丁；每 tick 可能两次 list | 认领旁一处 UPDATE；现网判定不动 |
| 脏数据 | `created_by` 永远可能是 cjw，别名代码要一直留着 | 本机这人的登录名行收敛成工号；随后 push 云端 payload 也变成工号 |
| 身份模型 | 与现网「单键 = 工号」长期分叉 | 刷完后与现网一致 |

刷本地更短，也让调度 / 同步不必分叉。

**安全假设（不另做防护）：**

- SSO 登录名在有效期内不跨人复用。若离任后分给别人，刷库会把 `created_by=老登录名` **永久**改成新人工号。
- 登录名不会等于库里他人的 `created_by`（典型为他人梧桐工号）。WHERE 只有 `trim(created_by)=userName`，没有第二列可圈用户。工号为纯数字、登录名为字母时碰撞可忽略。

切号不抢他人工号行：只改 `trim(created_by) === 当前 userName` 的行。

---

## 三、范围（已 grep）

SSO 修复是全局的 `user.code` 语义变化。**按当前 `user.code` 过滤、不刷就会从「我的任务」消失的，只有 `schedule_tasks`。** `schedule_task_runs` 列已有（migration `0011`）；现网按 `task_id` 查。强制重登后新 run 带工号，以后按人列 run 直接滤 `run.created_by`，不 JOIN tasks。历史 NULL / 登录名本票不刷。

| 存储 | 是否把历史 `user.code` 写进去 | 本票 |
|------|-------------------------------|------|
| `schedule_tasks.created_by` | 是，且 list / 鉴权 / 调度 / push 本地 list 都按当前 code 过滤 | **刷历史登录名 → 工号** |
| `schedule_task_runs.created_by` / `updated_by` | 列在；`claimRun` / 重试几乎不传 `actor`，历史多为 NULL | **不刷历史**；新 run 必须写入工号 |
| `catalog_sessions` / `workspaces` / `session_groups` / `session_engine_bindings` / `demo_records` 的 `created_by` | 审计戳，list 不按当前 code 过滤 | 不刷；会话/工作区不会因 code 变化从列表消失 |
| 定时任务附件目录 | 按 `taskId`，不按 code | 不刷 |
| `dws-send-dedup` | 进程内 Map，key 是收件人+正文，不落库、不按 code | 无关 |
| 工作流 `createdBy` | 云端字段，本地不做 `created_by === code` 过滤 | 不在本票 |
| `skills-store/users/{code}/`、SK 缓存键 | 目录/缓存在用 `user.code` | 换工号后走新目录，云端技能会重装；**本机未上云的用户技能会留在旧登录名目录**。已知、非本票。 |

除 `schedule_tasks` 刷库与 runs 新写入外，不必再扩表。若后续发现其它「持久化 code + 按当前 code 过滤」的路径，另开票。

---

## 四、刷哪些行

已认证入口（与现网 `claimScheduleTasksOwnership` 同一时机：SSO 登录成功或冷启动已登录），在认领 NULL **之后**、`startScheduler` **之前**执行。必须先刷完再 start，否则首轮 `discardMissedOnStartup` / `refreshSchedule` 仍按工号 list，看不到 cjw 行。

从 `getAuthState().user` 取：

```
code     = trim(user.code)
userName = trim(user.userName)
```

规则：

1. `code` 空 → 不刷（与认领一致）。
2. `userName` 空，或 `userName === code` → 不刷（没有历史登录名脏值，或 sai 仍未修好）。
3. 否则 UPDATE：`trim(created_by) = userName` 的行（含软删，push 墓碑也要能按工号出队）。
   - `created_by` = `code`
   - `updated_by` = `code`（与 `claimNullCreatedBy` 一致）
   - `updated_at` = 现在
   - `sync_status` = `pending`（保证出队；云端 `created_by` payload 随下次 push 收敛）
4. 不碰：`created_by` 已是工号的行、他人工号行、NULL/空白（仍只由认领补）。

`onUserAuthenticated(userCode)` 签名不变。`userName` 在 service 的 async 段里读 `getAuthState()`，调用方（`main/index.ts`、`api/routes/auth.ts`）不改。

---

## 四.1 `schedule_task_runs`：只修新写入，不刷历史

列从 `0011` 就有。`claimRun` / `scheduleRetry` 调 `createRun` 时不传 `actor`，新 run 的 `created_by` / `updated_by` 落成 NULL。本票只堵住这条；历史 NULL / 登录名行不动。

**语义：** 新 run 的 `created_by` / `updated_by` = **任务归属人工号**（与当时 `task.created_by` 对齐），不是「谁点了立即执行」另一套身份。cron / 手动 / 重试都写这个。状态流转不改 `created_by`，`updated_by` 继续写同一工号（取消 / 终态不要把 `updated_by` 写成 null）。

**新写入：**

- `claimRun`：`actor = this.ownerUserCode ?? task.createdBy`。强制重登后生产已认证二者都是工号；优先 owner 与调度过滤一致。不要改成只取 `task.createdBy`。
- `scheduleRetry`：`actor = task.createdBy`。
- repo `createRun` 保持 dumb：调用方传 `actor`，不在 repo 里读 auth。
- 生产路径必须传；旧测试可省略。
- **更新路径（必做，防跨用户 reap 误写）：** `listActiveRuns` 是全表，`reapStaleRuns` 会 finalize 他人挂起的 running（切号后仍要释放单飞）。现网 `finalizeRunIfRunning` 等是 `updated_by: actor ?? null`。若 finalize 传入当前会话工号，会把他人 run 的 `updated_by` 写成 reaper。正确做法：这些更新 **不传 actor**；repo 在 actor 省略时保留原 `updated_by`，空则回落 `created_by`（对齐 `updateRun`）。不要在 reap 路径传 `ownerUserCode`。

以后按人列运行记录：**`WHERE trim(run.created_by) = 当前工号`**，不要 `JOIN tasks`。强制重登 + 本票新写入保证新行带工号。历史 NULL / 登录名行本票不刷，按人列表看不到（可接受）；按 `task_id` 的 `getLatestRun` 现网路径不变。

---

## 五、挂载点

### 1. `schedule-task-repository.ts`

新增与 `claimNullCreatedBy` 并列的方法，例如 `rewriteLoginNameCreatedBy(userCode, userName): Promise<number>`。  
`userName` 空或与 `userCode` 相同则 0。WHERE 用 `trim(created_by) = userName`（与现网 list 的 trim 比较对齐）。不按 `deleted_at` 过滤。

### 2. `schedule-tasks-ownership.ts`

`claimScheduleTasksOwnership` 仍只补 NULL。同文件增加 `rewriteScheduleTasksLoginNameOwner(userCode, userName, taskRepo)`，**只刷 `schedule_tasks`**。ownership 模块**不** import `auth-store`。Marker 不必为刷库单开；刷了几行打日志即可。

### 3. `scheduled-task-service.ts` / scheduler / executor

`onUserAuthenticated` 顺序固定：

1. `claimScheduleTasksOwnership(code)`
2. `getAuthState()` 取 `userName` → `rewriteScheduleTasksLoginNameOwner(code, userName)`
3. `startScheduler(code)`

第 2 步失败只 warn，不挡 start。`getAuthState` 失败则跳过刷库。**取到 `user` 后先校验 `trim(user.code) === 入口 code`，不一致直接跳过**：入口与读取之间可能已切号（A→B），不校验会把 `created_by=B 登录名` 的行刷成 A 的工号。

`pullFromCloud` 在现有 upsert **之后**再跑同一遍任务 rewrite（见 §六），然后 `refreshSchedule`。

`claimRun` / `scheduleRetry` 按 §四.1 传入 `actor`。状态更新不传会话工号，靠 repo「省略则保留」。

### 4. 不改

- `isTaskOwnedBy` / `listTasks` / `getTask` / 改删启用触发 / scheduler / push / pull 的过滤：继续只认工号。
- 路由 `resolveActor()`：只返回工号、只用于写入。
- 新建：仍只写工号。
- 云端 `owner_user_id`、`empCode`、`cancelQueuedRunsForTaskIds`。
- 不给 `updated_by = cjw` 但 `created_by` 已是工号的行单独刷 `updated_by`（归属只看 `created_by`）。
- 不刷 `schedule_task_runs` 历史行，也不给 run-repo 加回填方法。
- 不刷 §三 里除 `schedule_tasks` 以外的其它 store。
- 不把运行记录纳入云端 sync。

### 5. 升级后强制重登一次（主进程钩子）

补一层与更新器无关的一次性钩子。打包应用内更新重启已会走 `runPendingInstallReport` → `clearAuthUser()`；漏网是手动覆盖安装、dev、没有 pending-install 文件。本钩子补这些路径，**所有渠道升级后都强制重登一次**。

挂在 `app.whenReady` 里、`initialize()` / 定时任务冷启动 `getAuthState`（约 `main/index.ts:719`）**之前**。`519–718` 行不得先读 auth；钩子晚于此处则调度会按旧登录名先 start 一轮。

1. electron-store 加布尔键，例如 `ssoCodeFieldReloginDone`。已为 true → 直接返回。**以后别的 SSO 修复必须换新键名，勿复用本键。**
2. 否则：若当前仍登录（sai 有 token）→ `clearAuthUser()`（现网：store 置位 + 删 sai + best-effort teardown，不直接通知 renderer）。
3. 无论刚才是否登录，把该键设为 true（全新装也打标，不踢；sai 单会话，无他人残留）。**判定 / 清理抛异常则不打标**，异常上抛由 `main/index.ts` catch warn，下次启动重试——`clearAuthUser` 幂等，重试无害；若在 finally 里打标，sai 读取失败一次就永久跳过强制重登。
4. Renderer 走 `/api/auth/status` 进登录页。登入 → `setAuthUser` 写 sai `Code=工号` → `onUserAuthenticated` 刷库。

不要绑 `app.getVersion()`。不要解析 JWT。开发包也跑。与 `runPendingInstallReport` 互补：谁先谁后都只清一次会话，键已 true 则本钩子不再清。

**不采用：** 仅发版说明、仅提示条、等 token 过期自然重登、启动后软触发。那些都不能保证本机立刻拿到新 sai。

---

## 六、多设备、本机 pull、过渡

本机刷完即可列表 / 调度 / 改删。`pending` 后由现有 tick push 把 `created_by=工号` 推上云（token 隔离不变）。另一台仍是 cjw 时：该机登录会自己刷，或用户手动 pull 用云端定义覆盖。验收时首轮补推不当缺陷。

**本机刷完、首次 push 成功前就手动 pull：** 现网 pull 用云端定义整行覆盖并标 `done`。云端此时 `created_by` 往往仍是 cjw → 本地改回 cjw 且不再进 push → 按工号 list 再次看不见。下次登录会再刷（自愈），但中间会丢一次。因此 **`pullFromCloud` 覆盖完成后立刻再跑 rewrite**，不把自愈拖到下次登录。云端已是工号时 rewrite 命中 0 行，无害。

---

## 七、测试

`tests/db/schedule-tasks-cloud-sync.test.ts` 或归属段：

- `code=2155991233`、`userName=cjw`：预先插入 `created_by=cjw`（含一条软删）；认证入口后这些行变为工号且 `pending`；`listTasks` / 调度能看到；他人 `created_by` 不动。
- 已是工号的行、NULL 行（仍走认领）、`userName === code`、空 `userName`：不误刷。
- 刷库发生在 `startScheduler` 之前：认证后 `refreshSchedule` 能给原 cjw 行写出 `next_run_at`。
- **刷完未推即 pull：** 云端行仍是 `created_by=cjw`；pull 后再跑 rewrite，本地仍是工号且 `pending`，列表仍可见。
- 现有认领 / 切号不抢工号的用例仍通过。
- **runs：** `claimRun` / 重试新写入 `created_by` 与 `updated_by` 为工号（有 owner 时）；状态更新不改 `created_by`、且 `updated_by` 不为 null。不测历史 run 回填。按人过滤只测 `run.created_by`，不测 JOIN tasks。
- **强制重登：** 键未打标且已登录 → 调 `clearAuthUser` 并打标；键已 true → 不调；未登录 → 只打标不踢。

---

## 八、验收

- SSO 修复、刷库、一次性强制登出同一发布。升级后（含手动安装）必须重新登录一次；sai 的 `Code` 为工号后，「我的任务」才完整。不接受「升级后带着旧 sai 继续用」。
- 本机原先 `created_by` 为当前登录名的未删除任务出现在「我的任务」，可改删触发，到期调度。
- 库内这些行的 `created_by` 已是工号，不是 cjw。
- 他人任务不出现、不被改写。
- 刷完立刻 pull（云端仍是 cjw）后，列表仍可见（rewrite 已再跑）。
- 首轮 push 可能补推这批 pending，属预期。
- 本票之后新产生的 run 带 `created_by` / `updated_by` 工号，按人列表可直接滤该列；历史 run 允许仍为 NULL（按人看不到，按 `task_id` 仍能取到）。

---

## 九、残余（不挡做，实现时要避开）

**1. 强制重登的离线代价（已接受）。** 见 §五.5。升级后 SSO 不可达则进不了应用，本地定时任务也停，直到能登上。不要因此改回软触发。

**2. run 的 `updated_by`：省略 actor 时必须保留，不能写 null。** 原因见 §四.1（全表 reap）。实现统一为「省略则 `coalesce(updated_by, created_by)`」：`markRunningIfQueued` / `finalizeRunIfRunning` / `cancelIfActive` / `cancelActiveRunsForTask` 现网 `?? null`，必须改；`updateRun` 原先虽是 `actor ?? existing.createdBy`，也一并对齐——旧写法在 `updated_by` 非空且不同于 `created_by` 时会把 `updated_by` 重置成 `created_by`，保留语义更准。reap **不要**传当前 `ownerUserCode`。

**3. 已声明、不再加防护：** 登录名跨人复用；登录名碰巧等于他人工号；skills-store 旧目录。刷库会 bump `updated_at` 并 pending，首轮多推几条是预期。历史 run 的 `created_by` 仍可能 NULL，按人列 run 看不到它们，不要为此加 JOIN 或回填。

