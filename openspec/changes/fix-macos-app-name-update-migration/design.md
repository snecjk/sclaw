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

## Decision: Treat all shipped bundle names as legacy aliases

The migration owns a closed set of historical bundle names: `StoClaw.app`, `STO Claw.app`, and `S Claw.app`. Any of
these names is normalized to the canonical `SClaw.app` target during startup self-migration and manual installation.
The same set is reused when matching `.old-*` backups so cleanup cannot omit users from an earlier branding period.

Rationale: older updaters replaced bundle contents at the existing path, so current `Info.plist` metadata does not
prove that the outer bundle path was renamed.

Alternative considered: support only `S Claw.app`, the immediately previous name. Real installations still using
`STO Claw.app` demonstrate that this leaves long-lived auto-update users outside the migration.

## Decision: Reconcile Launch Services with targeted best-effort commands

Before an existing app bundle is moved, deleted, or sent to Trash, Main unregisters that exact path through the
system `lsregister` utility. After the canonical bundle is installed or moved into place, Main force-registers only
`SClaw.app`. Registration failures are logged and do not abort installation, rollback, or startup.

Rationale: deleting bundle files alone leaves stale Launch Services records, while targeted registration avoids
modifying unrelated applications or user file associations.

Alternative considered: rebuild the global Launch Services database and restart Dock. This is more invasive, can
change user defaults, and still depends on undocumented system behavior, so it is reserved for a support procedure.

## Decision: Preserve a valid canonical bundle when legacy and canonical installs coexist

Startup self-migration inspects both bundles before staging an existing `SClaw.app`. When the canonical target has a
valid `Info.plist`, executable, and version that is equal to or newer than the running historical bundle, the app
keeps the canonical target, relaunches it, and lets its normal legacy-copy prompt remove the old bundle. The
historical bundle replaces the target only when it is newer or the target is incomplete.

Rationale: a user can manually install a newer `SClaw.app` while retaining an older historical copy. Blind staging
would let an accidental launch of the old copy replace and eventually delete the newer installation.

Alternative considered: always prefer the canonical path regardless of version. This avoids overwrite risk but can
downgrade a user who is running a newer auto-updated payload from a historical outer path.

## Decision: Bound registration latency and validate destructive cleanup targets

Main-process `lsregister` calls use a fixed timeout and remain best-effort. Detached relaunch scripts never wait for
Launch Services registration to complete. Marker-driven backup deletion validates that the target is a recognized
`.app.old-{timestamp}` sibling of the running app before invoking robust recursive removal.

Rationale: system registration must not indefinitely block installation or relaunch, and a persisted marker must
not broaden the deletion boundary beyond updater-created backups.

Alternative considered: leave registration unbounded and trust the marker because both are normally controlled by
the application. This makes rare system hangs and corrupted local state unnecessarily destructive.

## Risks

[Risk] A stale target bundle might not be removed immediately after successful installation.
Mitigation: successful install attempts best-effort removal immediately, and startup cleanup also recognizes
`*.stale-*` names for retry.

[Risk] Installation might fail after both the stale target and running app have been moved.
Mitigation: rollback removes any partial new target, restores the running app backup, and restores the staged target.

[Risk] `lsregister` is an undocumented system utility whose path or behavior may vary across macOS releases.
Mitigation: resolve the standard system path, keep calls macOS-only and best-effort, and preserve file migration as
the source of truth.

[Risk] Unregistering the current path before installation could leave no active registration if installation fails.
Mitigation: rollback re-registers every restored bundle, and successful installation registers the canonical target
before relaunch.

[Risk] Historical Launch Services records may already point to app bundles that no longer exist.
Mitigation: the application does not perform a global reset; targeted migration prevents new stale records, while
support documentation covers one-time remediation for already-corrupted system state.

[Risk] Version metadata may be missing or malformed on a partial target bundle.
Mitigation: a target is considered canonical only when its plist, executable, and numeric version can all be read;
otherwise the running historical bundle remains the migration source.

[Risk] Launch Services registration may hang or outlive the relaunching process.
Mitigation: Main calls have a fixed timeout, and shell relaunch paths start registration without waiting before
opening the selected bundle.
