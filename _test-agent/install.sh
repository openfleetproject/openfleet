#!/bin/bash
# ─────────────────────────────────────────────────────────────────────────────
#  OpenFleet — OpAMP Agent Install Script
#  Usage:
#    sudo bash install.sh                  # install with defaults
#    sudo bash install.sh --uninstall      # remove the agent
#
#  Override any value with environment variables:
#    OPAMP_ENDPOINT=wss://myserver:8080/v1/opamp sudo bash install.sh
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

# ── Configuration ─────────────────────────────────────────────────────────────
OPAMP_ENDPOINT="${OPAMP_ENDPOINT:-wss://your-openfleet-server:8080/v1/opamp}"
OTEL_VERSION="${OTEL_VERSION:-0.96.0}"
SUPERVISOR_VERSION="${SUPERVISOR_VERSION:-0.96.0}"
AGENT_LABEL="${AGENT_LABEL:-}"

INSTALL_DIR="/opt/otelcol"
BIN_DIR="$INSTALL_DIR/bin"
CONF_DIR="/etc/otel-supervisor"
STORAGE_DIR="/var/lib/otelcol/supervisor"
OTEL_USER="otelcol"
SERVICE_NAME="otel-supervisor"

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'; NC='\033[0m'
info()    { echo -e "${GREEN}[✓]${NC} $*"; }
warn()    { echo -e "${YELLOW}[!]${NC} $*"; }
err()     { echo -e "${RED}[✗]${NC} $*"; exit 1; }
section() { echo -e "\n${BLUE}━━━ $* ━━━${NC}"; }

# ── Uninstall mode ────────────────────────────────────────────────────────────
if [[ "${1:-}" == "--uninstall" ]]; then
    section "Uninstalling OpenFleet Agent"
    systemctl stop    "$SERVICE_NAME" 2>/dev/null && info "Service stopped."   || warn "Service was not running."
    systemctl disable "$SERVICE_NAME" 2>/dev/null || true
    rm -f /etc/systemd/system/${SERVICE_NAME}.service
    systemctl daemon-reload
    rm -rf "$INSTALL_DIR" "$CONF_DIR" "$STORAGE_DIR"
    info "Binaries and configs removed."
    userdel -r "$OTEL_USER" 2>/dev/null && info "User '$OTEL_USER' removed." || warn "User not found — skipping."
    info "Uninstall complete."
    exit 0
fi

# ── Root check ────────────────────────────────────────────────────────────────
[[ "$EUID" -ne 0 ]] && err "Please run as root (use sudo)."

section "OpenFleet Agent Installation"
info "Endpoint  : $OPAMP_ENDPOINT"
info "OTel v    : $OTEL_VERSION"
info "Label     : ${AGENT_LABEL:-<none>}"

# ── 1. Connectivity pre-check ─────────────────────────────────────────────────
section "Connectivity Check"
PING_URL=$(echo "$OPAMP_ENDPOINT" | sed 's|^wss://|https://|; s|^ws://|http://|')
HTTP_CODE=$(curl --max-time 10 --silent --output /dev/null \
            --write-out "%{http_code}" "$PING_URL" || echo "000")
if [[ "$HTTP_CODE" =~ ^(200|400|404|101|426)$ ]]; then
    info "Server reachable (HTTP $HTTP_CODE) ✓"
else
    warn "Server returned HTTP $HTTP_CODE — continuing (WebSocket-only servers may show this)."
fi

# ── 2. Dependencies ───────────────────────────────────────────────────────────
section "Dependencies"
PKGS="curl tar gzip"
if   command -v apt-get &>/dev/null; then apt-get update -qq && apt-get install -y -qq $PKGS
elif command -v dnf     &>/dev/null; then dnf  install -y $PKGS
elif command -v yum     &>/dev/null; then yum  install -y $PKGS
elif command -v pacman  &>/dev/null; then pacman -Sy --noconfirm --needed $PKGS
elif command -v zypper  &>/dev/null; then zypper install -y $PKGS
else err "Unsupported package manager. Please install curl and tar manually."; fi
info "Dependencies OK"

# ── 3. User & directories ─────────────────────────────────────────────────────
section "Environment Setup"
id -u "$OTEL_USER" &>/dev/null || useradd -r -m -s /bin/false "$OTEL_USER"
mkdir -p "$BIN_DIR" "$CONF_DIR" "$STORAGE_DIR"
chown -R "$OTEL_USER:$OTEL_USER" "$INSTALL_DIR" "$STORAGE_DIR"
info "User '$OTEL_USER' and directories ready"

# ── 4. OTel Contrib Collector ─────────────────────────────────────────────────
section "OTel Contrib Collector v${OTEL_VERSION}"
if [[ -f "$BIN_DIR/otelcol-contrib" ]]; then
    warn "Already installed at $BIN_DIR/otelcol-contrib — skipping download."
else
    ARCH=$(uname -m)
    case $ARCH in
        x86_64)  ARCH="amd64" ;;
        aarch64) ARCH="arm64" ;;
        armv7l)  ARCH="arm"   ;;
        *)       err "Unsupported architecture: $ARCH" ;;
    esac
    URL="https://github.com/open-telemetry/opentelemetry-collector-releases/releases/download/v${OTEL_VERSION}/otelcol-contrib_${OTEL_VERSION}_linux_${ARCH}.tar.gz"
    info "Downloading from: $URL"
    curl -fsSL "$URL" -o /tmp/otelcol.tar.gz
    tar -xzf /tmp/otelcol.tar.gz -C "$BIN_DIR" otelcol-contrib
    chmod +x "$BIN_DIR/otelcol-contrib"
    rm /tmp/otelcol.tar.gz
    info "otelcol-contrib installed ✓"
