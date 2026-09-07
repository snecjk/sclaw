# StoClaw Browser Bridge（Chrome 扩展）

源码在本目录。打包产物 `dist/stoclaw-browser-bridge-<version>.zip` 随应用分发。

- MV3，没有 `content_scripts`，页面操作走 `chrome.debugger`
- Host：`http://127.0.0.1:3210`，请求头 `X-Session-Token`
- `ownership` 固定 `borrowed`，不会 `tabs.remove`

## 加载未打包扩展

1. Chrome `chrome://extensions` → 开发者模式
2. 「加载已解压的扩展程序」选本目录
3. 启动 StoClaw，点扩展图标连接

## 打包

```bash
npm run pack
```

产出必须与 `manifest.json` 的 `version` 同名，测试 `tests/unit/browser-bridge-extension-bundle.test.ts` 会核对。
