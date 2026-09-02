## Context

`sto-app` CLI 已提供 create / list / clone / status / pull / push / merge continue。SClaw 已有部分包装，但应用广场列表仍只扫本地 workspace。

## Goals / Non-Goals

**Goals**
- 云端 list 为「我的应用」权威
- 本机绑定索引支撑换设备 / 删目录恢复
- clone **每次**由用户选择并确认目标父目录
- 冲突：AI 改文件后 CLI `merge continue`

**Non-Goals**
- 不在 SClaw 内直接操作 Git / GitLab Token
- 不自动选择默认 clone 路径跳过确认
- 不实现云端删除应用（若 CLI 无 delete）

## Decisions

1. **Source of truth = `apps list`**  
   Rationale: 换机不丢应用。  
   Alternative: 本地为准 — 否决（删目录即丢清单）。

2. **Binding index in userData JSON**  
   `applicationId → { localPath, workspaceId, name, updatedAt }`  
   Alternative: 只写 `.sclaw/app-dev.json` — 删目录后无法反查。

3. **Clone UX: 每次选父目录**  
   目标路径 = `join(parentDir, sanitize(appName))`；非空则失败并提示换目录。  
   Alternative: 固定 `~/SClawApps` — 用户明确要求每次选择。

4. **Remote-only 项无 workspaceId**  
   不可进工作台；主按钮为「拉取到本地」。

5. **Push 前先 pull**  
   在 push 包装内或 UI 提交流程中执行；冲突返回 merge-required + revisionId。

## Risks

- [Risk] list JSON 字段不稳定 → Mitigation: 宽松解析多种 id/name 字段  
- [Risk] clone 与本地同名冲突 → Mitigation: 目标非空即失败  
- [Risk] CLI 不可用 → Mitigation: 列表失败可见提示，不静默回退成「仅本地权威」

## Migration

首次打开：用 list + 现有本地 marker workspace 尝试按路径/名称匹配写入绑定；匹配不上的本地项可暂保留为「本地未绑定」弱项（不盖过云端列表）。
