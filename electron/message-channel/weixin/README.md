# Weixin message channel

Host Worker + iLink transport for WeChat ClawBot (Pi-only, single Bot).

## Layout

```
weixin/
  service.ts / bridge-*.ts / binding.ts / types.ts   # Host
  runtime/
    worker-entry.ts / fork-options.ts
    transport/     # thin iLink client
    adapter/       # Wire normalize/encode
    spike/         # Phase 0 R1/R4 gate
    vendor/        # upstream snapshot (MIT)
```

## State directory

- New: `~/.stoclaw/weixin/`
- Legacy (migrate from): `~/.stoclaw/openclaw/openclaw-weixin/`

## Docs

- [`docs/微信渠道-Host-Worker技术方案.md`](../../../docs/微信渠道-Host-Worker技术方案.md)
- Spike: [`runtime/spike/README.md`](runtime/spike/README.md)
