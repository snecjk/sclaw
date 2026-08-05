# Fix macOS App Name Update Migration

## Why

macOS auto-update can fail when a packaged app changes its bundle name from `S Claw.app` to `SClaw.app`.
The manual installer derives the destination from the downloaded bundle name, but if a stale or partial `SClaw.app`
already exists in the install directory, deleting it with Node `fs.rm(recursive)` can fail with `ENOTEMPTY` inside
`Contents/Resources`. That aborts installation before the old-name app can be replaced, leaving Dock and Launchpad
entries on the old `S Claw` name.

## What

- Stage any pre-existing renamed target bundle (`SClaw.app`) by moving it aside before installing the downloaded app.
- Keep rollback behavior for both the running old-name bundle and the staged target bundle.
- Extend macOS startup cleanup to remove updater-staged stale target bundles as well as Squirrel `.old-*` backups.
- Add focused unit coverage for stale target naming and staging behavior.

## New Capabilities

- `service-macos-update-migration`

## Modified Capabilities

- None
