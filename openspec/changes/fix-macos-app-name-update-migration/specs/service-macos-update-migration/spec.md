# service-macos-update-migration Spec

### Requirement: macOS updater shall migrate renamed app bundles

The macOS manual updater SHALL install a downloaded app bundle using the downloaded bundle name, even when the
currently running app bundle uses a previous display name such as `S Claw.app`.

#### Scenario: Update from old bundle name to new bundle name

- **WHEN** the running app path is `S Claw.app` and the downloaded update contains `SClaw.app`
- **THEN** the updater SHALL install the downloaded bundle to `SClaw.app`
- **THEN** the updater SHALL retain the old running app as an `.old-*` rollback backup

#### Scenario: Downloaded bundle still uses the legacy app name

- **WHEN** the running app path is `S Claw.app` and the downloaded update contains `S Claw.app`
- **THEN** the updater SHALL normalize the install target to `SClaw.app`
- **THEN** Finder, Dock, and Launchpad SHALL be able to resolve the installed app from the new bundle path after restart

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

When a version containing the renamed app metadata is launched from a legacy `S Claw.app` bundle path, the app SHALL
migrate its own bundle to `SClaw.app` before normal startup work begins.

#### Scenario: New version was installed into legacy bundle path by an older updater

- **WHEN** the packaged macOS app starts from a bundle named `S Claw.app`
- **THEN** the app SHALL move that bundle to `SClaw.app` in the same install directory
- **THEN** the app SHALL relaunch from the new `SClaw.app` bundle path
- **THEN** the app SHALL skip normal window and gateway startup in the legacy process
