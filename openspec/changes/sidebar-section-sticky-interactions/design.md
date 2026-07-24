## Context

当前侧栏：项目用 `expandedProjectIds: Record<string, boolean>`（可多开）；任务用 `expandedTaskGroupKey: string | null`（单开）；仅任务/最近吸顶且任务在 `top-0`；`use-sidebar-task-scroll-collapse` 只收起任务；展开态账号文字不是菜单 trigger，齿轮才是。已确认产品方案见 `docs/侧边栏项目任务吸顶与交互-Cursor开发文档.md`；视觉细节以 MasterGo MCP（file `195806630222772`，layer `39:14883`）为准。

## Goals / Non-Goals

**Goals:**
- 底部账号热区、共享分区标题、三级 sticky、任务多开、批量展开全部/收起全部、项目空态与层级视觉。
- 模块 `open` 与一级组展开 map 分离；批量操作由「是否全部展开」决定，不维护历史快照。
- light / dark 下标题与账号热区的 default / hover / focus / open 可读。

**Non-Goals:**
- 不改新建项目弹窗、行内重命名为弹窗、会话草稿创建时机、选中字重、置顶/未读数据源、项目排序。
- 不新增持久化、全局 store、IPC、接口或工程配置变更。
- 不整文件重构 `Sidebar.tsx`。

## Decisions

1. **账号菜单 trigger 包住整块账号信息，齿轮仅从展开态移除。**  
   Rationale：对齐 MasterGo「底部热区调整」帧（section 173）：无齿轮，账号区 hover 灰底 `rgba(0,0,0,0.1)` / `rounded-[4px]`，问号 24×24 独立且 gap 12px。  
   Alternative：保留齿轮并扩大点击区 — 与已确认稿冲突，否决。

2. **提取 layout 私有 `SidebarCollapsibleSectionLabel`，右侧 actions 走 slot。**  
   Rationale：项目/任务/最近需同一热区与 sticky 壳，actions 不能嵌套在主 toggle 内。  
   Alternative：三处复制粘贴标题 JSX — 易漂移，否决。

3. **任务组展开改为 `Record<string, boolean>`，与项目同构。**  
   Rationale：多开与自动聚焦「只追加不替换」最直观；复用现有项目模式。  
   Alternative：`Set<string>` — 序列化与不可变更新略繁，且与项目不一致。

4. **批量按钮按「是否全部展开」在 expand-all / collapse-all 间切换，不保存恢复快照。**  
   Rationale：产品已确认：全部已展开 → 收起全部；只要存在未展开项（含部分展开）→ 展开全部。  
   Alternative：收起前 snapshot + 恢复 — 与确认方案冲突，否决。

5. **三级 sticky top 由 `--sto-sidebar-section-sticky-h` 计算（0 / 1× / 2×），实底 `--sto-sidebar-bg`。**  
   Rationale：避免散落 30/60px；与现有 token 一致（`docs/sto-design.md` / sidebar surfaces）。  
   Alternative：各组件硬编码 top — 易错层，否决。

6. **滚动 Hook 泛化为双向阈值（项目→任务、任务→最近），RAF + passive，手动展开带 suppress。**  
   Rationale：旧 Hook 职责不足；连续 if 修补会触发 Stop Rules。  
   Alternative：IntersectionObserver 多 sentinel — 可行，但现有实现已用 getBoundingClientRect，扩展成本更低。

## Risks / Trade-offs

- [三级 sticky 穿透或错层] → 统一高度 token + 实底 + 明确 z-index，矮窗与长列表验收。
- [自动收起导致跳动] → 分区锚点滚动；独立 suppress；禁止无条件 `scrollTop = 0`。
- [任务多开破坏运行中自动定位] → 聚焦只向集合追加；增加回归测试。
- [模块 open 与组 map 互相清空] → toggle module 不得重置组展开 map。
- [账号菜单与二维码同开] → 保留现有互斥 `onOpenChange`。
- [Hover 操作误切换项目] → actions 独立于主 button，核对冒泡。
