package models

import "time"

// WizardPreset stores a full Add-Agent wizard configuration server-side.
// The Data field holds the JSON-encoded form values (endpoint, versions,
// capabilities, etc.) that were collected from the wizard form.
type WizardPreset struct {
	ID        uint      `json:"id"         gorm:"primaryKey;autoIncrement"`
	Name      string    `json:"name"       gorm:"uniqueIndex;not null"`
	Data      string    `json:"data"       gorm:"type:text"` // JSON blob
	SavedAt   time.Time `json:"saved_at"`
	UpdatedAt time.Time `json:"updated_at"`
}
