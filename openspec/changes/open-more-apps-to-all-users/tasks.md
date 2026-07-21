## 1. 导航入口放开

- [x] 1.1 移除 `Sidebar.tsx` 中 `/more-apps` 对网点账号及网点类别配置加载状态的过滤（Requirement: 应用广场入口对所有已登录账号可见）
- [x] 1.2 确认 `/data-center` 等其他网点专属入口的原有过滤保持不变（Requirement: 应用广场现有访问行为保持不变）

## 2. 回归验证

- [x] 2.1 增加或调整单元测试，覆盖应用广场属于主导航且不依赖网点身份的行为（Requirement: 应用广场入口对所有已登录账号可见）
- [x] 2.2 运行相关单元测试与 TypeScript 类型检查（Requirement: 应用广场现有访问行为保持不变）

## 3. 文档同步检查

- [x] 3.1 检查 `README.md`、`README.zh-CN.md`、`README.ja-JP.md` 是否需要更新，并记录结论（Requirement: 应用广场现有访问行为保持不变；当前仓库仅存在 `README.md`，且未描述应用广场账号限制，无需更新）
