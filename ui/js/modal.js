/**
 * modal.js — Add Agent Wizard Modal
 * Handles the multi-step modal for deploying a new OpAMP supervisor agent.
 * Reads form values → builds install/uninstall script URLs → polls for new agent.
 */

const SAVED_CONFIGS_KEY = 'openfleet_saved_configs';

var wizardMode = 'add_agent';

/* ─── Init ─────────────────────────── */
function initAddAgentModal() {
    document.getElementById('btn-add-agent').addEventListener('click', function () { openModal('add_agent'); });
    document.getElementById('modal-overlay').addEventListener('click', closeAddAgentModal);
    document.getElementById('modal-close').addEventListener('click', closeAddAgentModal);
    document.getElementById('modal-cancel').addEventListener('click', closeAddAgentModal);
    document.getElementById('modal-next').addEventListener('click', goToStep2);
    document.getElementById('modal-back').addEventListener('click', goToStep1);
    document.getElementById('modal-done').addEventListener('click', closeAddAgentModal);

    document.getElementById('btn-copy-install').addEventListener('click', function () {
        copyText(document.getElementById('install-oneliner').textContent, this);
    });
    document.getElementById('btn-copy-uninstall').addEventListener('click', function () {
        copyText(document.getElementById('uninstall-oneliner').textContent, this);
    });

    document.getElementById('chk-save-config').addEventListener('change', function () {
        var nameInput = document.getElementById('input-save-name');
        nameInput.style.display = this.checked ? '' : 'none';
        if (this.checked) nameInput.focus();
    });

    document.getElementById('saved-config-select').addEventListener('change', function () {
        if (this.value) loadSavedConfig(this.value);
    });

    // Auto-fill endpoint from window.location
    var proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
    var host = window.location.hostname;
    var port = window.location.port || (window.location.protocol === 'https:' ? '443' : '8080');
    document.getElementById('input-endpoint').value = proto + '://' + host + ':' + port + '/v1/opamp';

    document.getElementById('input-executable').addEventListener('input', function() { this.dataset.touched = '1'; });
    document.getElementById('input-storage-dir').addEventListener('input', function() { this.dataset.touched = '1'; });

    // OS selector updates placeholders
    document.getElementById('input-os').addEventListener('change', function () {
        var isWin = this.value === 'windows';
        document.getElementById('input-executable').placeholder = isWin ? 'C:\\openfleet\\bin\\otelcol-contrib.exe' : '/opt/otelcol/bin/otelcol-contrib';
        document.getElementById('input-storage-dir').placeholder = isWin ? 'C:\\openfleet\\storage' : '/var/lib/otelcol/supervisor';
        // Note: conf_dir isn't exposed in the UI right now, but if it is added later it can be handled here.
        // Also wipe default values so placeholders take effect if user didn't explicitly type
        if (!document.getElementById('input-executable').dataset.touched) {
             document.getElementById('input-executable').value = '';
        }
    });

    renderSavedConfigsDropdown();
}

/* ─── Open / Close ─────────────────────────── */
function openModal(mode, presetName, presetData) {
    wizardMode = mode || 'add_agent';

    if (wizardMode === 'add_agent') {
        agentsSnapshotIds = new Set(agents.map(function (a) { return a.id; }));
        applyWizardDefaults();
        document.getElementById('modal-main-title').textContent = 'Add New Agent';
        document.getElementById('modal-subtitle').textContent = 'Deploy an OpAMP supervisor to a remote host';
        document.getElementById('save-config-row').style.display = '';
        document.querySelector('.modal-steps').style.display = '';
    } else if (wizardMode === 'edit_preset') {
        applyFormValues(presetData || {});
        document.getElementById('modal-main-title').textContent = 'Edit Preset: ' + presetName;
        document.getElementById('modal-subtitle').textContent = 'Update your saved configuration preset';
        document.getElementById('save-config-row').style.display = 'none';
        document.querySelector('.modal-steps').style.display = 'none';
    } else if (wizardMode === 'create_preset') {
        applyWizardDefaults();
        document.getElementById('modal-main-title').textContent = 'Create New Preset';
        document.getElementById('modal-subtitle').textContent = 'Create a reusable configuration preset';
        document.getElementById('save-config-row').style.display = 'none';
        document.querySelector('.modal-steps').style.display = 'none';
    }

    document.getElementById('modal-overlay').classList.add('active');
    document.getElementById('add-agent-modal').classList.add('active');
    goToStep1();
}

