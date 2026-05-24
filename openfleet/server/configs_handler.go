package server

import (
	"context"
	"crypto/sha256"
	"encoding/csv"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"runtime"
	"strconv"
	"time"

	"github.com/open-telemetry/opamp-go/protobufs"
	"github.com/openfleetproject/openfleet/models"
	"gopkg.in/yaml.v3"
)

// ── GET /api/templates ────────────────────────────────────────────────────────
func (srv *server) handleGetTemplatesAPI(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	templates, err := srv.store.GetTemplates()
	if err != nil {
		http.Error(w, "Failed to get templates: "+err.Error(), http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(templates)
}

// ── POST /api/templates  body: JSON {name, description, config_key, yaml} ────
// ── PUT  /api/templates?id=N ─────────────────────────────────────────────────
func (srv *server) handleSaveTemplateAPI(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost && r.Method != http.MethodPut {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	body, err := io.ReadAll(r.Body)
	if err != nil || len(body) == 0 {
		http.Error(w, "Empty body", http.StatusBadRequest)
		return
	}
	var t models.ConfigTemplate
	if err := json.Unmarshal(body, &t); err != nil {
		http.Error(w, "Invalid JSON: "+err.Error(), http.StatusBadRequest)
		return
	}
	if t.Name == "" {
		http.Error(w, "Template name is required", http.StatusBadRequest)
		return
	}
	t.UpdatedAt = time.Now()
	if err := srv.store.SaveTemplate(&t); err != nil {
		http.Error(w, "Failed to save template: "+err.Error(), http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(t)
}

// ── DELETE /api/templates?id=N ────────────────────────────────────────────────
func (srv *server) handleDeleteTemplateAPI(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodDelete {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	idStr := r.URL.Query().Get("id")
	id, err := strconv.ParseUint(idStr, 10, 64)
	if err != nil || id == 0 {
		http.Error(w, "Invalid template id", http.StatusBadRequest)
		return
	}
	if err := srv.store.DeleteTemplate(uint(id)); err != nil {
		http.Error(w, "Failed to delete: "+err.Error(), http.StatusInternalServerError)
		return
	}
	w.Write([]byte("✅ Template deleted"))
}

// ── mergeWithOpAMP ────────────────────────────────────────────────────────────
//
// mergeWithOpAMP takes a user-provided collector YAML and returns a new YAML
// where the opamp extension is ALWAYS server-controlled.
//
// Rules:
//  1. User may freely add any extensions (health_check, pprof, zpages…)
//  2. extensions.opamp is ALWAYS overwritten with an empty map {}
//     (the supervisor injects its own opamp block at runtime)
//  3. service.extensions always contains "opamp"
//  4. Everything else (receivers, processors, exporters, pipelines) is preserved
func mergeWithOpAMP(userYAML []byte) ([]byte, error) {
	// Parse the user YAML into a generic map
	var cfg map[string]interface{}
	if err := yaml.Unmarshal(userYAML, &cfg); err != nil {
		return nil, fmt.Errorf("invalid YAML: %w", err)
	}
	if cfg == nil {
		cfg = make(map[string]interface{})
	}

	// ── 1. Protect extensions.opamp ──────────────────────────────────────────
	// Get or create the extensions block
	extRaw, ok := cfg["extensions"]
	var extensions map[string]interface{}
	if ok {
		extensions, _ = extRaw.(map[string]interface{})
	}
	if extensions == nil {
		extensions = make(map[string]interface{})
	}
	// Always overwrite opamp with an empty map so the supervisor owns it.
	// The supervisor merges its own opamp config at startup.
	extensions["opamp"] = map[string]interface{}{}
	cfg["extensions"] = extensions

	// ── 2. Ensure service.extensions includes "opamp" ─────────────────────────
	svcRaw, _ := cfg["service"]
	svc, _ := svcRaw.(map[string]interface{})
	if svc == nil {
		svc = make(map[string]interface{})
	}

	extList := []string{}
	if raw, ok := svc["extensions"]; ok {
		switch v := raw.(type) {
		case []interface{}:
			for _, item := range v {
				if s, ok := item.(string); ok {
					extList = append(extList, s)
				}
			}
		case []string:
			extList = v
		}
	}

	// Add "opamp" if not already present
	hasOpamp := false
	for _, e := range extList {
		if e == "opamp" {
			hasOpamp = true
			break
		}
	}
	if !hasOpamp {
		extList = append([]string{"opamp"}, extList...)
	}
	svc["extensions"] = extList
	cfg["service"] = svc

	// ── 3. Re-marshal ─────────────────────────────────────────────────────────
	return yaml.Marshal(cfg)
}

// configHash computes a sha256 hash of the config bytes for change detection.
func configHash(data []byte) []byte {
	h := sha256.Sum256(data)
	return h[:]
}

// ── POST /api/agents/config/bulk-push ─────────────────────────────────────────
//
// Request body: JSON
//
//	{
//	  "template_ids": [1, 2, 3],   // one or more templates
//	  "uids":         ["uid1", "uid2"]
//	}
//
// Each template maps to a ConfigMap key determined by its ConfigKey field.
// The empty-key ("") template is the primary collector config and gets
// mergeWithOpAMP applied so the opamp extension is always protected.
// Other keys are sent as-is (they are auxiliary configs like security, pipeline).
func (srv *server) handleBulkPushConfigAPI(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	var req struct {
		TemplateIDs []uint   `json:"template_ids"`
		UIDs        []string `json:"uids"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || len(req.UIDs) == 0 || len(req.TemplateIDs) == 0 {
		http.Error(w, "Invalid request body — need template_ids[] and uids[]", http.StatusBadRequest)
		return
	}

	// ── Build the ConfigMap from all requested templates ─────────────────────
	configMap := make(map[string]*protobufs.AgentConfigFile)
	hashInput := []byte{}

	for _, tid := range req.TemplateIDs {
		t, err := srv.store.GetTemplate(tid)
		if err != nil {
			http.Error(w, fmt.Sprintf("Template %d not found", tid), http.StatusNotFound)
			return
		}

		rawYAML := []byte(t.YAML)

		// For the primary config slot (""), always merge/protect the opamp ext.
		// For named slots (security, pipeline, etc.), send as-is — the user
		// is responsible for their own extension names in those files.
		if t.ConfigKey == "" {
			merged, err := mergeWithOpAMP(rawYAML)
			if err != nil {
				http.Error(w, fmt.Sprintf("Template %d has invalid YAML: %s", tid, err), http.StatusBadRequest)
				return
			}
			rawYAML = merged
		}

		key := t.ConfigKey // "" maps to the main config slot in OTel collector
		configMap[key] = &protobufs.AgentConfigFile{
			Body:        rawYAML,
			ContentType: "text/yaml",
		}
		hashInput = append(hashInput, rawYAML...)
	}

	remoteConfigMsg := &protobufs.ServerToAgent{
		RemoteConfig: &protobufs.AgentRemoteConfig{
			Config: &protobufs.AgentConfigMap{
				ConfigMap: configMap,
			},
			ConfigHash: configHash(hashInput),
		},
	}

	// ── Push to every selected agent ─────────────────────────────────────────
	type result struct {
		UID     string `json:"uid"`
		Success bool   `json:"success"`
		Message string `json:"message"`
	}
	var results []result

	for _, uid := range req.UIDs {
		srv.connMutex.RLock()
		conn, ok := srv.activeConnections[uid]
		srv.connMutex.RUnlock()
		if !ok {
			results = append(results, result{UID: uid, Success: false, Message: "offline"})
			continue
		}
		if err := conn.Send(context.Background(), remoteConfigMsg); err != nil {
			results = append(results, result{UID: uid, Success: false, Message: err.Error()})
		} else {
			results = append(results, result{UID: uid, Success: true, Message: fmt.Sprintf("pushed %d template(s)", len(req.TemplateIDs))})
		}
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(results)
}

// ── DELETE /api/agents/cleanup — remove all offline agents ────────────────────
func (srv *server) handleCleanupOfflineAPI(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodDelete && r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	n, err := srv.store.DeleteOfflineAgents()
	if err != nil {
		http.Error(w, "Cleanup failed: "+err.Error(), http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]int64{"deleted": n})
}

// ── GET /api/server/info ──────────────────────────────────────────────────────
var serverStartTime = time.Now()

func (srv *server) handleServerInfoAPI(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	agents, _ := srv.store.GetAgents()
	online := 0
	for _, a := range agents {
		if a.Status == "online" {
			online++
		}
	}
	srv.connMutex.RLock()
	activeConns := len(srv.activeConnections)
	srv.connMutex.RUnlock()

	info := map[string]interface{}{
		"version":            "0.1.0",
		"go_version":         runtime.Version(),
		"uptime":             time.Since(serverStartTime).Round(time.Second).String(),
		"total_agents":       len(agents),
		"online_agents":      online,
		"active_connections": activeConns,
		"started_at":         serverStartTime.Format(time.RFC3339),
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(info)
}

// ── GET /api/export/agents?format=json|csv ────────────────────────────────────
func (srv *server) handleExportAgentsAPI(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	agents, err := srv.store.GetAgents()
	if err != nil {
		http.Error(w, "Failed to get agents: "+err.Error(), http.StatusInternalServerError)
		return
	}
	format := r.URL.Query().Get("format")
	if format == "csv" {
		w.Header().Set("Content-Type", "text/csv")
		w.Header().Set("Content-Disposition", `attachment; filename="openfleet-agents.csv"`)
		wr := csv.NewWriter(w)
		wr.Write([]string{"uid", "hostname", "os", "version", "status", "last_connected"})
		for _, a := range agents {
			wr.Write([]string{a.ID, a.Hostname, a.OS, a.Version, a.Status, a.LastConnected.Format(time.RFC3339)})
		}
		wr.Flush()
		return
	}
	// Default: JSON
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Content-Disposition", `attachment; filename="openfleet-agents.json"`)
	json.NewEncoder(w).Encode(agents)
}
