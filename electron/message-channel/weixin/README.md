# Weixin message channel

Host Worker + iLink：微信 ClawBot（单 Bot；运行时固定 SAgent `pi` + Main Agent `main`）。

## Layout

```
weixin/
  host-login.ts / routes.ts                         # Host 扫码 + /api/channels/wechat/*
  service.ts / bridge-*.ts / binding.ts / types.ts   # Host
  runtime/
    worker-entry.ts / fork-options.ts
    transport/     # iLink client
    adapter/       # Wire normalize/encode
    spike/         # 本地联调脚本（开发专用，不进安装包）
    vendor/        # upstream snapshot（thin import；不打包进 weixin-runtime）
```

Accounts list merge (Hub + Weixin overlays): `../host/list.ts`.

## State directory

- 当前：`~/.stoclaw/weixin/`
- 旧路径 `~/.stoclaw/openclaw/openclaw-weixin/`：**本 epoch（`2026.09-host-weixin`）不迁移**；升级时由 `maybeResetChannelRuntimeEpoch` 删除，需重新扫码。

## Binding notes

- `getWeixinBinding()` 在无 DB 行时可用本地凭证文件兜底——**仅首次绑定窗口**（扫码已写文件、DB 尚未落盘）。epoch 重置同时删文件 + revoke DB，reset 后该分支不会复活。
- 拉起 Worker 以 `await getWeixinBinding() != null` 为准，禁止仅用 `hasWeixinBotBound()`（只看文件）当 start-gate。

## Docs

- [`openclaw-weixin-改造说明.md`](./openclaw-weixin-改造说明.md) — 相对上游插件的改造要点
- [`docs/微信渠道-Host-Worker技术方案.md`](../../../docs/微信渠道-Host-Worker技术方案.md)
- [`docs/频道破坏性重绑与运行时收敛计划.md`](../../../docs/频道破坏性重绑与运行时收敛计划.md)
- Spike: [`runtime/spike/README.md`](runtime/spike/README.md)（开发专用，不打包）