function closeAddAgentModal() {
    document.getElementById('modal-overlay').classList.remove('active');
    document.getElementById('add-agent-modal').classList.remove('active');
    stopWaiting();
}

/* ─── Steps ─────────────────────────── */
function goToStep1() { setStep(1); stopWaiting(); }

function goToStep2() {
    var endpoint = document.getElementById('input-endpoint').value.trim();
    if (!endpoint) {
        var el = document.getElementById('input-endpoint');
        el.focus();
        el.classList.add('input-error');
        return;
    }
    document.getElementById('input-endpoint').classList.remove('input-error');

    if (document.getElementById('chk-save-config').checked) {
        var name = document.getElementById('input-save-name').value.trim()
            || 'Config ' + new Date().toLocaleDateString();
        saveConfig(name, collectFormValues());
    }

    buildScriptLinks();
    setStep(2);
    startWaiting();
}

function setStep(n) {
    document.getElementById('modal-step-1').style.display = n === 1 ? '' : 'none';
    document.getElementById('modal-step-2').style.display = n === 2 ? '' : 'none';

    /* Default visibility (add_agent mode) */
    var showNext = n === 1 && wizardMode === 'add_agent';
    var showBack = n === 2 && wizardMode === 'add_agent';
    var showDone = n === 2 && wizardMode === 'add_agent';
    var showSave = n === 1 && wizardMode === 'edit_preset';
    var showSaveAs = n === 1 && wizardMode === 'edit_preset';
    var showLocal = n === 1 && wizardMode === 'create_preset';
    var showServer = n === 1 && wizardMode === 'create_preset';

    document.getElementById('modal-next').style.display = showNext ? '' : 'none';
    document.getElementById('modal-cancel').style.display = n === 1 ? '' : 'none';
    document.getElementById('modal-back').style.display = showBack ? '' : 'none';
    document.getElementById('modal-done').style.display = showDone ? '' : 'none';

    /* Preset buttons */
    document.getElementById('modal-save-preset').style.display = showSave ? '' : 'none';
    document.getElementById('modal-save-as-new-preset').style.display = showSaveAs ? '' : 'none';
    document.getElementById('modal-save-local').style.display = showLocal ? '' : 'none';
    document.getElementById('modal-save-server').style.display = showServer ? '' : 'none';

    document.querySelectorAll('.step').forEach(function (s, i) {
        s.classList.toggle('active', i + 1 <= n);
    });
}

/* ─── Form collection ─────────────────────────── */
function collectFormValues() {
    var otelV = document.getElementById('input-otel-version').value.trim();
    var supV  = document.getElementById('input-sup-version').value.trim();

    // If they match the dynamic github versions exactly, store them as empty so presets stay dynamic
    if (otelV === window.githubVersions?.otel) otelV = '';
    if (supV === window.githubVersions?.sup)   supV  = '';

    return {
        os: document.getElementById('input-os').value,
        endpoint: document.getElementById('input-endpoint').value.trim(),
        otelVersion: otelV,
        supervisorVersion: supV,
        label: document.getElementById('input-label').value.trim(),
        executable: document.getElementById('input-executable').value.trim(),
        runAs: document.getElementById('input-run-as').value.trim(),
        opampPort: document.getElementById('input-opamp-port').value.trim(),
        orphanInterval: document.getElementById('input-orphan-interval').value.trim(),
        bootstrapTimeout: document.getElementById('input-bootstrap-timeout').value.trim(),
        args: document.getElementById('input-args').value.trim(),
        env: document.getElementById('input-env').value.trim(),
        readAllow: document.getElementById('input-read-allow').value.trim(),
        readDeny: document.getElementById('input-read-deny').value.trim(),
        writeAllow: document.getElementById('input-write-allow').value.trim(),
        idAttrs: document.getElementById('input-id-attrs').value.trim(),
        nonIdAttrs: document.getElementById('input-non-id-attrs').value.trim(),
        storageDir: document.getElementById('input-storage-dir').value.trim(),
        logLevel: document.getElementById('input-log-level').value,
        metricsLevel: document.getElementById('input-metrics-level').value,
        caps: {
            accepts_remote_config: document.getElementById('cap-remote-config').checked,
            accepts_restart_command: document.getElementById('cap-restart-cmd').checked,
            accepts_opamp_connection_settings: document.getElementById('cap-opamp-conn-settings').checked,
            reports_effective_config: document.getElementById('cap-eff-config').checked,
            reports_own_metrics: document.getElementById('cap-own-metrics').checked,
            reports_own_logs: document.getElementById('cap-own-logs').checked,
            reports_own_traces: document.getElementById('cap-own-traces').checked,
            reports_health: document.getElementById('cap-health').checked,
            reports_remote_config: document.getElementById('cap-remote-config-status').checked,
            reports_available_components: document.getElementById('cap-components').checked,
            reports_heartbeat: document.getElementById('cap-heartbeat').checked,
        }
    };
}

