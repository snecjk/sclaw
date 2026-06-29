## ADDED Requirements

### Requirement: Local skill files are isolated by user code
The system SHALL store each user's installed skill files under a user-scoped directory derived from `SsoUserInfo.code`, and SHALL keep the Gateway-visible `skills/` directory as a mount point for only the currently active user.

#### Scenario: Fresh install after feature is enabled
- **WHEN** a logged-in user with code `A001` installs a skill from the plaza
- **THEN** the system SHALL write the skill files to `~/.stoclaw/openclaw/users/A001/skills/{slug}/`
- **AND** the system SHALL copy the same skill files to `~/.stoclaw/openclaw/skills/{slug}/`
- **AND** the system SHALL update both `~/.stoclaw/openclaw/users/A001/.clawhub/lock.json` and `~/.stoclaw/openclaw/.clawhub/lock.json`

#### Scenario: Switch to another user
- **WHEN** the active user changes from `A001` to `B002`
- **THEN** the system SHALL copy `skills/` back to `users/A001/skills/`
- **AND** the system SHALL clear `skills/`, `skills-disabled/`, and `.clawhub/lock.json`
- **AND** the system SHALL copy `users/B002/skills/` into `skills/`
- **AND** the system SHALL copy `users/B002/.clawhub/lock.json` into `.clawhub/lock.json`
- **AND** the Gateway SHALL be restarted so that only `B002`'s skills are loaded

### Requirement: Cloud installed list is the source of truth on login
The system SHALL call `GET /agent/v1/skills/plaza/installed` after a successful login and SHALL reconcile the local mount point so that it contains exactly the skills recorded in the cloud for the current user.

#### Scenario: New device login
- **WHEN** user `A001` logs in on a device where no user-scoped skills exist
- **THEN** the system SHALL fetch the cloud installed list for `A001`
- **AND** for each slug in the list that is not already present locally, the system SHALL download it via `GET /agent/v1/skills/slug/{slug}/download`
- **AND** the system SHALL place downloaded skills into both `users/A001/skills/{slug}/` and `skills/{slug}/`
- **AND** the system SHALL rebuild the lock file from the cloud list and the locally resolved metadata

#### Scenario: Skill was uninstalled on another device
- **WHEN** user `A001` uninstalls skill `excel-helper` on device X and then logs in on device Y
- **THEN** the cloud installed list SHALL NOT contain `excel-helper`
- **AND** the system SHALL remove `excel-helper` from `skills/` during reconciliation
- **AND** `excel-helper` SHALL NOT appear in the Skill Plaza "My Skills" list for `A001`

### Requirement: Install and uninstall operations are reported to the cloud
The system SHALL call `POST /agent/v1/skills/plaza/{slug}/install` after a successful local install, and `POST /agent/v1/skills/plaza/{slug}/uninstall` after a successful local uninstall, using the current user's `stoToken`.

#### Scenario: Install from plaza
- **WHEN** the current user installs skill `policy-monitor` from the Skill Plaza
- **THEN** the system SHALL first write the skill files to the user-scoped directory and mount point
- **AND** then the system SHALL call `POST /agent/v1/skills/plaza/policy-monitor/install`

#### Scenario: Uninstall from my skills
- **WHEN** the current user uninstalls skill `policy-monitor` from "My Skills"
- **THEN** the system SHALL first delete the skill files from the user-scoped directory and mount point
- **AND** update both user and mount-point lock files
- **AND** then the system SHALL call `POST /agent/v1/skills/plaza/policy-monitor/uninstall`

### Requirement: Preinstalled skills remain globally shared
The system SHALL keep preinstalled skills (those carrying a `.stoclaw-preinstalled.json` marker) in the global `skills/` directory and SHALL make them available to every activated user workspace without copying them into `users/{userCode}/skills/`.

#### Scenario: Switching users with preinstalled skills present
- **WHEN** the active user changes from `A001` to `B002`
- **THEN** the system SHALL replace only non-preinstalled skills in the mount point
- **AND** preinstalled skills SHALL remain in `skills/` and be visible to `B002`

### Requirement: Legacy global skills are migrated on first activation
The system SHALL detect legacy global skill files that pre-date user-scoped storage and SHALL migrate them to the current user's workspace the first time a user workspace is activated. Preinstalled skills SHALL be excluded from migration and remain in the global directory.

#### Scenario: Upgrade with existing skills
- **WHEN** the feature is first enabled and global `skills/` contains installed skills while `users/` is empty
- **AND** user `A001` logs in
- **THEN** the system SHALL move or copy the global `skills/`, `skills-disabled/`, and `.clawhub/lock.json` into `users/A001/`
- **AND** the system SHALL clear the global directories and re-mount from `users/A001/`

### Requirement: Renderer reflects the active user's skill set
The renderer SHALL refresh the Skill Plaza state whenever the authenticated user changes, and SHALL display a loading indicator while the user skill workspace is being synchronized.

#### Scenario: Login triggers refresh
- **WHEN** a user completes login and the main process begins workspace synchronization
- **THEN** the Skill Plaza page SHALL display a loading overlay with the text "正在同步您的技能…"
- **AND** when synchronization completes, the page SHALL refresh the categories, plaza list, and my-skills list

#### Scenario: User switch clears stale skills
- **WHEN** the active user changes from `A001` to `B002`
- **THEN** the Skill Plaza "My Skills" Tab SHALL no longer show skills that only `A001` had installed
- **AND** it SHALL show skills that `B002` has installed according to the cloud record and local workspace

### Requirement: User code is safe to use as a filesystem path component
The system SHALL sanitize `SsoUserInfo.code` before using it as a directory name, so that characters unsafe for filesystem paths do not cause directory creation failures.

#### Scenario: Code contains special characters
- **WHEN** a user has code `A/B:C|D`
- **THEN** the system SHALL map it to a filesystem-safe directory name (e.g., base64url encoding or replacement of illegal characters)
- **AND** the system SHALL persist a mapping file (`user-code.txt`) inside the user directory so the original code can be recovered for debugging

## MODIFIED Requirements

### Requirement: `StoSkillService` reads and writes skills from the active user workspace
The existing `StoSkillService` SHALL resolve its working skills directory and lock file from the active user workspace instead of the global paths.

#### Scenario: Service initialization
- **WHEN** `StoSkillService` performs any install, uninstall, list, or backfill operation
- **THEN** it SHALL determine the current active `userCode`
- **AND** it SHALL use `~/.stoclaw/openclaw/users/{userCode}/skills/` as the primary skills directory
- **AND** it SHALL use `~/.stoclaw/openclaw/users/{userCode}/.clawhub/lock.json` as the primary lock file
- **AND** it SHALL keep the mount-point copies in sync after mutations

### Requirement: `SkillPlazaService` local state overlays use the active user workspace
The existing `SkillPlazaService` SHALL read installed slugs, enabled slugs, and lock metadata from the active user workspace.

#### Scenario: Fetching "My Skills"
- **WHEN** the Skill Plaza page requests the local skills list
- **THEN** `SkillPlazaService` SHALL scan `users/{userCode}/skills/` and `users/{userCode}/skills-disabled/`
- **AND** it SHALL read lock entries from `users/{userCode}/.clawhub/lock.json`
- **AND** the returned list SHALL contain only skills belonging to the current user
