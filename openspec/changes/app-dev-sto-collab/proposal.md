## Why

换设备或删除本地目录后，用户仍拥有云端 STO 应用，但 SClaw 目前只以本地 workspace 列表为准，无法发现「需拉取」的应用，也无法用 `sto-app clone` 按用户选定目录恢复。协作必须以 `sto-app` CLI 为操作面。

## What Changes

- 应用清单以 `sto-app apps list` 为权威来源；本机仅保存 `applicationId → localPath/workspaceId` 绑定索引
- 本地路径存在且有效 → 可编辑；缺失 → 用户每次选择目录后 `clone`
- 补齐 list / clone 包装；创建后写入绑定；提交前 pull；冲突经 AI 处理后 `merge continue`
- 查询 `status` 展示链接与同步态
- Dark mode：开发应用卡片「需拉取 / 可编辑」状态标签使用语义 token

## Capabilities

### New Capabilities
- `app-dev-sto-collab`: STO 应用云端清单、本机绑定、clone 选目录、push/pull/merge、status 展示

### Modified Capabilities
- （无正式主线 specs 目录下的既有 capability；本 change 新增）

## Impact

- `electron/services/sto-app-service.ts`：list / clone
- `electron/services/sto-app-binding-store.ts`：本机绑定索引
- `electron/services/app-dev-service.ts`：list/create/clone/delete 与绑定联动
- `electron/api/routes/app-dev.ts` + `src/lib/app-dev-api.ts`
- `src/components/more-apps/DevAppCard.tsx`：可编辑 vs 拉取到本地
- `src/pages/AppDev/AppDevWorkbench.tsx`：拉取 / 合并继续入口
- Dark mode：状态色用 semantic tokens，禁止仅 light 硬编码
