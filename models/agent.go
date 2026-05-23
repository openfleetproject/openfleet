package models

import "time"

type Agent struct {
	ID            string    `json:"id" gorm:"primaryKey"` // InstanceUID
	Hostname      string    `json:"hostname"`
	CustomName    string    `json:"custom_name"` // User-defined name
	OS            string    `json:"os"`
	Version       string    `json:"version"` // Agent semantic version
	Status        string    `json:"status"`  // e.g., "online", "offline"
	Metadata      string    `json:"metadata"` // JSON string of all OpAMP attributes
	LastConnected time.Time `json:"last_connected"`
	HasError      bool      `json:"has_error"`
	LastError     string    `json:"last_error"`
}
