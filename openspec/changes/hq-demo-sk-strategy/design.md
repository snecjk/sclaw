# Design: HQ Demo SK Strategy

## Strategy pattern extension

```
resolveAuthMode()
  ├─ hq-demo-as-site → DemoSkStrategy → HqSkStrategy(origin)
  ├─ native-site     → SiteSkStrategy
  └─ native-hq       → HqSkStrategy
```

## Token dual-track

- `getStoToken()`: session/business (site after switch)
- `getAiResourceStoToken()`: HQ origin token when demo-as-site

Memory-center AI calls use `memoryCenterFetchForAi`; account-switch and site expansion use `memoryCenterFetchForSession`.

## Provider sync

`sto-model-sync` uses `resolveAiResourceContext().aiUser.code` for `headers.secret` (md5) so inference auth stays consistent with HQ SK.
