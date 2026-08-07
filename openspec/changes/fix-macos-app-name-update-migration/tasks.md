# Tasks

## 1. macOS renamed bundle migration

- [x] 1.1 Implement target staging for `### Requirement: macOS updater shall migrate renamed app bundles`
- [x] 1.2 Preserve rollback for staged targets for `### Requirement: macOS updater shall preserve rollback when renamed target exists`
- [x] 1.3 Normalize legacy extracted bundle names for `### Requirement: macOS updater shall migrate renamed app bundles`
- [x] 1.4 Self-migrate legacy startup paths for `### Requirement: macOS app startup shall self-migrate legacy bundle path`

## 2. Cleanup and validation

- [x] 2.1 Extend cleanup matching for `### Requirement: macOS updater cleanup shall remove staged stale targets`
- [x] 2.2 Add unit tests for `### Requirement: macOS updater shall preserve rollback when renamed target exists`
- [x] 2.3 Relaunch the renamed bundle for `### Requirement: macOS updater restart shall relaunch the renamed bundle`
- [x] 2.4 Review README files for required documentation updates after `### Requirement: macOS updater shall migrate renamed app bundles`

## 3. Historical name and Launch Services reconciliation

- [x] 3.1 Normalize `StoClaw.app`, `STO Claw.app`, and `S Claw.app` for `### Requirement: macOS updater shall migrate renamed app bundles`
- [x] 3.2 Self-migrate every known historical path for `### Requirement: macOS app startup shall self-migrate legacy bundle path`
- [x] 3.3 Add targeted unregister/register helpers for `### Requirement: macOS migration shall reconcile targeted Launch Services records`
- [x] 3.4 Re-register restored bundles during rollback for `### Requirement: macOS migration shall reconcile targeted Launch Services records`
- [x] 3.5 Add historical-name and Launch Services unit coverage for `### Requirement: macOS migration shall reconcile targeted Launch Services records`
- [x] 3.6 Review README files for required documentation updates after `### Requirement: macOS app startup shall self-migrate legacy bundle path`

## 4. Migration hardening

- [x] 4.1 Preserve an equal or newer canonical bundle for `### Requirement: macOS startup migration shall preserve a valid canonical install`
- [x] 4.2 Bound Main and detached Launch Services latency for `### Requirement: macOS migration shall reconcile targeted Launch Services records`
- [x] 4.3 Validate marker deletion targets for `### Requirement: macOS backup marker cleanup shall stay within updater backup boundaries`
- [x] 4.4 Remove redundant registration paths and obsolete legacy exports for `### Requirement: macOS migration shall reconcile targeted Launch Services records`
- [x] 4.5 Add coexistence, timeout, and cleanup-boundary tests for `### Requirement: macOS startup migration shall preserve a valid canonical install`
