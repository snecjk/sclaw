## ADDED Requirements

### Requirement: 应用广场 Banner 使用统一 16:3 比例
StoClaw 应用广场的正常 Banner、加载骨架和错误占位 MUST 使用 16:3 的展示比例；正常 Banner 的默认及悬停状态 MUST NOT 展示蓝色阴影或蓝色边框。

#### Scenario: 正常 Banner 展示
- **WHEN** 应用广场成功获取并展示 Banner
- **THEN** Banner 容器以 16:3 比例展示，且没有蓝色阴影或蓝色边框

#### Scenario: Banner 加载状态
- **WHEN** 应用广场正在加载 Banner 数据
- **THEN** 加载骨架以 16:3 比例展示

#### Scenario: Banner 错误状态
- **WHEN** Banner 数据获取失败
- **THEN** 错误占位以 16:3 比例展示

#### Scenario: 暗色模式
- **WHEN** 用户在暗色模式查看应用广场 Banner
- **THEN** Banner 仍以 16:3 比例展示，沿用现有暗色主题背景，且没有蓝色阴影或蓝色边框

#### Scenario: 键盘聚焦 Banner
- **WHEN** 用户使用键盘将焦点移动到可点击 Banner
- **THEN** Banner MUST 保留清晰的非蓝色聚焦轮廓

### Requirement: 管理端裁剪框匹配客户端 Banner
`memory-center-web` 的 Banner 裁剪框 MUST 使用 StoClaw Banner 的 862px 最大展示宽度和 20px 圆角，并 MUST 保持 16:3 比例。

#### Scenario: 管理员裁剪 Banner
- **WHEN** 管理员选择 Banner 图片并进入裁剪页面
- **THEN** 裁剪框以 862px、16:3 和 20px 圆角展示，使框内预览轮廓与 StoClaw 一致

#### Scenario: 管理员裁剪图标
- **WHEN** 管理员选择 APP 或分类图标并进入裁剪页面
- **THEN** 图标裁剪框继续使用原有方形尺寸和圆角，不受 Banner 设置影响
