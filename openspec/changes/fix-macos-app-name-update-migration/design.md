# Design

## Decision: Stage stale renamed targets before installation

When the downloaded bundle name differs from the currently running bundle name, the updater now treats an existing
target path as a stale install target. It renames that target to `*.stale-{timestamp}` before backing up the running
app and moving the downloaded app into place.

Rationale: `rename` is atomic on the same volume and preserves rollback options. It also avoids the macOS `.app`
bundle deletion failure seen when Node `fs.rm(recursive)` hits `ENOTEMPTY` under `Contents/Resources`.

Alternative considered: keep deleting the existing target with a stronger remover before install. This would fix the
immediate `ENOTEMPTY` error, but it would remove the previous target before the new install succeeds.

## Decision: Reuse app bundle cleanup for staged targets

The startup cleanup utility now recognizes both `*.old-*` backups and updater-created `*.stale-*` targets. It also
exposes a generic bundle deletion helper for places that need to delete macOS app bundles.

Rationale: the existing cleanup code already documents why `/bin/rm -rf` is more reliable for macOS `.app` bundles
than Node recursive removal. Reusing it keeps the workaround in one place.

Alternative considered: add a separate updater-only deletion function. That would duplicate the platform-specific
behavior and make future cleanup fixes easier to miss.

## Risks

[Risk] A stale target bundle might not be removed immediately after successful installation.
Mitigation: successful install attempts best-effort removal immediately, and startup cleanup also recognizes
`*.stale-*` names for retry.

[Risk] Installation might fail after both the stale target and running app have been moved.
Mitigation: rollback removes any partial new target, restores the running app backup, and restores the staged target.
