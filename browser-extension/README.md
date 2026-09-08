# SClaw Web Bridge（Chrome 扩展）

源码在本目录。打包产物 `dist/sclaw-web-bridge-<version>.zip` 随应用分发。

- MV3，没有 `content_scripts`，页面操作走 `chrome.debugger`
- Host：`http://127.0.0.1:3210`，请求头 `X-Session-Token`
- `ownership` 固定 `borrowed`，不会 `tabs.remove`
- 点扩展图标打开 **Side Panel**，可向本机 SClaw Agent 发 Prompt（会话 `agent:main:web-bridge`）。桌面聊天仍走 `bridge_*` 驱动当前 Chrome。

Chrome 不允许桌面应用静默安装扩展。SClaw 设置页的「安装扩展」会打开引导：上架 Chrome 应用店后可跳转商店；未上架时会解压到本机固定路径并打开文件夹，用户在 `chrome://extensions` 打开开发者模式后加载该文件夹。

上架后把详情页 URL 填进 `shared/browser-bridge/chrome-web-store.ts` 的 `SCLAW_WEB_BRIDGE_CHROME_WEB_STORE_URL`，引导弹窗会出现「去 Chrome 应用店安装」。

## 加载未打包扩展

1. 在 SClaw 设置里点「安装扩展」（或手动：Chrome `chrome://extensions` → 开发者模式 → 「加载已解压的扩展程序」选本目录）
2. 启动 SClaw，在确认连接 Google Chrome 后扩展会自动接管标签
3. 点工具栏扩展图标打开侧栏，发一条 Prompt 即可同时在桌面看到同一段对话

## 打包

```bash
npm run pack
```

产出必须与 `manifest.json` 的 `version` 同名，测试 `tests/unit/browser-bridge-extension-bundle.test.ts` 会核对。
