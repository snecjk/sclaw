## 1. 内置 Tool 实现

- [ ] 1.1 创建 `sto-plugin/sto-scheduled-task-tool/` 插件目录
- [ ] 1.2 定义 `create_scheduled_task` 工具（inputSchema、execute 函数）
- [ ] 1.3 创建 `openclaw.plugin.json` 配置文件
- [ ] 1.4 实现参数验证逻辑（name、cronExpr 必填）
- [ ] 1.5 返回标准化的确认格式（JSON content 携带 extractedParams）

## 2. 参数确认 Modal 组件

- [ ] 2.1 创建 `src/pages/ScheduledTasks/components/TaskNlCreationModal.tsx` 组件
- [ ] 2.2 实现参数展示区域（只读显示提取的参数）
- [ ] 2.3 实现参数编辑功能（用户可修改任何字段）
- [ ] 2.4 实现缺失参数提示逻辑（高亮缺失的必填字段）
- [ ] 2.5 实现表单验证和错误提示
- [ ] 2.6 遵循 docs/sto-design.md 设计规范（使用 Brand-6 主色、Green-10 成功色）

## 3. Tool 调用监听 Hook

- [ ] 3.1 创建 `src/hooks/use-scheduled-task-tool-listener.ts`
- [ ] 3.2 订阅 `streamingTools` 状态变化
- [ ] 3.3 识别 `create_scheduled_task` 工具调用完成事件
- [ ] 3.4 解析 tool result content 提取参数
- [ ] 3.5 触发确认弹窗

## 4. 云端 API 调用逻辑

- [ ] 4.1 在 `src/stores/scheduledTasks.ts` 中复用 `createTask` 方法
- [ ] 4.2 处理 API 错误响应（409 冲突、401 未授权、网络错误）
- [ ] 4.3 添加创建成功后的 Toast 提示（使用 Green-10 成功状态色）

## 5. 跳转引导逻辑

- [ ] 5.1 实现创建成功后自动跳转到定时任务列表页
- [ ] 5.2 使用 React Router 导航到 `/scheduled-tasks`
- [ ] 5.3 关闭确认弹窗

## 6. Home 页面集成

- [ ] 6.1 在 Home 页面集成 `useScheduledTaskToolListener` hook
- [ ] 6.2 渲染 `TaskNlCreationModal` 组件
- [ ] 6.3 传递 `handleConfirmCreation` 回调

## 7. 插件注册与加载

- [ ] 7.1 在 OpenClaw 配置中注册 `sto-scheduled-task-tool` 插件
- [ ] 7.2 确保插件在应用启动时加载
- [ ] 7.3 验证工具在 AI 模型调用时可用

## 8. 文档更新

- [ ] 8.1 更新 `README.md` 添加自然语言创建定时任务的使用说明
- [ ] 8.2 更新 `README.zh-CN.md` 中文文档
- [ ] 8.3 必要时更新 `README.ja-JP.md` 日文文档
