package models

import "time"

// ConfigTemplate is a named, reusable YAML configuration template
// stored in the database and pushable to one or many agents.
//
// ConfigKey controls which slot in the OTel Collector's remote ConfigMap this
// template occupies. The OpAMP spec allows multiple config files per agent;
// each key is a separate file that the collector merges at startup.
//
//   - ""         → the main collector config (receivers, processors, exporters, service)
//   - "security" → a separate file for auth extensions, TLS, etc.
//   - "pipeline" → an additional pipeline overlay
//
// Two templates with the same ConfigKey sent to the same agent REPLACE each
// other. Templates with different keys are MERGED by the collector.
// The "opamp" extension is always injected by the server and cannot be
// overridden by any user template.
type ConfigTemplate struct {
	ID          uint      `json:"id"          gorm:"primaryKey;autoIncrement"`
	Name        string    `json:"name"        gorm:"uniqueIndex;not null"`
	Description string    `json:"description"`
	// ConfigKey is the key used in the OpAMP ConfigMap for this template.
	// Leave empty ("") for the primary collector config slot.
	ConfigKey string    `json:"config_key"  gorm:"default:''"`
	YAML      string    `json:"yaml"        gorm:"type:text"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}
