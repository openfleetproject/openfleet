# Changelog

All notable changes to OpenFleet are documented here.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).  
This project uses [Semantic Versioning](https://semver.org/).

---

## [Unreleased]

### Added
- **Multi-Template Push** — bulk-push now accepts `template_ids[]` (array) so multiple templates can be sent to many agents in one operation. Each template occupies a named `config_key` slot in the agent's ConfigMap.
- **ConfigKey field** on `ConfigTemplate` model — each template now has an optional `config_key` that controls which slot in the OTel Collector's ConfigMap it occupies. Empty = primary config slot.
- **OpAMP Extension Protection** (`mergeWithOpAMP`) — the `extensions.opamp` block is now always server-managed. User templates may freely add other extensions (`health_check`, `pprof`, `zpages`, etc.) without breaking the agent's OpAMP connection. The server silently corrects any user-provided `extensions.opamp` block on every push.
- **Live YAML Warning Banner** in the template editor — shows an orange warning when the user types `extensions.opamp:` into their template YAML, explaining the server will overwrite it.
- **Template checklist in Bulk Push panel** — the right-hand panel now shows a checklist of all templates (replacing the single-selected-template approach), so users can tick multiple templates and push them together.
- **SHA-256 config hash** — replaced the naive `len(body)` hash with a proper `crypto/sha256` hash for correct change detection by the agent.
- **`config_key` shown in push panel** — each template row in the push panel shows its config key (or `[primary]` if empty) in monospace font for clarity.

### Changed
- `handleBulkPushConfigAPI`: request body now uses `template_ids []uint` instead of `template_id uint`
- `handlePushConfigAPI` (single-agent push): no longer rejects YAML containing `extensions.opamp` — instead silently merges/protects it via `mergeWithOpAMP`
- Bulk push success message now includes the number of templates pushed

---

## [0.1.0] — 2025-12-28

### Added
- Initial release
- OpAMP WebSocket server (`/v1/opamp`) using `opamp-go`
- Agent discovery, health tracking, and fleet dashboard
- Remote config push (single agent and bulk)
- YAML config templates with SQLite persistence
- Wizard Presets — save/load full supervisor install configurations
- Add Agent wizard with install script generator (bash one-liner)
- Agent detail side panel: Config, Actions, Info, Metadata tabs
- Agent restart, mark-offline, delete commands
- Export agent registry as JSON or CSV
- Settings page with wizard defaults and refresh interval control
- Served via embedded static file server (`ui/`)
