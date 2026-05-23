package server

import (
	"net/http"
	"sync"

	opampserver "github.com/open-telemetry/opamp-go/server"
	"github.com/open-telemetry/opamp-go/server/types"
	"github.com/openfleetproject/openfleet/config"
	"github.com/openfleetproject/openfleet/storage"
	"github.com/openfleetproject/openfleet/utils"
)

type Server interface {
	Start() error
	Stop() error
}

type server struct {
	opampSrv          opampserver.OpAMPServer
	cfg               *config.Config
	logger            *utils.Logger
	httpServer        *http.Server
	activeConnections map[string]types.Connection // Maps Agent UID to WebSocket
	connMutex         sync.RWMutex                // Thread-safety
	store             storage.Storage
}

func NewServer(cfg *config.Config, logger *utils.Logger) Server {
	store, err := storage.NewSQLiteStorage("openfleet.db")
	if err != nil {
		panic("Failed to open SQLite database: " + err.Error())
	}

	return &server{
		cfg:               cfg,
		logger:            logger,
		opampSrv:          opampserver.New(logger),
		activeConnections: make(map[string]types.Connection),
		store:             store,
	}
}