function applyFormValues(v) {
    if (v.otelVersion === '0.96.0') v.otelVersion = '';
    if (v.supervisorVersion === '0.96.0' || v.supervisorVersion === '0.151.0') v.supervisorVersion = '';

    document.getElementById('input-os').value = v.os || 'linux';
    document.getElementById('input-endpoint').value = v.endpoint || '';
    document.getElementById('input-otel-version').value = v.otelVersion || window.githubVersions.otel || '0.96.0';
    document.getElementById('input-sup-version').value = v.supervisorVersion || window.githubVersions.sup || '0.151.0';
    document.getElementById('input-label').value = v.label || '';
    document.getElementById('input-executable').value = v.executable || '';
    if (v.executable) document.getElementById('input-executable').dataset.touched = '1';
    document.getElementById('input-run-as').value = v.runAs || 'otelcol';
    document.getElementById('input-opamp-port').value = v.opampPort || '';
    document.getElementById('input-orphan-interval').value = v.orphanInterval || '5s';
    document.getElementById('input-bootstrap-timeout').value = v.bootstrapTimeout || '3s';
    document.getElementById('input-args').value = v.args || '';
    document.getElementById('input-env').value = v.env || '';
    document.getElementById('input-read-allow').value = v.readAllow || '';
    document.getElementById('input-read-deny').value = v.readDeny || '';
    document.getElementById('input-write-allow').value = v.writeAllow || '';
    document.getElementById('input-id-attrs').value = v.idAttrs || '';
    document.getElementById('input-non-id-attrs').value = v.nonIdAttrs || '';
    document.getElementById('input-storage-dir').value = v.storageDir || '';
    if (v.storageDir) document.getElementById('input-storage-dir').dataset.touched = '1';
    if (v.logLevel) document.getElementById('input-log-level').value = v.logLevel;
    if (v.metricsLevel) document.getElementById('input-metrics-level').value = v.metricsLevel;
    if (v.caps) {
        Object.keys(v.caps).forEach(function (k) {
            var idMap = {
                accepts_remote_config: 'cap-remote-config',
                accepts_restart_command: 'cap-restart-cmd',
                accepts_opamp_connection_settings: 'cap-opamp-conn-settings',
                reports_effective_config: 'cap-eff-config',
                reports_own_metrics: 'cap-own-metrics',
                reports_own_logs: 'cap-own-logs',
                reports_own_traces: 'cap-own-traces',
                reports_health: 'cap-health',
                reports_remote_config: 'cap-remote-config-status',
                reports_available_components: 'cap-components',
                reports_heartbeat: 'cap-heartbeat',
            };
            var el = document.getElementById(idMap[k]);
            if (el) el.checked = !!v.caps[k];
        });
    }
}

