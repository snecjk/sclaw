# stabilize-chat-turn-lifecycle-and-parts

## Why

对话流 bug 反复出现根因是 lifecycle / 内容归类 / UI 三层各自判断。本 change 按 `docs/对话流全局稳定化修改方案-Cursor.md` 建立四层架构与测试矩阵。

## What

- TurnLifecycle 统一 `canShowMeta`
- TurnPart reducer + groups（live/history 同源）
- 工具 inputState / identity 合并
- 英文 planning narration 分类
- live 实时分段与 history 一致

## Scope

Phase 0–4 优先；UI 展开折叠（Phase 5）与旧 parser 清理（Phase 6）后续迭代。
