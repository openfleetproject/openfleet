package server

import (
	"context"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"io/fs"
	"net/http"
	"strings"
	"time"

	"github.com/open-telemetry/opamp-go/protobufs"
)

func (srv *server) registerRoutes(mux *http.ServeMux, opampHandler http.Handler) {
	// OpAMP protocol — handled by the opamp-go library
	mux.Handle("/v1/opamp", opampHandler)

	// Agent management
	mux.HandleFunc("/api/agents", srv.handleGetAgentsAPI)
	mux.HandleFunc("/api/agents/restart", srv.handleRestartAgentAPI)
	mux.HandleFunc("/api/agents/delete", srv.handleDeleteAgentAPI)
	mux.HandleFunc("/api/agents/offline", srv.handleMarkOfflineAPI)
	mux.HandleFunc("/api/agents/cleanup", srv.handleCleanupOfflineAPI)
	mux.HandleFunc("/api/agents/rename", srv.handleRenameAgentAPI)
	mux.HandleFunc("/api/agents/config/push", srv.handlePushConfigAPI)
	mux.HandleFunc("/api/agents/config/bulk-push", srv.handleBulkPushConfigAPI)

	// Configs & Templates
	mux.HandleFunc("/api/configs", srv.handleGetConfigsAPI)
	mux.HandleFunc("/api/templates", srv.handleGetTemplatesAPI)
	mux.HandleFunc("/api/templates/save", srv.handleSaveTemplateAPI)
	mux.HandleFunc("/api/templates/delete", srv.handleDeleteTemplateAPI)

	// Wizard Presets (server-side persistence)
	mux.HandleFunc("/api/wizard-presets", srv.handleGetWizardPresetsAPI)
	mux.HandleFunc("/api/wizard-presets/save", srv.handleSaveWizardPresetAPI)
	mux.HandleFunc("/api/wizard-presets/rename", srv.handleRenameWizardPresetAPI)
	mux.HandleFunc("/api/wizard-presets/delete", srv.handleDeleteWizardPresetAPI)

	// Server info & export
	mux.HandleFunc("/api/server/info", srv.handleServerInfoAPI)
	mux.HandleFunc("/api/export/agents", srv.handleExportAgentsAPI)

	// Install scripts
	mux.HandleFunc("/api/install-script", srv.handleInstallScriptAPI)
	mux.HandleFunc("/api/uninstall-script", srv.handleUninstallScriptAPI)

	// Static UI — served from the binary-embedded filesystem
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		p := strings.TrimPrefix(r.URL.Path, "/")
		if p == "" {
			p = "index.html"
		}
		data, err := fs.ReadFile(uiFiles, p)
		if err != nil {
			// Fallback to index.html for SPA client-side routing
			data, err = fs.ReadFile(uiFiles, "index.html")
			if err != nil {
				http.NotFound(w, r)
				return
			}
			p = "index.html"
		}
		switch {
		case strings.HasSuffix(p, ".html"):
			w.Header().Set("Content-Type", "text/html; charset=utf-8")
		case strings.HasSuffix(p, ".css"):
			w.Header().Set("Content-Type", "text/css; charset=utf-8")
		case strings.HasSuffix(p, ".js"):
			w.Header().Set("Content-Type", "application/javascript; charset=utf-8")
		case strings.HasSuffix(p, ".json"):
			w.Header().Set("Content-Type", "application/json")
		case strings.HasSuffix(p, ".svg"):
			w.Header().Set("Content-Type", "image/svg+xml")
		case strings.HasSuffix(p, ".png"):
			w.Header().Set("Content-Type", "image/png")
		}
		w.Write(data)
	})
}

// Someone hits POST /api/agents/restart?uid=test-instance-12
func (srv *server) handleRestartAgentAPI(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed. Try POST.", http.StatusMethodNotAllowed)
		return
	}

	targetAgentUID := r.URL.Query().Get("uid")
	if targetAgentUID == "" {
		http.Error(w, "Missing 'uid' query parameter", http.StatusBadRequest)
		return
	}

	// 1. Look up the connection
	srv.connMutex.RLock()
	targetConn, exists := srv.activeConnections[targetAgentUID]
	srv.connMutex.RUnlock()

	if !exists {
		http.Error(w, fmt.Sprintf("Agent [%s] is currently offline", targetAgentUID), http.StatusNotFound)
		return
	}

	// 2. Transmit the command
	// InstanceUid must mirror the agent's own UID — the opamp-go library
	// requires this field to be set on every ServerToAgent message.
	uidBytes, err := hexToBytes(targetAgentUID)
	if err != nil {
		http.Error(w, "Invalid agent UID format: "+err.Error(), http.StatusBadRequest)
		return
	}
	commandMsg := &protobufs.ServerToAgent{
		InstanceUid: uidBytes,
		Command: &protobufs.ServerToAgentCommand{
			Type: protobufs.CommandType_CommandType_Restart,
		},
	}

	err = targetConn.Send(r.Context(), commandMsg)
	if err != nil {
		http.Error(w, "Failed to send command to agent: "+err.Error(), http.StatusInternalServerError)
		return
	}

	// Wait briefly to see if the agent reports an error
	time.Sleep(2 * time.Second)
	agent, err := srv.store.GetAgent(targetAgentUID)
	if err == nil && agent.HasError {
		http.Error(w, "Agent failed to restart: "+agent.LastError, http.StatusInternalServerError)
		return
	}

	w.Write([]byte(fmt.Sprintf("✅ Command successfully pushed to Agent %s !", targetAgentUID)))
}