/* ─── Script URL builder ─────────────────────────── */
function buildScriptLinks() {
    var v = collectFormValues();
    var base = window.location.origin;
    var params = new URLSearchParams({
        os: v.os,
        endpoint: v.endpoint,
        otel_version: v.otelVersion || window.githubVersions.otel || '0.96.0',
        supervisor_version: v.supervisorVersion || window.githubVersions.sup || '0.151.0',
        label: v.label,
        executable: v.executable,
        run_as: v.runAs,
        opamp_port: v.opampPort,
        orphan_interval: v.orphanInterval,
        bootstrap_timeout: v.bootstrapTimeout,
        args: v.args,
        env: v.env,
        read_allow: v.readAllow,
        read_deny: v.readDeny,
        write_allow: v.writeAllow,
        id_attrs: v.idAttrs,
        non_id_attrs: v.nonIdAttrs,
        storage_dir: v.storageDir,
        log_level: v.logLevel,
        metrics_level: v.metricsLevel,
    });
    Object.keys(v.caps).forEach(function (k) {
        params.set('cap_' + k, v.caps[k] ? '1' : '0');
    });

    var installUrl = base + '/api/install-script?' + params.toString();
    var uninstallBase = base + '/api/uninstall-script?uid=YOUR_AGENT_UID&os=' + v.os;

    var btnInstall = document.getElementById('btn-download-install');
    var btnUninstall = document.getElementById('btn-download-uninstall');

    if (v.os === 'windows') {
        document.getElementById('install-oneliner').textContent =
            'Invoke-WebRequest -Uri "' + installUrl + '" -OutFile "install.ps1" -UseBasicParsing; powershell.exe -ExecutionPolicy Bypass -File .\\install.ps1';
        document.getElementById('uninstall-oneliner').textContent =
            'Invoke-WebRequest -Uri "' + uninstallBase + '" -OutFile "uninstall.ps1" -UseBasicParsing; powershell.exe -ExecutionPolicy Bypass -File .\\uninstall.ps1';
        
        btnInstall.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg> Download install.ps1';
        btnInstall.setAttribute('download', 'openfleet-install.ps1');
        
        btnUninstall.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg> Download uninstall.ps1';
        btnUninstall.setAttribute('download', 'openfleet-uninstall.ps1');
    } else {
        document.getElementById('install-oneliner').textContent =
            'curl -fsSL "' + installUrl + '" | sudo bash';
        document.getElementById('uninstall-oneliner').textContent =
            'curl -fsSL "' + uninstallBase + '" | sudo bash';
            
        btnInstall.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg> Download install.sh';
        btnInstall.setAttribute('download', 'openfleet-install.sh');
        
        btnUninstall.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg> Download uninstall.sh';
        btnUninstall.setAttribute('download', 'openfleet-uninstall.sh');
    }

    btnInstall.href = installUrl + '&download=1';
    btnUninstall.href = uninstallBase + '&download=1';
}

/* ─── Waiting for new agent ─────────────────────────── */
function startWaiting() {
    waitCountdown = 120;
    var waitEl = document.getElementById('wait-section');
    var successEl = document.getElementById('wait-success');
    var labelEl = document.getElementById('wait-label');

    waitEl.style.display = '';
    successEl.style.display = 'none';
    labelEl.textContent = 'Waiting for agent to connect…';

    waitTimer = setInterval(function () {
        waitCountdown--;
        if (waitCountdown === 0) {
            // Do not stop polling; Windows downloads + tar extraction can take several minutes.
            labelEl.textContent = 'Taking longer than expected... waiting for agent to connect.';
        }
        fetchAgents();
    }, 1000);
}

function stopWaiting() {
    if (waitTimer !== null) { clearInterval(waitTimer); waitTimer = null; }
}

function checkForNewAgent(currentAgents) {
    var newAgent = currentAgents.find(function (a) { return !agentsSnapshotIds.has(a.id); });
    if (newAgent) {
        stopWaiting();
        document.getElementById('wait-section').style.display = 'none';
        var el = document.getElementById('wait-success');
        el.style.display = 'flex';
        document.getElementById('wait-agent-name').textContent =
            (newAgent.hostname || 'Unknown') + ' (' + newAgent.id + ')';
        fetchAgents();
    }
}

/* ─── Saved Configs (localStorage) ─────────────────────────── */
function getSavedConfigs() {
    try { return JSON.parse(localStorage.getItem(SAVED_CONFIGS_KEY) || '[]'); }
    catch (e) { return []; }
}

function saveConfig(name, data) {
    var configs = getSavedConfigs().filter(function (c) { return c.name !== name; });
    configs.unshift({ name: name, data: data, savedAt: new Date().toISOString() });
    localStorage.setItem(SAVED_CONFIGS_KEY, JSON.stringify(configs));
    renderSavedConfigsDropdown();
}

function renderSavedConfigsDropdown() {
    var configs = getSavedConfigs();
    var group = document.getElementById('saved-configs-group');
    var sel = document.getElementById('saved-config-select');
    if (configs.length === 0) { group.style.display = 'none'; return; }
    group.style.display = '';
    sel.innerHTML = '<option value="">— Load a saved configuration —</option>' +
        configs.map(function (c) {
            var date = new Date(c.savedAt).toLocaleDateString();
            return '<option value="' + escapeHtml(c.name) + '">' +
                escapeHtml(c.name) + ' (' + date + ')</option>';
        }).join('');
}

function loadSavedConfig(name) {
    var cfg = getSavedConfigs().find(function (c) { return c.name === name; });
    if (cfg) applyFormValues(cfg.data);
}
