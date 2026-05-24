package models

import "time"

type AgentConfig struct {
	ID         string    `json:"id" gorm:"primaryKey"`
	AgentID    string    `json:"agent_id" gorm:"index"` // References Agent.ID
	Name       string    `json:"name"`
	ConfigYAML string    `json:"config_yaml"`
	UpdatedAt  time.Time `json:"updated_at"`
}
