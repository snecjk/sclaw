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
    spike/         # 本地联调脚本
    vendor/        # upstream snapshot (MIT)
```

Accounts list merge (Hub + Weixin overlays): `../host/list.ts`.

## State directory

- 当前：`~/.stoclaw/weixin/`
- 兼容旧路径（启动时按需拷贝）：`~/.stoclaw/openclaw/openclaw-weixin/`

## Docs

- [`docs/微信渠道-Host-Worker技术方案.md`](../../../docs/微信渠道-Host-Worker技术方案.md)
- Spike: [`runtime/spike/README.md`](runtime/spike/README.md)
