<div align="center">

<h1>🛸 OpenFleet</h1>
<p><strong>Open-source OpAMP control plane for OpenTelemetry Collectors</strong></p>

[![Go](https://img.shields.io/badge/Go-1.21+-00ADD8?style=flat&logo=go)](https://go.dev/)
[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](LICENSE)
[![OpAMP](https://img.shields.io/badge/Protocol-OpAMP-orange)](https://github.com/open-telemetry/opamp-spec)
[![Status](https://img.shields.io/badge/Status-Alpha-yellow)]()

</div>

---

OpenFleet is a lightweight, self-hosted management server for [OpenTelemetry Collectors](https://opentelemetry.io/docs/collector/). It implements the [OpAMP (Open Agent Management Protocol)](https://github.com/open-telemetry/opamp-spec) to let you remotely deploy, configure, and monitor your entire fleet of collectors from a single UI — no cloud dependency required.

---

## ✨ Features

| Feature | Description |
|---|---|
| **OpAMP Server** | Full WebSocket-based OpAMP control plane |
| **Remote Config Push** | Push YAML configs to one or many agents instantly |
| **Multi-Template Push** | Send multiple YAML templates per agent — each occupies a named config slot, the collector merges them |
| **Protected OpAMP Extension** | The `extensions.opamp` block is always server-managed. User templates can freely add other extensions (health_check, pprof, etc.) without losing the agent's connection |
| **Fleet Dashboard** | Live view of all connected agents with health, OS, version |
| **Config Templates** | Store reusable YAML templates in the database with named config keys |
| **Wizard Presets** | Save & reload full supervisor install configurations |
| **Agent Actions** | Restart, mark offline, delete agents via OpAMP commands |
| **Install Script Generator** | One-liner bash scripts to install the OpAMP supervisor on any Linux host |
| **Export** | Download the full agent registry as JSON or CSV |
| **SQLite Storage** | Zero-dependency embedded database — just run the binary |

---

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                        OpenFleet Server                     │
│                                                             │
│  ┌──────────────┐   ┌────────────────┐   ┌──────────────┐  │
│  │  Web UI      │   │  REST API      │   │  OpAMP WS    │  │
│  │  (Static)    │   │  /api/*        │   │  /v1/opamp   │  │
│  └──────────────┘   └────────────────┘   └──────┬───────┘  │
│                             │                    │          │
│                      ┌──────▼──────────────┐     │          │
│                      │   SQLite Storage    │     │          │
│                      │  (agents, configs,  │     │          │
│                      │   templates)        │     │          │
│                      └─────────────────────┘     │          │
└────────────────────────────────────────┬─────────┘          
                                         │ OpAMP / WebSocket
                 ┌───────────────────────┼───────────────────┐
                 ▼                       ▼                   ▼
        ┌────────────────┐    ┌─────────────────┐   ┌──────────────┐
        │ OTel Collector │    │ OTel Collector  │   │ OTel Collect │
        │ + Supervisor   │    │ + Supervisor    │   │ + Supervisor │
        └────────────────┘    └─────────────────┘   └──────────────┘
```

---

## 🚀 Quick Start

### Prerequisites

- Go 1.21+
- An [OpAMP Supervisor](https://github.com/open-telemetry/opentelemetry-collector-contrib/tree/main/cmd/opampsupervisor) + OTel Collector binary on your target hosts

### 1. Clone & Run

```bash
git clone https://github.com/openfleetproject/openfleet.git
cd openfleet
go run main.go
```

The server starts on **`http://localhost:8080`** by default.

### 2. Configure

Edit `config.yaml` to change the listen address or port:

```yaml
opamp:
  host: "0.0.0.0"
  port: 8080

web:
  host: "0.0.0.0"
  port: 8080
```

### 3. Connect an Agent

Point your OpAMP Supervisor config at your OpenFleet server:

```yaml
# supervisor.yaml
server:
  endpoint: ws://YOUR_SERVER_IP:8080/v1/opamp
  tls:
    insecure: true
```

The agent will appear in the dashboard within seconds of starting.

### 4. Build Binary

```bash
go build -o bin/openfleet .
./bin/openfleet --config config.yaml
```

---

## 📐 Config Templates & Multi-Template Push

OpenFleet uses the OpAMP `ConfigMap` to send one or more YAML files to an agent. Each template has a **Config Key** that determines its slot:

| Config Key | Purpose |
|---|---|
| `""` (empty) | **Primary** collector config — receivers, processors, exporters, service pipelines |
| `"security"` | Auth extensions, TLS settings |
| `"pipeline"` | Additional pipeline overlays |
| `"<anything>"` | Merged with other keys by the collector |

### OpAMP Extension Protection

The `extensions.opamp` block is **always managed by the server** and injected into every config push. This means:

- ✅ You can add any extensions (`health_check`, `pprof`, `zpages`…) in your templates
- ✅ The `opamp` extension is automatically kept — even if you forget it or accidentally include a wrong endpoint
- ⚠️ A warning banner appears in the editor if your YAML contains `extensions.opamp:`

### Example: Push Two Templates at Once

```
Template A (config_key="")          Template B (config_key="security")
─────────────────────────────       ─────────────────────────────────────
receivers:                          extensions:
  otlp:                               health_check:
    protocols:                          endpoint: 0.0.0.0:13133
      grpc:                           pprof: {}
        endpoint: 0.0.0.0:4317      service:
exporters:                            extensions: [health_check, pprof]
  debug: {}
service:
  pipelines:
    traces:
      receivers: [otlp]
      exporters: [debug]
```

The agent receives both files. The collector merges them. The result includes `health_check`, `pprof`, AND `opamp` (always injected by OpenFleet).

---

## 📁 Project Structure

```
openfleet/
├── main.go                  # Entry point
├── config.yaml              # Server configuration
├── cmd/
│   └── root.go              # Cobra CLI root command
├── config/
│   ├── config.go            # Config struct
│   ├── loader.go            # Viper-based YAML loader
│   ├── opamp_server.go      # OpAMP server config
│   └── web_server.go        # HTTP server config
├── models/
│   ├── agent.go             # Agent model
│   ├── config.go            # AgentConfig model
│   ├── config_template.go   # ConfigTemplate model (with ConfigKey)
│   └── wizard_preset.go     # WizardPreset model
├── server/
│   ├── server.go            # Server struct & constructor
│   ├── http_server.go       # HTTP server lifecycle
│   ├── routes.go            # Route registration + single-agent push
│   ├── opamp_handler.go     # OpAMP message handler (onMessage, onDisconnect)
│   ├── configs_handler.go   # Templates CRUD + bulk-push + mergeWithOpAMP
│   ├── wizard_presets_handler.go  # Wizard preset CRUD
│   └── script_handler.go    # Install/uninstall script generator
├── storage/
│   └── storage.go           # SQLite storage via GORM
├── utils/
│   └── logger.go            # Logger wrapper
└── ui/
    ├── index.html           # Single-page application shell
    ├── css/
    │   └── style.css        # Full design system
    └── js/
        ├── app.js           # Main app bootstrap, navigation
        ├── configs.js       # Templates, bulk-push, wizard presets
        ├── modal.js         # Add Agent wizard modal
        ├── panel.js         # Agent detail side panel
        └── settings.js      # Settings page
```

---

## 🔌 API Reference

### Agents

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/agents` | List all agents |
| `POST` | `/api/agents/restart?uid=<uid>` | Send restart command |
| `DELETE` | `/api/agents/delete?uid=<uid>` | Delete agent |
| `POST` | `/api/agents/offline?uid=<uid>` | Mark agent offline |
| `DELETE` | `/api/agents/cleanup` | Remove all offline agents |
| `POST` | `/api/agents/rename?uid=<uid>&name=<n>` | Rename agent |

### Config Push

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/api/agents/config/push?uid=<uid>` | Push YAML to one agent (body = YAML text) |
| `POST` | `/api/agents/config/bulk-push` | Push multiple templates to multiple agents |

**Bulk push body:**
```json
{
  "template_ids": [1, 2, 3],
  "uids": ["agent-uid-1", "agent-uid-2"]
}
```

### Templates

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/templates` | List all templates |
| `POST` | `/api/templates/save` | Create or update template |
| `DELETE` | `/api/templates/delete?id=<id>` | Delete template |

**Template body:**
```json
{
  "name": "My Pipeline",
  "description": "Production traces pipeline",
  "config_key": "",
  "yaml": "receivers:\n  otlp: ..."
}
```

### Wizard Presets

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/wizard-presets` | List all presets |
| `POST` | `/api/wizard-presets/save` | Create or update preset |
| `POST` | `/api/wizard-presets/rename` | Rename preset |
| `DELETE` | `/api/wizard-presets/delete?id=<id>` | Delete preset |

### Server Info & Export

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/server/info` | Server version, uptime, agent counts |
| `GET` | `/api/export/agents?format=json\|csv` | Export agent registry |

---

## 🤝 Contributing

We welcome contributions! Please read [CONTRIBUTING.md](CONTRIBUTING.md) before opening a PR.

---

## 📄 License

Apache License 2.0 — see [LICENSE](LICENSE) for details.

---

<div align="center">
  <sub>Built with ❤️ using <a href="https://go.dev/">Go</a>, <a href="https://github.com/open-telemetry/opamp-go">opamp-go</a>, and <a href="https://gorm.io/">GORM</a></sub>
</div>
