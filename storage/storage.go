package storage

import (
	"time"

	"github.com/glebarez/sqlite"
	"github.com/openfleetproject/openfleet/models"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

// ── Interface ──────────────────────────────────────────────────────────────────

type Storage interface {
	SaveAgent(agent *models.Agent) error
	GetAgents() ([]models.Agent, error)
	GetAgent(id string) (*models.Agent, error)

	SaveAgentConfig(config *models.AgentConfig) error
	GetAgentConfig(id string) (*models.AgentConfig, error)
	GetAgentConfigs(agentID string) ([]models.AgentConfig, error)

	UpdateAllAgentsOffline() error
	DeleteAgent(id string) error
	DeleteOfflineAgents() (int64, error)

	// Config Templates
	SaveTemplate(t *models.ConfigTemplate) error
	GetTemplates() ([]models.ConfigTemplate, error)
	GetTemplate(id uint) (*models.ConfigTemplate, error)
	DeleteTemplate(id uint) error

	// Wizard Presets
	SaveWizardPreset(p *models.WizardPreset) error
	GetWizardPresets() ([]models.WizardPreset, error)
	GetWizardPreset(id uint) (*models.WizardPreset, error)
	RenameWizardPreset(id uint, newName string) error
	DeleteWizardPreset(id uint) error
}

// ── SQLite Implementation ──────────────────────────────────────────────────────

type sqliteStorage struct {
	db *gorm.DB
}

func NewSQLiteStorage(dbPath string) (Storage, error) {
	db, err := gorm.Open(sqlite.Open(dbPath), &gorm.Config{
		Logger: logger.Default.LogMode(logger.Silent),
	})
	if err != nil {
		return nil, err
	}
	err = db.AutoMigrate(&models.Agent{}, &models.AgentConfig{}, &models.ConfigTemplate{}, &models.WizardPreset{})
	if err != nil {
		return nil, err
	}
	return &sqliteStorage{db: db}, nil
}

// ── Agents ────────────────────────────────────────────────────────────────────

func (s *sqliteStorage) SaveAgent(agent *models.Agent) error {
	return s.db.Save(agent).Error
}

func (s *sqliteStorage) GetAgents() ([]models.Agent, error) {
	var agents []models.Agent
	err := s.db.Find(&agents).Error
	return agents, err
}

func (s *sqliteStorage) GetAgent(id string) (*models.Agent, error) {
	var agent models.Agent
	err := s.db.First(&agent, "id = ?", id).Error
	return &agent, err
}

func (s *sqliteStorage) UpdateAllAgentsOffline() error {
	return s.db.Model(&models.Agent{}).Where("status = ?", "online").Update("status", "offline").Error
}

func (s *sqliteStorage) DeleteAgent(id string) error {
	s.db.Where("agent_id = ?", id).Delete(&models.AgentConfig{})
	return s.db.Where("id = ?", id).Delete(&models.Agent{}).Error
}

func (s *sqliteStorage) DeleteOfflineAgents() (int64, error) {
	var ids []string
	s.db.Model(&models.Agent{}).Where("status = ?", "offline").Pluck("id", &ids)
	if len(ids) > 0 {
		s.db.Where("agent_id IN ?", ids).Delete(&models.AgentConfig{})
	}
	result := s.db.Where("status = ?", "offline").Delete(&models.Agent{})
	return result.RowsAffected, result.Error
}

// ── Agent Configs ─────────────────────────────────────────────────────────────

func (s *sqliteStorage) SaveAgentConfig(config *models.AgentConfig) error {
	return s.db.Save(config).Error
}

func (s *sqliteStorage) GetAgentConfig(id string) (*models.AgentConfig, error) {
	var config models.AgentConfig
	err := s.db.First(&config, "id = ?", id).Error
	return &config, err
}

func (s *sqliteStorage) GetAgentConfigs(agentID string) ([]models.AgentConfig, error) {
	var configs []models.AgentConfig
	err := s.db.Where("agent_id = ?", agentID).Find(&configs).Error
	return configs, err
}

// ── Config Templates ──────────────────────────────────────────────────────────

func (s *sqliteStorage) SaveTemplate(t *models.ConfigTemplate) error {
	return s.db.Save(t).Error
}

func (s *sqliteStorage) GetTemplates() ([]models.ConfigTemplate, error) {
	var templates []models.ConfigTemplate
	err := s.db.Order("updated_at desc").Find(&templates).Error
	return templates, err
}

func (s *sqliteStorage) GetTemplate(id uint) (*models.ConfigTemplate, error) {
	var t models.ConfigTemplate
	err := s.db.First(&t, id).Error
	return &t, err
}

func (s *sqliteStorage) DeleteTemplate(id uint) error {
	return s.db.Delete(&models.ConfigTemplate{}, id).Error
}

// ── Wizard Presets ────────────────────────────────────────────────────────────

func (s *sqliteStorage) SaveWizardPreset(p *models.WizardPreset) error {
	return s.db.Save(p).Error
}

func (s *sqliteStorage) GetWizardPresets() ([]models.WizardPreset, error) {
	var presets []models.WizardPreset
	err := s.db.Order("updated_at desc").Find(&presets).Error
	return presets, err
}

func (s *sqliteStorage) GetWizardPreset(id uint) (*models.WizardPreset, error) {
	var p models.WizardPreset
	err := s.db.First(&p, id).Error
	return &p, err
}

func (s *sqliteStorage) RenameWizardPreset(id uint, newName string) error {
	return s.db.Model(&models.WizardPreset{}).Where("id = ?", id).
		Updates(map[string]interface{}{"name": newName, "updated_at": time.Now()}).Error
}

func (s *sqliteStorage) DeleteWizardPreset(id uint) error {
	return s.db.Delete(&models.WizardPreset{}, id).Error
}
