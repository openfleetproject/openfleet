package server

import (
	"context"
	"fmt"
	"net/http"
)

func (srv *server) Start() error {
	// 0. Mark all agents offline initially (handles server crashes)
	if err := srv.store.UpdateAllAgentsOffline(); err != nil {
		srv.logger.Debugf(context.Background(), "Failed to mark agents offline on startup: %v", err)
	}

	// 1. Attach OpAMP
	handler, connCtx, err := srv.opampSrv.Attach(srv.opampSettings())
	if err != nil {
		return err
	}

	// 2. Create mux and register all routes
	mux := http.NewServeMux()
	srv.registerRoutes(mux, http.HandlerFunc(handler))

	// 3. Create HTTP server on port 8080 (shared by OpAMP + web routes)
	srv.httpServer = &http.Server{
		Addr:        fmt.Sprintf("%s:%d", srv.cfg.OpAMP.Host, srv.cfg.OpAMP.Port),
		Handler:     mux,
		ConnContext: connCtx,
	}

	srv.logger.Debugf(context.Background(), "Server started on %s", srv.httpServer.Addr)

	// 4. Start server
	return srv.httpServer.ListenAndServe()
}

func (srv *server) Stop() error {
	if srv.httpServer != nil {
		return srv.httpServer.Shutdown(context.Background())
	}
	return srv.opampSrv.Stop(context.Background())
}
