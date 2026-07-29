## Why

应用广场 Banner 当前使用 16:5，和管理端约定的 16:3 素材比例不一致，展示时容易出现构图偏差。需要将 StoClaw 的 Banner 展示比例同步为 16:3。

## What Changes

- 将应用广场正常 Banner 的展示比例从 16:5 调整为 16:3。
- 将加载骨架和错误占位同步调整为 16:3，避免状态切换时布局跳动。
- 将 `memory-center-web` 的 Banner 裁剪框同步为 StoClaw 的最大展示宽度和 20px 圆角，使裁剪预览与客户端展示一致。
- 移除 StoClaw Banner 默认和悬停状态的蓝色阴影，以及正常展示状态的蓝色边框。
- 保留现有圆角、图片填充方式、键盘聚焦轮廓和轮播交互，不调整其他视觉效果。
- 继续兼容亮色与暗色模式。

## Capabilities

### New Capabilities

- `app-plaza-banner-layout`: 规定应用广场 Banner 及其加载、错误状态统一使用 16:3 展示比例。

### Modified Capabilities

无。

## Impact

- 影响 StoClaw 应用广场页面的 Banner CSS 布局，以及 `memory-center-web` 的 Banner 图片裁剪预览。
- 不影响后台接口、数据模型、依赖或其他页面。
