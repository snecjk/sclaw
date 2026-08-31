# JSBridge Excel → Claw Agent Demo

使用 **`@sto/claw-bridge-sdk@1.1.0`**。仅在 SClaw 应用广场内真实调模型。

## SDK 怎么来的

Demo 默认走内置拷贝（不依赖 install）：

```
vendor/@sto/claw-bridge-sdk/dist/index.js
```

也可手动装 snpm 包（工程红线请你本地执行）：

```bash
cd demos/jsbridge-excel-ai-demo
snpm install
# 然后把 index.html importmap 改成 ./node_modules/@sto/claw-bridge-sdk/dist/index.js
```

更新 vendor（SDK 重 build 后）：

```bash
cp -R ../../packages/claw-bridge-sdk/dist vendor/@sto/claw-bridge-sdk/
```

## 在 SClaw 中演示

1. 起静态服务：`python3 -m http.server 8787`
2. 用 hosts/反代让页面成为 `*.sto.cn`（例如 `http://zc-dev.sto.cn:8787/`）
3. **重启带 JSBridge preload 修复的 SClaw**，在应用广场打开该 URL
4. 控制台确认：`!!window.stoClaw?.call === true`
5. 「加载示例坏数据」→「AI 分析」
6. **推荐路径（Headless）**：`chat.complete` 把 `{ text, parsed }` 回给页面 → 「应用修复到表格」和/或「下载修复文件（重新上传）」
7. 应用需开启 AI Profile（`bridgePolicy.ai.enabled`），能力 pill 显示 `complete ✓`；否则会自动切到 UI 联动（需粘贴 JSON）

若页面一直停在「检测 Bridge…」且中间空白：多半是 **SDK 脚本没加载成功**，看是否弹出「Demo 脚本加载失败」。

若 SDK 已加载但仍无 `window.stoClaw`：是 **宿主 webview preload 未注入**，需用修过 `SclawBrowserFrame` 的客户端。
