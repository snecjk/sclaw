# Fix macOS App Name Update Migration

## Why

macOS auto-update can leave the latest application contents inside a historical outer bundle path. SClaw has shipped
as `StoClaw.app`, `STO Claw.app`, and `S Claw.app`; older updater versions preserved that path while replacing the
bundle contents. The current startup migration only recognizes `S Claw.app`, so long-lived installations can still
appear as `StoClaw` or `STO Claw` in Finder and Launchpad even though their `Info.plist` already says `SClaw`.

The manual installer must also handle a stale or partial `SClaw.app` target without deleting rollback state, and it
must keep Launch Services synchronized before old bundles disappear. Deleting an app bundle without unregistering it
can leave Finder, Spotlight, Dock, and Launchpad associated with an obsolete path and icon.

## What

- Stage any pre-existing renamed target bundle (`SClaw.app`) by moving it aside before installing the downloaded app.
- Keep rollback behavior for both the running old-name bundle and the staged target bundle.
- Normalize all known historical bundle names (`StoClaw.app`, `STO Claw.app`, and `S Claw.app`) to `SClaw.app`.
- Unregister historical bundle paths before moving or deleting them and register `SClaw.app` after it is installed.
- Keep Launch Services operations targeted and best-effort; do not rebuild the global database or reset Launchpad.
- Extend macOS startup cleanup to remove updater-staged stale target bundles as well as Squirrel `.old-*` backups.
- Add focused unit coverage for historical naming, registration commands, stale target naming, and staging behavior.

## New Capabilities

- `service-macos-update-migration`

## Modified Capabilities

- None
