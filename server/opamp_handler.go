package server

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"

	"time"

	"github.com/open-telemetry/opamp-go/protobufs"
	opampserver "github.com/open-telemetry/opamp-go/server"
	"github.com/open-telemetry/opamp-go/server/types"
	"github.com/openfleetproject/openfleet/models"
)

func (srv *server) onDisconnect(conn types.Connection) {
	srv.connMutex.Lock()
	defer srv.connMutex.Unlock()
	for k, v := range srv.activeConnections {
		if v == conn {
			delete(srv.activeConnections, k)

			// Mark agent as offline
			agent, err := srv.store.GetAgent(k)
			if err == nil {
				agent.Status = "offline"
				srv.store.SaveAgent(agent)
			}
			break
		}
	}
	srv.logger.Debugf(context.Background(), "Agent disconnected")
}

func (srv *server) onMessage(
	ctx context.Context,
	conn types.Connection,
	msg *protobufs.AgentToServer,
) *protobufs.ServerToAgent {

	uidStr := fmt.Sprintf("%x", msg.InstanceUid)

	// Save or update the connection mapping!
	srv.connMutex.Lock()
	srv.activeConnections[uidStr] = conn
	srv.connMutex.Unlock()

	// 1. Retrieve or Create Agent — track if this is a brand new/deleted agent
	agent, err := srv.store.GetAgent(uidStr)
	isNewAgent := err != nil
	if isNewAgent {
		agent = &models.Agent{ID: uidStr}
	}

	agent.Status = "online"
	agent.LastConnected = time.Now()

	// 2. Extract properties from AgentDescription (sent on first connect and when changed)
	if desc := msg.GetAgentDescription(); desc != nil {
		allAttrs := make(map[string]string)

		// Helper to scan a flat attribute list for known keys and collect all
		extractAttrs := func(attrs []*protobufs.KeyValue) {
			for _, attr := range attrs {
				k := attr.GetKey()
				v := attr.GetValue().GetStringValue()
				if v == "" {
					continue
				}
				allAttrs[k] = v

				switch k {
				case "service.name":
					agent.Hostname = v
				case "service.version":
					agent.Version = v
				case "os.type", "os.description":
					// prefer os.type; only overwrite with os.description if os.type not yet set
					if agent.OS == "" || k == "os.type" {
						agent.OS = v
					}
				case "host.name":
					// Use host.name as hostname if service.name is not present
					if agent.Hostname == "" {
						agent.Hostname = v
					}
				}
			}
		}
		extractAttrs(desc.GetIdentifyingAttributes())
		extractAttrs(desc.GetNonIdentifyingAttributes())

		// Serialize all attributes into the Metadata field
		if b, err := json.Marshal(allAttrs); err == nil {
			agent.Metadata = string(b)
		}
	}

	// 3. Extract and save the effective configuration
	if configMap := msg.GetEffectiveConfig().GetConfigMap().GetConfigMap(); configMap != nil {
		for name, file := range configMap {
			if file == nil {
				continue
			}
			agentConfig := &models.AgentConfig{
				ID:         fmt.Sprintf("%s-%s", uidStr, name),
				AgentID:    uidStr,
				Name:       name,
				ConfigYAML: string(file.GetBody()),
				UpdatedAt:  time.Now(),
			}
			srv.store.SaveAgentConfig(agentConfig)
		}
	}

	srv.store.SaveAgent(agent)

	// 4. Log remote config acknowledgment from the agent
	if status := msg.GetRemoteConfigStatus(); status != nil {
		switch status.GetStatus() {
		case protobufs.RemoteConfigStatuses_RemoteConfigStatuses_APPLIED:
			srv.logger.Debugf(ctx, "✅ Agent %s successfully applied remote config (hash: %x)", uidStr, status.GetLastRemoteConfigHash())
		case protobufs.RemoteConfigStatuses_RemoteConfigStatuses_APPLYING:
			srv.logger.Debugf(ctx, "⏳ Agent %s is applying remote config...", uidStr)
		case protobufs.RemoteConfigStatuses_RemoteConfigStatuses_FAILED:
			srv.logger.Debugf(ctx, "❌ Agent %s FAILED to apply remote config: %s", uidStr, status.GetErrorMessage())
		}
	}

	// 5. Parse health to track restart failures or errors
	if health := msg.GetHealth(); health != nil {
		agent.HasError = !health.GetHealthy()
		agent.LastError = health.GetLastError()
	}

	srv.logger.Debugf(ctx, "Received message from Agent: %x", msg.InstanceUid)

	// If this agent was brand new (deleted or first time), ask it to resend full state
	// so we immediately get AgentDescription + EffectiveConfig without waiting for
	// the next scheduled heartbeat.
	resp := &protobufs.ServerToAgent{
		InstanceUid: msg.InstanceUid,
	}
	if isNewAgent {
		resp.Flags = uint64(protobufs.ServerToAgentFlags_ServerToAgentFlags_ReportFullState)
	}
	return resp
}

// builds opamp settings
func (srv *server) opampSettings() opampserver.Settings {
	return opampserver.Settings{
		Callbacks: types.Callbacks{
			OnConnecting: func(r *http.Request) types.ConnectionResponse {
				return types.ConnectionResponse{
					Accept: true,
					ConnectionCallbacks: types.ConnectionCallbacks{
						OnMessage:         srv.onMessage,
						OnConnectionClose: srv.onDisconnect,
					},
				}
			},
		},
	}
}
