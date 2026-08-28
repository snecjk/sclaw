# @sto/claw-bridge-sdk

SClaw JSBridge SDK — 供嵌入 SClaw webview 的 `*.sto.cn` H5 页面调用宿主能力。

协议版本：`stoclaw-bridge/v1` · 包版本：`1.1.1`

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

## 能力概览

| 域 | 已实现 method | 说明 |
|----|---------------|------|
| Bridge 元信息 | `bridge.ping` · `bridge.getCapabilities` · `app.getInfo` | 连通性、能力自省、应用上下文 |
| 用户与鉴权 | `user.getInfo` · `auth.getAuthMode` · `auth.getToken` | SSO 用户信息；Token 需 Consent |
| 导航 | `nav.jump` · `nav.openTab` · `nav.openApp` · `nav.goBack` · `nav.reload` · `nav.closeSelf` | 应用广场 Tab / 内外链跳转 |
| UI | `ui.toast` · `ui.alert` · `ui.confirm` · `ui.openDrawer` | 宿主统一 UI |
| **会话联动（UI）** | `chat.fillComposer` · `chat.openSession` · `chat.sendMessage` · `chat.togglePanel` | 打开右栏 AI、回填/发送消息；支持 `text` 或 `segments`（skill / workflow） |
| **AI 引擎直连** | `chat.complete` · `chat.cancel` | Headless 调 Agent，不弹 UI；需 AI Profile |
| Storage | `storage.get` · `storage.set` · `storage.remove` · `storage.clear` | 按 appId 隔离的 KV |
| 预留 | `host.fetch` · `chat.invokeAgent` | 清单已登记，**当前版本尚未实现** |

### 两种 AI 集成方式

| 方式 | API | 适用场景 |
|------|-----|----------|
| **UI 联动** | `sendMessage` / `fillComposer` / `togglePanel` | 用户可见右栏对话，可继续追问 |
| **引擎直连** | `complete()` / `cancel()` | 页面内静默拿 AI 结果，像调 API |

`chat.complete` 还需应用在 SClaw 侧开启 **AI Profile**（`bridgePolicy.ai.enabled`），且首次调用需用户 Consent。详见 [jsbridge-api.md](./jsbridge-api.md)。

### 通信载荷（Text / JSON / 文件）

Bridge 请求/响应走 **JSON 信封**；`File` / `Blob` 不能直接传参。

| 类型 | 用法 |
|------|------|
| **Text** | `fillComposer` / `openSession` / `sendMessage` 的 `text` 或 `segments`；`chat.complete` 的 `prompt` |
| **JSON** | `storage.set/get` 的 `value`；`chat.complete` 的 `context`（≤ 128 KiB）；`responseFormat: 'json'` 时读 `parsed` |
| **文件** | 暂无独立 upload API；推荐 `context.attachments[]` 传 URL/元数据，或小文件 Base64（注意 context 上限） |

```typescript
// JSON 入参 + JSON 出参
const { parsed } = await stoClaw.complete({
  prompt: '分析订单并返回 JSON',
  context: { orderId: 'SO-001', lines: [] },
  responseFormat: 'json',
});

// 文件：URL 引用
await stoClaw.complete({
  prompt: '解析附件',
  context: {
    attachments: [{
      name: 'a.xlsx',
      url: 'https://ops.sto.cn/files/a.xlsx',
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    }],
  },
});
```

完整说明见 [jsbridge-api.md](./jsbridge-api.md)「通信载荷」一节。

## 调用文档

完整 API、参数、权限、错误码与示例见：

**[jsbridge-api.md](./jsbridge-api.md)**

## 环境要求

- 页面在 **SClaw 客户端 webview** 内运行
- 页面域名为 **`*.sto.cn`**
- 客户端已注入 `window.stoClaw`

不装 SDK 也可直接调用：

```typescript
await window.stoClaw.call('user.getInfo');
```

Headless AI 推荐使用 SDK 的 `complete()` / `cancel()`（自动处理超时默认值）：

```typescript
import { stoClaw, BRIDGE_AI_DEFAULT_TIMEOUT_MS } from '@sto/claw-bridge-sdk';

const result = await stoClaw.complete({
  prompt: '分析以下数据',
  context: { rows: [] },
  timeoutMs: BRIDGE_AI_DEFAULT_TIMEOUT_MS,
});
```

## 维护者

```bash
cd packages/claw-bridge-sdk
npm install && npm run build
snpm login   # 首次
snpm publish # package.json 需含 maintainers 字段
```
