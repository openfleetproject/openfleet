/**
 * settings.js — Settings Page
 * Default wizard values, UI preferences, server info, export, danger zone.
 */

const SETTINGS_KEY = 'openfleet_settings';

/* ─── Init ─────────────────────────── */
function initSettingsPage() {
    loadSettingsForm();
    loadServerInfo();

    document.getElementById('btn-save-settings').addEventListener('click', saveSettings);
    document.getElementById('btn-reset-settings').addEventListener('click', resetSettings);
    document.getElementById('btn-export-json').addEventListener('click', function () {
        window.open('/api/export/agents?format=json', '_blank');
    });
    document.getElementById('btn-export-csv').addEventListener('click', function () {
        window.open('/api/export/agents?format=csv', '_blank');
    });
    document.getElementById('btn-cleanup-offline').addEventListener('click', cleanupOffline);

    // Live refresh interval preview
    document.getElementById('setting-refresh-interval').addEventListener('change', function () {
        var val = +this.value;
        var hint = document.getElementById('refresh-hint');
        hint.textContent = val === 0 ? 'Manual refresh only (no auto-polling)' :
                           'Agents list will refresh every ' + val + 's';
    });
}

/* ─── Load / Save Settings ─────────────────────────── */
function getSettings() {
    try { 
        var s = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}');
        // Clear old hardcoded cache so dynamic n-1 fetcher works
        if (s.defaultOtelVer === '0.96.0') s.defaultOtelVer = '';
        if (s.defaultSupVer === '0.96.0' || s.defaultSupVer === '0.151.0') s.defaultSupVer = '';
        return s;
    } catch { return {}; }
}

function loadSettingsForm() {
    var s = getSettings();
    setVal('setting-default-endpoint',   s.defaultEndpoint   || '');
    setVal('setting-default-otel-ver',   s.defaultOtelVer    || '');
    setVal('setting-default-sup-ver',    s.defaultSupVer     || '');
    setVal('setting-default-storage',    s.defaultStorage    || '/var/lib/otelcol/supervisor');
    setVal('setting-default-log-level',  s.defaultLogLevel   || 'info');
    setVal('setting-refresh-interval',   s.refreshInterval   != null ? s.refreshInterval : 15);

    // Trigger hint update
    document.getElementById('setting-refresh-interval').dispatchEvent(new Event('change'));
}

function saveSettings() {
    var s = {
        defaultEndpoint:  getVal('setting-default-endpoint'),
        defaultOtelVer:   getVal('setting-default-otel-ver'),
        defaultSupVer:    getVal('setting-default-sup-ver'),
        defaultStorage:   getVal('setting-default-storage'),
        defaultLogLevel:  getVal('setting-default-log-level'),
        refreshInterval:  +getVal('setting-refresh-interval'),
    };
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
    applySettings(s);
    showSettingsStatus('✓ Settings saved', 'ok');
}

function resetSettings() {
    if (!confirm('Reset all settings to defaults?')) return;
    localStorage.removeItem(SETTINGS_KEY);
    loadSettingsForm();
    applySettings({});
    showSettingsStatus('✓ Reset to defaults', 'ok');
}

function applySettings(s) {
    // Apply refresh interval to the main polling loop in app.js
    if (refreshTimer !== null) clearInterval(refreshTimer);
    var interval = (s.refreshInterval != null ? s.refreshInterval : 15) * 1000;
    if (interval > 0) {
        refreshTimer = setInterval(fetchAgents, interval);
    }

    // Pre-fill Add Agent modal defaults when opening
    window._defaultSettings = s;
}

/* Apply defaults to wizard fields — called from modal.js openAddAgentModal */
function applyWizardDefaults() {
    var s = getSettings();
    if (s.defaultEndpoint && !document.getElementById('input-endpoint').value) {
        document.getElementById('input-endpoint').value = s.defaultEndpoint;
    }
    if (s.defaultOtelVer)  document.getElementById('input-otel-version').value = s.defaultOtelVer;
    if (s.defaultSupVer)   document.getElementById('input-sup-version').value  = s.defaultSupVer;
    if (s.defaultStorage)  document.getElementById('input-storage-dir').value  = s.defaultStorage;
    if (s.defaultLogLevel) document.getElementById('input-log-level').value    = s.defaultLogLevel;
}

/* ─── Server Info ─────────────────────────── */
async function loadServerInfo() {
    try {
        var res  = await fetch('/api/server/info');
        var info = await res.json();
        var el   = document.getElementById('server-info-grid');
        var rows = [
            ['Version',            info.version],
            ['Go Runtime',         info.go_version],
            ['Uptime',             info.uptime],
            ['Started At',         new Date(info.started_at).toLocaleString()],
            ['Total Agents',       info.total_agents],
            ['Online Agents',      info.online_agents],
            ['Active Connections', info.active_connections],
        ];
        el.innerHTML = rows.map(function (r) {
            return '<div class="info-row"><div class="info-label">' + r[0] +
                   '</div><div class="info-value">' + escapeHtml(String(r[1] ?? '—')) + '</div></div>';
        }).join('');
    } catch (e) {
        document.getElementById('server-info-grid').innerHTML =
            '<p style="color:var(--text-muted);font-size:.8rem">Could not load server info.</p>';
    }
}

/* ─── Danger Zone ─────────────────────────── */
async function cleanupOffline() {
    var offline = agents.filter(function (a) { return a.status !== 'online'; }).length;
    if (offline === 0) { alert('No offline agents to remove.'); return; }
    if (!confirm('Permanently delete ' + offline + ' offline agent(s) and all their configs?')) return;
    try {
        var res    = await fetch('/api/agents/cleanup', { method: 'DELETE' });
        var result = await res.json();
        await fetchAgents();
        showSettingsStatus('✓ Removed ' + result.deleted + ' offline agent(s)', 'ok');
        loadServerInfo();
    } catch (e) { showSettingsStatus('✗ ' + e.message, 'err'); }
}

/* ─── Helpers ─────────────────────────── */
function getVal(id) { return document.getElementById(id).value; }
function setVal(id, v) { document.getElementById(id).value = v; }

function showSettingsStatus(msg, type) {
    var el = document.getElementById('settings-status');
    if (!el) return;
    el.textContent = msg;
    el.className   = 'push-status ' + (type || '');
    setTimeout(function () { el.textContent = ''; }, 3000);
}
