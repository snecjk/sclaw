# @sto/claw-bridge-sdk

SClaw JSBridge SDK — 供嵌入 SClaw webview 的 `*.sto.cn` H5 页面调用宿主能力。

协议版本：`stoclaw-bridge/v1` · 当前版本：`1.0.0`

## 安装

```bash
snpm install @sto/claw-bridge-sdk
# 或
npm install @sto/claw-bridge-sdk --registry=http://snpm-registry.sto.cn
```

## 快速开始

```typescript
import { stoClaw, isStoClawBridgeAvailable } from '@sto/claw-bridge-sdk';

if (!isStoClawBridgeAvailable()) {
  // 不在 SClaw 内，走 H5 降级
  return;
}

const user = await stoClaw.getUserInfo();
await stoClaw.fillComposer({ text: '请分析当前页面', target: 'embed' });
```

## 调用文档

完整 API、参数、错误码与示例见：

**[jsbridge-api.md](./jsbridge-api.md)**

## 环境要求

- 页面在 **SClaw 客户端 webview** 内运行
- 页面域名为 **`*.sto.cn`**
- 客户端已注入 `window.stoClaw`

不装 SDK 也可直接调用：

```typescript
await window.stoClaw.call('user.getInfo');
```

## 维护者

```bash
cd packages/claw-bridge-sdk
npm install && npm run build
snpm login   # 首次
snpm publish # package.json 需含 maintainers 字段
```
