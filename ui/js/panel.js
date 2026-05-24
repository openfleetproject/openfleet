/**
 * panel.js — Agent Detail Panel
 * Handles the side panel that opens when you click an agent card.
 */

/* ─── Open / Close ─────────────────────────── */
function openPanel(agentId) {
    activeAgentId = agentId;
    var agent = agents.find(function (a) { return a.id === agentId; });
    if (!agent) return;

    updatePanelHeader(agent);
    loadConfig(agentId);
    loadInfoTab(agent);
    loadMetadataTab(agent);

    document.getElementById('panel-overlay').classList.add('active');
    document.getElementById('detail-panel').classList.add('active');

    // Reset to config tab
    document.querySelectorAll('.tab').forEach(function (t) { t.classList.remove('active'); });
    document.querySelectorAll('.tab-content').forEach(function (c) { c.classList.remove('active'); });
    document.querySelector('.tab[data-tab="config"]').classList.add('active');
    document.getElementById('tab-config').classList.add('active');
    showStatus('', '');
}

function closePanel() {
    activeAgentId = null;
    document.getElementById('panel-overlay').classList.remove('active');
    document.getElementById('detail-panel').classList.remove('active');
}

function updatePanelHeader(agent) {
    var badgeClass = agent.status === 'online' ? 'badge-online' : 'badge-offline';
    var badge = document.getElementById('panel-badge');
    badge.className = 'agent-badge ' + badgeClass;
    badge.innerHTML = '<span class="badge-dot"></span>' + agent.status;
    
    var displayName = agent.custom_name || agent.hostname || 'Unknown Host';
    document.getElementById('panel-name').textContent = displayName;
    document.getElementById('panel-uid').textContent  = agent.id;

    // Populate the uninstall one-liner
    var host = window.location.host;
    var proto = window.location.protocol;
    
    // Check if agent OS is Windows (either directly on agent.os or in metadata)
    var isWin = false;
    if (agent.os && agent.os.toLowerCase().indexOf('windows') !== -1) {
        isWin = true;
    } else if (agent.metadata) {
        try {
            var meta = JSON.parse(agent.metadata);
            if (meta['os.type'] === 'windows' || (meta.os && meta.os.toLowerCase().indexOf('windows') !== -1)) {
                isWin = true;
            }
        } catch (e) {}
    }

    var uninstallUrl = proto + '//' + host + '/api/uninstall-script?uid=' + encodeURIComponent(agent.id);
    var cmd = '';
    if (isWin) {
        uninstallUrl += '&os=windows';
        cmd = 'Invoke-WebRequest -Uri "' + uninstallUrl + '" -OutFile "uninstall.ps1" -UseBasicParsing; powershell.exe -ExecutionPolicy Bypass -File .\\uninstall.ps1';
    } else {
        cmd = 'curl -fsSL "' + uninstallUrl + '" | sudo bash';
    }
    
    document.getElementById('panel-uninstall-oneliner').textContent = cmd;
    
    // Update the download link
    var btnUninstall = document.getElementById('btn-uninstall-script');
    if (btnUninstall) {
        // Remove old listeners by cloning
        var newBtn = btnUninstall.cloneNode(true);
        btnUninstall.parentNode.replaceChild(newBtn, btnUninstall);
        newBtn.addEventListener('click', function() {
            window.open(uninstallUrl + '&download=1', '_blank');
        });
    }
}

/* ─── Tabs ─────────────────────────── */
function initDetailPanel() {
    document.getElementById('close-panel').addEventListener('click', closePanel);
    document.getElementById('panel-overlay').addEventListener('click', closePanel);

    document.querySelectorAll('.tab').forEach(function (tab) {
        tab.addEventListener('click', function () {
            var target = this.dataset.tab;
            document.querySelectorAll('.tab').forEach(function (t) { t.classList.remove('active'); });
            document.querySelectorAll('.tab-content').forEach(function (c) { c.classList.remove('active'); });
            this.classList.add('active');
            document.getElementById('tab-' + target).classList.add('active');
        });
    });

    var btnRename = document.getElementById('btn-rename-agent');
    if (btnRename) btnRename.addEventListener('click', renameAgent);

    document.getElementById('btn-push-config').addEventListener('click', pushConfig);
    document.getElementById('btn-restart').addEventListener('click', restartAgent);
    document.getElementById('btn-mark-offline').addEventListener('click', markOffline);
    document.getElementById('btn-delete').addEventListener('click', deleteAgent);
    // document.getElementById('btn-uninstall-script').addEventListener('click', getUninstallScript); // handled dynamically now

    document.getElementById('btn-copy-panel-uninstall').addEventListener('click', function() {
        var text = document.getElementById('panel-uninstall-oneliner').textContent;
        navigator.clipboard.writeText(text).then(function() {
            var btn = document.getElementById('btn-copy-panel-uninstall');
            var original = btn.innerHTML;
            btn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#10b981" stroke-width="2"><polyline points="20 6 9 17 4 12"></polyline></svg>';
            setTimeout(function() { btn.innerHTML = original; }, 2000);
        });
    });

    // Click delegation on both agent grids
    ['overview-agents-container', 'agents-container'].forEach(function (id) {
        var el = document.getElementById(id);
        if (el) {
            el.addEventListener('click', function (e) {
                var card = e.target.closest('.agent-card');
                if (card) openPanel(card.dataset.id);
            });
        }
    });
}

