package server

import (
	"encoding/json"
	"io"
	"net/http"
	"strconv"
	"time"

	"github.com/openfleetproject/openfleet/models"
)

// ── GET /api/wizard-presets ───────────────────────────────────────────────────
func (srv *server) handleGetWizardPresetsAPI(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	presets, err := srv.store.GetWizardPresets()
	if err != nil {
		http.Error(w, "Failed to load wizard presets: "+err.Error(), http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(presets)
}

// ── POST /api/wizard-presets/save  body: {id, name, data} ────────────────────
func (srv *server) handleSaveWizardPresetAPI(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	body, err := io.ReadAll(r.Body)
	if err != nil || len(body) == 0 {
		http.Error(w, "Empty body", http.StatusBadRequest)
		return
	}
	var p models.WizardPreset
	if err := json.Unmarshal(body, &p); err != nil {
		http.Error(w, "Invalid JSON: "+err.Error(), http.StatusBadRequest)
		return
	}
	if p.Name == "" {
		http.Error(w, "Preset name is required", http.StatusBadRequest)
		return
	}
	now := time.Now()
	if p.ID == 0 {
		p.SavedAt = now
	}
	p.UpdatedAt = now
	if err := srv.store.SaveWizardPreset(&p); err != nil {
		http.Error(w, "Failed to save preset: "+err.Error(), http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(p)
}

// ── POST /api/wizard-presets/rename  body: {id, name} ────────────────────────
func (srv *server) handleRenameWizardPresetAPI(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	var req struct {
		ID   uint   `json:"id"`
		Name string `json:"name"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.ID == 0 || req.Name == "" {
		http.Error(w, "Invalid request body: id and name required", http.StatusBadRequest)
		return
	}
	if err := srv.store.RenameWizardPreset(req.ID, req.Name); err != nil {
		http.Error(w, "Failed to rename: "+err.Error(), http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{"ok": true, "id": req.ID, "name": req.Name})
}

// ── DELETE /api/wizard-presets/delete?id=N ───────────────────────────────────
func (srv *server) handleDeleteWizardPresetAPI(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodDelete && r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	idStr := r.URL.Query().Get("id")
	id, err := strconv.ParseUint(idStr, 10, 64)
	if err != nil || id == 0 {
		http.Error(w, "Invalid preset id", http.StatusBadRequest)
		return
	}
	if err := srv.store.DeleteWizardPreset(uint(id)); err != nil {
		http.Error(w, "Failed to delete: "+err.Error(), http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]bool{"ok": true})
}