fi

# ── 5. OpAMP Supervisor ───────────────────────────────────────────────────────
section "OpAMP Supervisor"
if [[ ! -f "$BIN_DIR/opamp-supervisor" ]]; then
    warn "Supervisor binary not found — creating placeholder."
    warn "Replace $BIN_DIR/opamp-supervisor with the real binary from your OpenFleet release."
    touch "$BIN_DIR/opamp-supervisor"
    chmod +x "$BIN_DIR/opamp-supervisor"
else
    info "Supervisor binary present ✓"
fi

# ── 6. Supervisor configuration ───────────────────────────────────────────────
section "Supervisor Configuration"
cat > "$CONF_DIR/supervisor.yaml" <<'YAML'
{{SUPERVISOR_YAML}}
YAML
chown "$OTEL_USER:$OTEL_USER" "$CONF_DIR/supervisor.yaml"
info "Config written to $CONF_DIR/supervisor.yaml"

# ── 7. Systemd service ────────────────────────────────────────────────────────
section "Systemd Service"
cat > /etc/systemd/system/${SERVICE_NAME}.service <<UNIT
[Unit]
Description=OpenFleet OpAMP Supervisor
After=network.target

[Service]
Type=simple
User=${OTEL_USER}
Group=${OTEL_USER}
ExecStart=${BIN_DIR}/opamp-supervisor --config ${CONF_DIR}/supervisor.yaml
Restart=always
RestartSec=5
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable "$SERVICE_NAME"
info "Service '$SERVICE_NAME' enabled"

# ── Done ──────────────────────────────────────────────────────────────────────
echo ""
info "Installation complete!"
echo -e "  ${GREEN}Start :${NC}  systemctl start  $SERVICE_NAME"
echo -e "  ${GREEN}Status:${NC}  systemctl status $SERVICE_NAME"
echo -e "  ${GREEN}Logs  :${NC}  journalctl -u $SERVICE_NAME -f"
echo ""
echo -e "  ${YELLOW}To uninstall:${NC}  sudo bash $(basename "$0") --uninstall"
echo ""