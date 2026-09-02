## ADDED Requirements

### Requirement: Extensible component catalog
The template MUST register A2UI `basicCatalog` for page surfaces. Custom catalogs (including Ant Design wrappers) are deferred and MUST NOT be required for MVP preview.

#### Scenario: basicCatalog available
- **WHEN** a page surface uses `catalogId` of `basic` (or the basic catalog id)
- **THEN** standard Basic components (e.g. Column, Text, Button) MUST render

#### Scenario: unregistered component rejected
- **WHEN** a page references a component name not present in any registered catalog
- **THEN** processing/validation MUST fail visibly rather than silently ignoring the node

#### Scenario: antd deferred
- **WHEN** the MVP template is created
- **THEN** the template MUST NOT depend on `antd` until a later catalog milestone explicitly enables it