// GET /api/agents
func (srv *server) handleGetAgentsAPI(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed. Try GET.", http.StatusMethodNotAllowed)
		return
	}

	agents, err := srv.store.GetAgents()
	if err != nil {
		http.Error(w, "Failed to retrieve agents: "+err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(agents)
}

// GET /api/configs?uid=...
func (srv *server) handleGetConfigsAPI(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed. Try GET.", http.StatusMethodNotAllowed)
		return
	}

	targetAgentUID := r.URL.Query().Get("uid")
	if targetAgentUID == "" {
		http.Error(w, "Missing 'uid' query parameter", http.StatusBadRequest)
		return
	}

	configs, err := srv.store.GetAgentConfigs(targetAgentUID)
	if err != nil {
		http.Error(w, "Failed to retrieve configs for agent: "+err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(configs)
}

// DELETE /api/agents/delete?uid=...
func (srv *server) handleDeleteAgentAPI(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodDelete && r.Method != http.MethodPost {
		http.Error(w, "Method not allowed.", http.StatusMethodNotAllowed)
		return
	}

	targetAgentUID := r.URL.Query().Get("uid")
	if targetAgentUID == "" {
		http.Error(w, "Missing 'uid' query parameter", http.StatusBadRequest)
		return
	}

	err := srv.store.DeleteAgent(targetAgentUID)
	if err != nil {
		http.Error(w, "Failed to delete agent: "+err.Error(), http.StatusInternalServerError)
		return
	}

	w.Write([]byte(fmt.Sprintf("✅ successfully deleted Agent %s", targetAgentUID)))
}

// POST /api/agents/offline?uid=...
func (srv *server) handleMarkOfflineAPI(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed. Try POST.", http.StatusMethodNotAllowed)
		return
	}

	targetAgentUID := r.URL.Query().Get("uid")
	if targetAgentUID == "" {
		http.Error(w, "Missing 'uid' query parameter", http.StatusBadRequest)
		return
	}

	agent, err := srv.store.GetAgent(targetAgentUID)
	if err != nil {
		http.Error(w, "Failed to retrieve agent: "+err.Error(), http.StatusNotFound)
		return
	}

	agent.Status = "offline"
	srv.store.SaveAgent(agent)

	srv.connMutex.Lock()
	delete(srv.activeConnections, targetAgentUID)
	srv.connMutex.Unlock()

	w.Write([]byte(fmt.Sprintf("✅ successfully marked Agent %s offline", targetAgentUID)))
}

// POST /api/agents/config/push?uid=... body: YAML text
//
// Pushes a single YAML config to one agent. The opamp extension is always
// protected: if the user included extensions.opamp in their YAML it is
// silently overwritten by the server's managed block via mergeWithOpAMP.
func (srv *server) handlePushConfigAPI(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed. Try POST.", http.StatusMethodNotAllowed)
		return
	}

	targetAgentUID := r.URL.Query().Get("uid")
	if targetAgentUID == "" {
		http.Error(w, "Missing 'uid' query parameter", http.StatusBadRequest)
		return
	}

	srv.logger.Debugf(context.Background(), "Config push requested for agent: %s", targetAgentUID)

	// Read YAML body
	raw, err := io.ReadAll(r.Body)
	if err != nil || len(raw) == 0 {
		http.Error(w, "Empty or unreadable config body", http.StatusBadRequest)
		return
	}

	// Always merge to protect the opamp extension.
	// If the user's YAML contains extensions.opamp it will be overwritten;
	// all other extensions (health_check, pprof, etc.) are preserved.
	body, err := mergeWithOpAMP(raw)
	if err != nil {
		http.Error(w, "Invalid YAML: "+err.Error(), http.StatusBadRequest)
		return
	}

	// Look up live connection
	srv.connMutex.RLock()
	targetConn, exists := srv.activeConnections[targetAgentUID]
	srv.connMutex.RUnlock()

	if !exists {
		http.Error(w, fmt.Sprintf("Agent [%s] is currently offline — cannot push config", targetAgentUID), http.StatusNotFound)
		return
	}

	// Build RemoteConfig message with sha256 hash for proper change detection
	remoteConfigMsg := &protobufs.ServerToAgent{
		RemoteConfig: &protobufs.AgentRemoteConfig{
			Config: &protobufs.AgentConfigMap{
				ConfigMap: map[string]*protobufs.AgentConfigFile{
					"": {
						Body:        body,
						ContentType: "text/yaml",
					},
				},
			},
			ConfigHash: configHash(body),
		},
	}

	if err = targetConn.Send(r.Context(), remoteConfigMsg); err != nil {
		http.Error(w, "Failed to push config to agent: "+err.Error(), http.StatusInternalServerError)
		return
	}

	w.Write([]byte(fmt.Sprintf("✅ Config pushed to Agent %s", targetAgentUID)))
}

// hexToBytes converts a hex-encoded agent UID string (as stored in activeConnections)
// back to raw bytes for use in ServerToAgent.InstanceUid.
func hexToBytes(hexStr string) ([]byte, error) {
	return hex.DecodeString(hexStr)
}

// POST /api/agents/rename?uid=...&name=...
func (srv *server) handleRenameAgentAPI(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	targetAgentUID := r.URL.Query().Get("uid")
	newName := r.URL.Query().Get("name")
	if targetAgentUID == "" {
		http.Error(w, "Missing 'uid' query parameter", http.StatusBadRequest)
		return
	}

	agent, err := srv.store.GetAgent(targetAgentUID)
	if err != nil {
		http.Error(w, "Agent not found", http.StatusNotFound)
		return
	}

	agent.CustomName = newName
	if err := srv.store.SaveAgent(agent); err != nil {
		http.Error(w, "Failed to save agent name", http.StatusInternalServerError)
		return
	}

	w.Write([]byte(fmt.Sprintf("✅ Successfully renamed agent to %s", newName)))
}
