## 1. StoClaw Banner 布局

- [x] 1.1 将正常、加载和错误 Banner 的比例从 16:5 改为 16:3（Requirement: 应用广场 Banner 使用统一 16:3 比例）
- [x] 1.2 增加样式契约测试，覆盖三种 Banner 状态（Requirement: 应用广场 Banner 使用统一 16:3 比例）
- [x] 1.3 复核亮色与暗色模式，确认未新增硬编码的单主题颜色（Requirement: 应用广场 Banner 使用统一 16:3 比例）
- [x] 1.4 移除 Banner 默认和悬停状态的蓝色阴影（Requirement: 应用广场 Banner 使用统一 16:3 比例）
- [x] 1.5 更新样式契约测试，验证两种状态均无阴影（Requirement: 应用广场 Banner 使用统一 16:3 比例）

## 2. 管理端裁剪预览

- [x] 2.1 将 Banner 裁剪舞台调整为 862px、16:3 和 20px 圆角，同时保持图标裁剪配置不变（Requirement: 管理端裁剪框匹配客户端 Banner）
- [x] 2.2 将上传后的 Banner 预览圆角同步为 20px，并补充配置测试（Requirement: 管理端裁剪框匹配客户端 Banner）

## 3. 验证与文档

- [x] 3.1 运行 StoClaw 和 memory-center-web 相关测试、Lint 与 OpenSpec 严格校验（Requirement: 应用广场 Banner 使用统一 16:3 比例；Requirement: 管理端裁剪框匹配客户端 Banner）
- [x] 3.2 复核两个项目的 README 是否需要同步说明（Requirement: 应用广场 Banner 使用统一 16:3 比例；Requirement: 管理端裁剪框匹配客户端 Banner）
