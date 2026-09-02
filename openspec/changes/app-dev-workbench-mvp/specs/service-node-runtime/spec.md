# service-node-runtime

## ADDED Requirements

### Requirement: Managed Node runtime resolution
The system SHALL resolve a pinned managed Node runtime under `~/.stoclaw/runtime/node/v<pinned-version>/`, and SHALL use only the managed runtime (never system Node) for user project commands.

#### Scenario: Managed runtime already installed
- **WHEN** the managed Node directory for the pinned version exists and contains the node binary
- **THEN** resolution SHALL return absolute paths to the managed node and npm binaries without triggering a download

#### Scenario: Managed runtime missing
- **WHEN** the managed Node directory for the pinned version does not exist
- **THEN** the system SHALL report status `not-installed` and setup SHALL trigger a download

### Requirement: Runtime download with mirror fallback and integrity check
The system SHALL download the portable Node archive from an ordered source list (configured internal source if present, then npmmirror, then nodejs.org), SHALL verify the archive against the source's `SHASUMS256.txt` before extraction, and SHALL install atomically (extract to a temporary directory, then rename into place).

#### Scenario: Primary source unavailable
- **WHEN** downloading from the highest-priority source fails
- **THEN** the system SHALL retry the same download from the next source in order
- **AND** SHALL only fail setup after all sources have been attempted

#### Scenario: Checksum mismatch
- **WHEN** the downloaded archive's SHA-256 does not match the `SHASUMS256.txt` entry for that filename
- **THEN** the system SHALL discard the archive and treat the attempt as failed
- **AND** SHALL NOT extract or install the archive

#### Scenario: Interrupted installation leaves no partial runtime
- **WHEN** the app quits or the download/extract step fails midway
- **THEN** no partially-extracted content SHALL exist at the final managed runtime path

### Requirement: Setup progress reporting and single-flight
The system SHALL expose setup status (`ready` / `not-installed` / `downloading` / `extracting` / `error`) with byte-level download progress through host-api, and concurrent setup requests SHALL join a single in-flight setup.

#### Scenario: Concurrent setup requests
- **WHEN** setup is requested while a setup is already running
- **THEN** the second request SHALL await the same in-flight operation instead of starting a new download

#### Scenario: Renderer observes progress
- **WHEN** a download is in progress
- **THEN** the renderer SHALL be able to read received/total bytes via host-api to render a progress bar