/* ─── Config Tab ─────────────────────────── */
async function loadConfig(agentId) {
    var editor     = document.getElementById('config-editor');
    var filenameEl = document.getElementById('config-filename');
    editor.value   = 'Loading…';
    try {
        var res     = await fetch('/api/configs?uid=' + agentId);
        if (!res.ok) throw new Error('HTTP ' + res.status);
        var configs = await res.json();
        if (!configs || configs.length === 0) {
            editor.value = '# No configuration found for this agent.';
            return;
        }
        var cfg        = configs[0];
        filenameEl.textContent = (cfg.name && cfg.name.trim() !== '') ? cfg.name : 'main.yaml';
        editor.value   = cfg.config_yaml || '';
    } catch (err) {
        editor.value = '# Error loading config: ' + err.message;
    }
}

async function pushConfig() {
    if (!activeAgentId) return;
    var yaml = document.getElementById('config-editor').value.trim();
    if (!yaml) { showStatus('Config is empty', 'err'); return; }

    var btn = document.getElementById('btn-push-config');
    btn.disabled    = true;
    btn.textContent = 'Pushing…';
    showStatus('', '');

    try {
        var res  = await fetch('/api/agents/config/push?uid=' + activeAgentId, {
            method: 'POST',
            headers: { 'Content-Type': 'text/plain' },
            body: yaml,
        });
        var text = await res.text();
        if (!res.ok) throw new Error(text);
        showStatus('✓ Config pushed successfully', 'ok');
    } catch (err) {
        showStatus('✗ ' + err.message, 'err');
    } finally {
        btn.disabled    = false;
        btn.textContent = '↑ Push Config';
    }
}

/* ─── Info Tab ─────────────────────────── */
function loadInfoTab(agent) {
    var grid = document.getElementById('info-grid');
    var rows = [
        ['Agent ID',        agent.id],
        ['Hostname',        agent.hostname || 'Unknown'],
        ['Status',          agent.status],
        ['OS',              agent.os || 'N/A'],
        ['Version',         agent.version || 'N/A'],
        ['Last Connected',  new Date(agent.last_connected).toLocaleString()],
    ];
    grid.innerHTML = rows.map(function (r) {
        return '<div class="info-row"><div class="info-label">' + r[0] +
               '</div><div class="info-value">' + escapeHtml(String(r[1])) + '</div></div>';
    }).join('');
}

/* ─── Metadata Tab ─────────────────────────── */
function loadMetadataTab(agent) {
    var grid = document.getElementById('metadata-grid');
    if (!agent.metadata || agent.metadata.trim() === '') {
        grid.innerHTML = '<div class="cfg-empty-state"><p>No metadata available.</p></div>';
        return;
    }
    try {
        var meta = JSON.parse(agent.metadata);
        var keys = Object.keys(meta).sort();
        if (keys.length === 0) {
            grid.innerHTML = '<div class="cfg-empty-state"><p>Metadata is empty.</p></div>';
            return;
        }
        grid.innerHTML = keys.map(function(k) {
            return '<div class="info-row"><div class="info-label">' + escapeHtml(k) +
                   '</div><div class="info-value" style="word-break:break-all">' + escapeHtml(String(meta[k])) + '</div></div>';
        }).join('');
    } catch (e) {
        grid.innerHTML = '<div class="cfg-empty-state"><p style="color:var(--red)">Failed to parse metadata JSON</p></div>';
    }
}

/* ─── Actions Tab ─────────────────────────── */
async function renameAgent() {
    if (!activeAgentId) return;
    var agent = agents.find(function(a) { return a.id === activeAgentId; });
    var currentName = agent.custom_name || agent.hostname || '';
    var newName = prompt('Enter a new name for this agent:', currentName);
    if (newName === null || newName.trim() === currentName) return;
    
    try {
        var res = await fetch('/api/agents/rename?uid=' + activeAgentId + '&name=' + encodeURIComponent(newName.trim()), { method: 'POST' });
        if (!res.ok) throw new Error(await res.text());
        fetchAgents(); // refresh the list
    } catch (err) { alert('Error: ' + err.message); }
}

async function restartAgent() {
    if (!activeAgentId) return;
    if (!confirm('Send restart command to this agent?')) return;
    try {
        var res  = await fetch('/api/agents/restart?uid=' + activeAgentId, { method: 'POST' });
        var text = await res.text();
        if (!res.ok) throw new Error(text);
        alert('✓ Restart command sent!');
    } catch (err) { alert('Error: ' + err.message); }
}

async function markOffline() {
    if (!activeAgentId) return;
    if (!confirm('Mark this agent as offline?')) return;
    try {
        var res = await fetch('/api/agents/offline?uid=' + activeAgentId, { method: 'POST' });
        if (!res.ok) throw new Error(await res.text());
        closePanel();
        fetchAgents();
    } catch (err) { alert('Error: ' + err.message); }
}

async function deleteAgent() {
    if (!activeAgentId) return;
    if (!confirm('Permanently delete this agent and all its configs? This cannot be undone.')) return;
    try {
        var res = await fetch('/api/agents/delete?uid=' + activeAgentId, { method: 'DELETE' });
        if (!res.ok) throw new Error(await res.text());
        closePanel();
        fetchAgents();
    } catch (err) { alert('Error: ' + err.message); }
}

// getUninstallScript is now handled inline in updatePanelHeader via event listener replacement

/* ─── Helpers ─────────────────────────── */
function showStatus(msg, type) {
    var el = document.getElementById('push-status');
    el.textContent = msg;
    el.className   = 'push-status' + (type ? ' ' + type : '');
}
