# service-macos-update-migration Spec

### Requirement: macOS updater shall migrate renamed app bundles

The macOS manual updater SHALL install a downloaded app bundle at the canonical `SClaw.app` path, even when the
currently running or downloaded app bundle uses a historical name such as `StoClaw.app`, `STO Claw.app`, or
`S Claw.app`.

#### Scenario: Update from old bundle name to new bundle name

- **WHEN** the running app path is `S Claw.app` and the downloaded update contains `SClaw.app`
- **THEN** the updater SHALL install the downloaded bundle to `SClaw.app`
- **THEN** the updater SHALL retain the old running app as an `.old-*` rollback backup

#### Scenario: Downloaded bundle still uses the legacy app name

- **WHEN** the running app path is `S Claw.app` and the downloaded update contains `S Claw.app`
- **THEN** the updater SHALL normalize the install target to `SClaw.app`
- **THEN** Finder, Dock, and Launchpad SHALL be able to resolve the installed app from the new bundle path after restart

#### Scenario: Update from an early historical bundle name

- **WHEN** the running app path is `StoClaw.app` or `STO Claw.app` and the downloaded update contains a known historical bundle name
- **THEN** the updater SHALL install the downloaded bundle to `SClaw.app`
- **THEN** the updater SHALL retain the old running app as an `.old-*` rollback backup

### Requirement: macOS updater shall preserve rollback when renamed target exists

The macOS manual updater MUST stage a pre-existing target bundle instead of deleting it before the new bundle has been
installed successfully.

#### Scenario: Existing target bundle is stale or partial

- **WHEN** the running app path is `S Claw.app`, the downloaded update contains `SClaw.app`, and `SClaw.app` already exists
- **THEN** the updater SHALL move the existing `SClaw.app` to a `.stale-*` path before installing
- **THEN** the updater SHALL avoid failing solely because recursive deletion of the stale bundle returns `ENOTEMPTY`

#### Scenario: Install fails after staging target

- **WHEN** the updater has staged an existing target bundle and the install fails
- **THEN** the updater SHALL restore the old running app backup when available
- **THEN** the updater SHALL restore the staged target bundle when available

### Requirement: macOS updater cleanup shall remove staged stale targets

The macOS updater cleanup MUST recognize updater-staged `.stale-*` bundles next to the running app bundle and attempt
to remove them using the same robust app bundle deletion path used for `.old-*` backups.

#### Scenario: New version starts with stale target backup beside it

- **WHEN** the app starts from `SClaw.app` and a sibling `SClaw.app.stale-*` bundle exists
- **THEN** cleanup SHALL include that stale target in its removal candidates

### Requirement: macOS updater restart shall relaunch the renamed bundle

After a successful manual macOS install, the updater SHALL restart through the newly installed app bundle path when
the app bundle path has changed during the update.

#### Scenario: User clicks restart after renamed bundle install

- **WHEN** the installed update target is `SClaw.app` and the current process executable still points inside an old backup bundle
- **THEN** clicking restart SHALL quit the current process
- **THEN** the updater SHALL launch the new `SClaw.app` bundle

### Requirement: macOS app startup shall self-migrate legacy bundle path

When a version containing the renamed app metadata is launched from a known historical bundle path, the app SHALL
migrate its own bundle to `SClaw.app` before normal startup work begins. Known historical paths MUST include
`StoClaw.app`, `STO Claw.app`, and `S Claw.app`.

#### Scenario: New version was installed into legacy bundle path by an older updater

- **WHEN** the packaged macOS app starts from a bundle named `S Claw.app`
- **THEN** the app SHALL move that bundle to `SClaw.app` in the same install directory
- **THEN** the app SHALL relaunch from the new `SClaw.app` bundle path
- **THEN** the app SHALL skip normal window and gateway startup in the legacy process

#### Scenario: New version was installed into an early historical path

- **WHEN** the packaged macOS app starts from a bundle named `StoClaw.app` or `STO Claw.app`
- **THEN** the app SHALL move that bundle to `SClaw.app` in the same install directory
- **THEN** the app SHALL relaunch from the new `SClaw.app` bundle path
- **THEN** the app SHALL skip normal window and gateway startup in the legacy process

### Requirement: macOS migration shall reconcile targeted Launch Services records

The macOS updater and startup migration SHALL best-effort unregister an existing historical bundle path before moving
or deleting that bundle and SHALL best-effort register the canonical `SClaw.app` after it is installed or restored.
The application MUST NOT rebuild the global Launch Services database or reset Launchpad automatically.

#### Scenario: Historical bundle is migrated successfully

- **WHEN** a known historical bundle exists and migration to `SClaw.app` succeeds
- **THEN** the migration SHALL attempt to unregister the historical path before it disappears
- **THEN** the migration SHALL attempt to register the canonical `SClaw.app` before relaunch

#### Scenario: Installation rolls back after registration changes

- **WHEN** installation fails after the current or staged bundle was unregistered
- **THEN** rollback SHALL restore the affected bundle paths
- **THEN** rollback SHALL attempt to register every restored app bundle

#### Scenario: Launch Services command fails

- **WHEN** a targeted Launch Services registration or unregistration command fails
- **THEN** the failure SHALL be logged
- **THEN** file installation, rollback, cleanup, or startup migration SHALL continue without a global reset

#### Scenario: Launch Services command does not complete

- **WHEN** a targeted Launch Services command exceeds the bounded registration timeout
- **THEN** the command SHALL be terminated or detached from the critical path
- **THEN** installation, rollback, cleanup, or relaunch SHALL continue

### Requirement: macOS startup migration shall preserve a valid canonical install

When a historical bundle and `SClaw.app` coexist, startup migration MUST inspect both bundles before replacing the
canonical target. A valid canonical target with an equal or newer version SHALL be preserved.

#### Scenario: User launches an older historical copy beside a newer canonical install

- **WHEN** the running historical bundle is older than a valid sibling `SClaw.app`
- **THEN** startup migration SHALL NOT stage or replace `SClaw.app`
- **THEN** the app SHALL relaunch the existing `SClaw.app`
- **THEN** the canonical app SHALL retain the historical-copy removal prompt

#### Scenario: Historical path contains the newer payload

- **WHEN** the running historical bundle is newer than a valid sibling `SClaw.app`
- **THEN** startup migration SHALL stage the older canonical target
- **THEN** the app SHALL migrate the historical bundle to `SClaw.app`

#### Scenario: Canonical target is incomplete

- **WHEN** the sibling `SClaw.app` lacks readable version metadata or its declared executable
- **THEN** startup migration SHALL treat the canonical target as incomplete
- **THEN** the app SHALL continue the guarded staging migration from the running historical bundle

### Requirement: macOS backup marker cleanup shall stay within updater backup boundaries

Marker-driven recursive cleanup MUST only remove a recognized `.app.old-{timestamp}` path in the running app's
install directory.

#### Scenario: Backup marker path is invalid

- **WHEN** the persisted backup marker points outside the install directory or does not match a known backup name
- **THEN** cleanup SHALL NOT recursively delete the marker target
- **THEN** cleanup SHALL remove or ignore the invalid marker and log the validation failure
