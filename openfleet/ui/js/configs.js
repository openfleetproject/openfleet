/**
 * configs.js — Configurations Page
 * Tab 1 (YAML Templates): create, edit, delete, bulk-push to multiple agents.
 * Tab 2 (Saved Wizard Presets): view, rename, delete configs saved from Add Agent modal.
 */

var templates = [];
var selectedTemplateId = null;   // last-clicked template in the editor
var bulkSelectedUIDs = new Set();
var bulkSelectedTemplateIds = new Set(); // templates chosen for bulk push

/* SAVED_CONFIGS_KEY is declared as const in modal.js — do NOT re-declare here */

/* Which preset is currently open in detail view */
var activePresetName = null;

/* ─── Init ─────────────────────────── */
function initConfigsPage() {
    /* YAML Templates */
    document.getElementById('btn-new-template').addEventListener('click', openNewTemplate);
    document.getElementById('btn-save-template').addEventListener('click', saveTemplate);
    document.getElementById('btn-delete-template').addEventListener('click', deleteTemplate);
    document.getElementById('btn-cancel-template').addEventListener('click', closeTemplateEditor);
    document.getElementById('btn-bulk-push').addEventListener('click', bulkPush);
    document.getElementById('btn-select-all').addEventListener('click', selectAllAgents);
    document.getElementById('btn-select-all-templates').addEventListener('click', selectAllTemplates);
    document.getElementById('template-search').addEventListener('input', renderTemplateList);

    /* Live YAML warning: show banner when user types extensions.opamp */
    document.getElementById('tpl-yaml').addEventListener('input', checkOpampWarning);

    /* Wizard Presets */
    document.getElementById('wizard-config-search').addEventListener('input', renderWizardPresets);
    document.getElementById('btn-clear-all-wizard').addEventListener('click', clearAllWizardPresets);
    document.getElementById('btn-preset-back').addEventListener('click', closePresetDetail);
    document.getElementById('btn-preset-delete').addEventListener('click', deleteActivePreset);
    document.getElementById('btn-preset-rename').addEventListener('click', renameActivePreset);
    document.getElementById('btn-preset-push-server').addEventListener('click', pushPresetToServer);
    
    /* New Edit/Create Preset Logic */
    document.getElementById('btn-create-wizard-preset').addEventListener('click', function() {
        if (typeof openModal === 'function') openModal('create_preset');
    });
    document.getElementById('btn-preset-edit').addEventListener('click', handleEditPreset);
    
    document.getElementById('modal-save-preset').addEventListener('click', saveEditedPreset);
    document.getElementById('modal-save-as-new-preset').addEventListener('click', saveAsNewPreset);
    document.getElementById('modal-save-local').addEventListener('click', createLocalPreset);
    document.getElementById('modal-save-server').addEventListener('click', createServerPreset);

    /* Tab switching */
    document.querySelectorAll('.cfg-tab').forEach(function (btn) {
        btn.addEventListener('click', function () {
            switchCfgTab(this.dataset.cfgtab);
        });
    });
    
    // Restore active tab
    var savedTab = localStorage.getItem('openfleet_configs_tab') || 'templates';
    switchCfgTab(savedTab);
}

/* ─── Tab Switching ─────────────────────────── */
function switchCfgTab(tab) {
    document.querySelectorAll('.cfg-tab').forEach(function (b) {
        b.classList.toggle('active', b.dataset.cfgtab === tab);
    });
    document.querySelectorAll('.cfg-tab-pane').forEach(function (p) {
        p.classList.toggle('active', p.id === 'cfgpane-' + tab);
    });
    localStorage.setItem('openfleet_configs_tab', tab);
    if (tab === 'wizardconfigs') {
        renderWizardPresets();
    }
}

/* ─── Load Data ─────────────────────────── */
async function loadConfigsPage() {
    await fetchTemplates();
    renderAgentCheckboxes();
    renderTemplatePushList();
    await fetchServerPresets();
    updateWizardPresetsBadge();
}

async function fetchTemplates() {
    try {
        var res = await fetch('/api/templates');
        templates = await res.json() || [];
        renderTemplateList();
        renderTemplatePushList(); // keep push panel in sync
    } catch (e) { console.error('Failed to load templates', e); }
}

/* ─── Template List ─────────────────────────── */
function renderTemplateList() {
    var query = (document.getElementById('template-search').value || '').toLowerCase();
    var list = document.getElementById('template-list');
    var filtered = templates.filter(function (t) {
        return t.name.toLowerCase().includes(query) ||
            (t.description || '').toLowerCase().includes(query);
    });

    if (filtered.length === 0) {
        list.innerHTML = '<div class="cfg-empty-state">' +
            '<svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>' +
            '<p>' + (query ? 'No templates match your search.' : 'No templates yet. Create your first one →') + '</p></div>';
        return;
    }
    list.innerHTML = filtered.map(function (t) {
        var active = t.id === selectedTemplateId ? ' active' : '';
        var date = new Date(t.updated_at).toLocaleDateString();
        return '<div class="template-card' + active + '" data-id="' + t.id + '">' +
            '<div class="template-card-name">' + escapeHtml(t.name) + '</div>' +
            '<div class="template-card-desc">' + escapeHtml(t.description || 'No description') + '</div>' +
            '<div class="template-card-meta">Updated ' + date + '</div>' +
            '</div>';
    }).join('');

    list.querySelectorAll('.template-card').forEach(function (card) {
        card.addEventListener('click', function () { openTemplate(+this.dataset.id); });
    });
}

/* ─── Template Editor ─────────────────────────── */
function openNewTemplate() {
    selectedTemplateId = null;
    document.getElementById('template-editor-pane').style.display = '';
    document.getElementById('template-placeholder').style.display = 'none';
    document.getElementById('tpl-name').value = '';
    document.getElementById('tpl-desc').value = '';
    document.getElementById('tpl-config-key').value = '';
    document.getElementById('tpl-yaml').value =
        'receivers:\n  otlp:\n    protocols:\n      grpc:\n        endpoint: 0.0.0.0:4317\n\nprocessors:\n  batch: {}\n\nexporters:\n  debug:\n    verbosity: normal\n\nservice:\n  pipelines:\n    traces:\n      receivers: [otlp]\n      processors: [batch]\n      exporters: [debug]\n';
    document.getElementById('btn-delete-template').style.display = 'none';
    document.getElementById('tpl-opamp-warning').style.display = 'none';
    document.getElementById('tpl-name').focus();
    renderTemplateList();
}

function openTemplate(id) {
    var t = templates.find(function (t) { return t.id === id; });
    if (!t) return;
    selectedTemplateId = id;
    document.getElementById('template-editor-pane').style.display = '';
    document.getElementById('template-placeholder').style.display = 'none';
    document.getElementById('tpl-name').value = t.name;
    document.getElementById('tpl-desc').value = t.description || '';
    document.getElementById('tpl-config-key').value = t.config_key || '';
    document.getElementById('tpl-yaml').value = t.yaml || '';
    document.getElementById('btn-delete-template').style.display = '';
    checkOpampWarning();
    renderTemplateList();
}

function closeTemplateEditor() {
    selectedTemplateId = null;
    document.getElementById('template-editor-pane').style.display = 'none';
    document.getElementById('template-placeholder').style.display = '';
    document.getElementById('tpl-opamp-warning').style.display = 'none';
    renderTemplateList();
}

/* ─── Live opamp extension warning ─────────────────────────── */
function checkOpampWarning() {
    var yaml = document.getElementById('tpl-yaml').value || '';
    // Detect  "extensions:" followed anywhere by "  opamp:"
    var hasOpamp = /extensions\s*:[\s\S]*?opamp\s*:/.test(yaml);
    document.getElementById('tpl-opamp-warning').style.display = hasOpamp ? '' : 'none';
}

async function saveTemplate() {
    var name = document.getElementById('tpl-name').value.trim();
    var desc = document.getElementById('tpl-desc').value.trim();
    var configKey = document.getElementById('tpl-config-key').value.trim();
    var yaml = document.getElementById('tpl-yaml').value.trim();
    if (!name) { document.getElementById('tpl-name').focus(); return; }
    if (!yaml) { document.getElementById('tpl-yaml').focus(); return; }

    var btn = document.getElementById('btn-save-template');
    btn.disabled = true; btn.textContent = 'Saving…';

    var payload = { id: selectedTemplateId || 0, name: name, description: desc, config_key: configKey, yaml: yaml };
    try {
        var res = await fetch('/api/templates/save', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });
        if (!res.ok) throw new Error(await res.text());
        var saved = await res.json();
        selectedTemplateId = saved.id;
        await fetchTemplates();
        openTemplate(saved.id);
        showCfgStatus('✓ Template saved', 'ok');
    } catch (e) { showCfgStatus('✗ ' + e.message, 'err'); }
    finally { btn.disabled = false; btn.textContent = '↑ Save Template'; }
}

async function deleteTemplate() {
    if (!selectedTemplateId) return;
    if (!confirm('Delete this template? This cannot be undone.')) return;
    try {
        var res = await fetch('/api/templates/delete?id=' + selectedTemplateId, { method: 'DELETE' });
        if (!res.ok) throw new Error(await res.text());
        closeTemplateEditor();
        await fetchTemplates();
    } catch (e) { showCfgStatus('✗ ' + e.message, 'err'); }
}

/* ─── Template checkboxes in the Push panel ────────────────────────── */
function renderTemplatePushList() {
    var container = document.getElementById('bulk-template-list');
    if (!container) return;
    if (templates.length === 0) {
        container.innerHTML = '<span class="bulk-no-agents">No templates yet.</span>';
        updateBulkPushBtn();
        return;
    }
    container.innerHTML = templates.map(function (t) {
        var checked = bulkSelectedTemplateIds.has(t.id) ? ' checked' : '';
        var keyTag = t.config_key
            ? '<span style="font-family:var(--font-mono);font-size:.72rem;opacity:.7;margin-left:.35rem">[' + escapeHtml(t.config_key) + ']</span>'
            : '<span style="font-size:.72rem;opacity:.5;margin-left:.35rem">[primary]</span>';
        return '<label class="bulk-agent-row">' +
            '<input type="checkbox" class="bulk-tpl-chk" data-id="' + t.id + '"' + checked + '>' +
            '<span class="checkbox-box"></span>' +
            '<span class="bulk-agent-info">' +
            '<span class="bulk-agent-name">' + escapeHtml(t.name) + keyTag + '</span>' +
            '</span></label>';
    }).join('');

    container.querySelectorAll('.bulk-tpl-chk').forEach(function (chk) {
        chk.addEventListener('change', function () {
            var tid = +this.dataset.id;
            if (this.checked) bulkSelectedTemplateIds.add(tid);
            else bulkSelectedTemplateIds.delete(tid);
            updateBulkPushBtn();
        });
    });
    updateBulkPushBtn();
}

function selectAllTemplates() {
    var allChecked = bulkSelectedTemplateIds.size === templates.length;
    bulkSelectedTemplateIds.clear();
    if (!allChecked) templates.forEach(function (t) { bulkSelectedTemplateIds.add(t.id); });
    renderTemplatePushList();
}

/* ─── Agent Checkboxes for Bulk Push ─────────────────────────── */
function renderAgentCheckboxes() {
    var container = document.getElementById('bulk-agent-list');
    if (!container) return;
    if (agents.length === 0) {
        container.innerHTML = '<span class="bulk-no-agents">No agents connected yet.</span>';
        return;
    }
    container.innerHTML = agents.map(function (a) {
        var checked = bulkSelectedUIDs.has(a.id) ? ' checked' : '';
        var cls = a.status === 'online' ? 'badge-online' : 'badge-offline';
        return '<label class="bulk-agent-row">' +
            '<input type="checkbox" class="bulk-chk" data-uid="' + a.id + '"' + checked + '>' +
            '<span class="checkbox-box"></span>' +
            '<span class="bulk-agent-info">' +
            '<span class="bulk-agent-name">' + escapeHtml(a.hostname || a.id) + '</span>' +
            '<span class="agent-badge ' + cls + '"><span class="badge-dot"></span>' + a.status + '</span>' +
            '</span></label>';
    }).join('');

    container.querySelectorAll('.bulk-chk').forEach(function (chk) {
        chk.addEventListener('change', function () {
            if (this.checked) bulkSelectedUIDs.add(this.dataset.uid);
            else bulkSelectedUIDs.delete(this.dataset.uid);
            updateBulkPushBtn();
        });
    });
    updateBulkPushBtn();
}

function selectAllAgents() {
    var allChecked = bulkSelectedUIDs.size === agents.length;
    bulkSelectedUIDs.clear();
    if (!allChecked) agents.forEach(function (a) { bulkSelectedUIDs.add(a.id); });
    renderAgentCheckboxes();
}

function updateBulkPushBtn() {
    var btn = document.getElementById('btn-bulk-push');
    if (!btn) return;
    var nAgents = bulkSelectedUIDs.size;
    var nTemplates = bulkSelectedTemplateIds.size;
    var disabled = nAgents === 0 || nTemplates === 0;
    btn.disabled = disabled;
    if (nTemplates === 0) {
        btn.textContent = 'Select templates above';
    } else if (nAgents === 0) {
        btn.textContent = 'Select target agents';
    } else {
        btn.textContent = 'Push ' + nTemplates + ' template' + (nTemplates > 1 ? 's' : '') +
            ' to ' + nAgents + ' agent' + (nAgents > 1 ? 's' : '');
    }
}

async function bulkPush() {
    if (bulkSelectedTemplateIds.size === 0 || bulkSelectedUIDs.size === 0) return;
    var names = [...bulkSelectedTemplateIds].map(function (tid) {
        return (templates.find(function (t) { return t.id === tid; }) || {}).name || tid;
    });
    var agentCount = bulkSelectedUIDs.size;
    if (!confirm('Push ' + names.length + ' template(s):\n' + names.map(function(n){return '  • ' + n;}).join('\n') +
        '\n\nto ' + agentCount + ' agent(s)?')) return;

    var btn = document.getElementById('btn-bulk-push');
    btn.disabled = true; btn.textContent = 'Pushing…';

    try {
        var res = await fetch('/api/agents/config/bulk-push', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                template_ids: [...bulkSelectedTemplateIds],
                uids: [...bulkSelectedUIDs]
            }),
        });
        var results = await res.json();
        renderBulkResults(results);
    } catch (e) { showCfgStatus('✗ ' + e.message, 'err'); }
    finally { btn.disabled = false; updateBulkPushBtn(); }
}

function renderBulkResults(results) {
    var el = document.getElementById('bulk-results');
    el.innerHTML = results.map(function (r) {
        var icon = r.success ? '✓' : '✗';
        var cls = r.success ? 'bulk-result-ok' : 'bulk-result-err';
        var agent = agents.find(function (a) { return a.id === r.uid; });
        var label = (agent && agent.hostname) ? agent.hostname : r.uid;
        return '<div class="' + cls + '">' + icon + ' ' + escapeHtml(label) + ' — ' + r.message + '</div>';
    }).join('');
}

function showCfgStatus(msg, type) {
    var el = document.getElementById('cfg-status');
    if (!el) return;
    el.textContent = msg;
    el.className = 'push-status ' + (type || '');
    setTimeout(function () { el.textContent = ''; }, 3500);
}

/* ═══════════════════════════════════════════════════════
   WIZARD PRESETS — localStorage + server management
   ═══════════════════════════════════════════════════════ */

/* Server-side presets cache (fetched from /api/wizard-presets) */
var serverPresets = [];

async function fetchServerPresets() {
    try {
        var res = await fetch('/api/wizard-presets');
        if (!res.ok) throw new Error(res.statusText);
        serverPresets = await res.json() || [];
    } catch (e) {
        console.warn('Could not load server wizard presets:', e);
        serverPresets = [];
    }
    updateWizardPresetsBadge();
}

function getWizardPresets() {
    try { return JSON.parse(localStorage.getItem(SAVED_CONFIGS_KEY) || '[]'); }
    catch (e) { return []; }
}

function saveWizardPresets(list) {
    localStorage.setItem(SAVED_CONFIGS_KEY, JSON.stringify(list));
    updateWizardPresetsBadge();
}

function updateWizardPresetsBadge() {
    var local = getWizardPresets();
    var serverNames = serverPresets.map(function (p) { return p.name; });
    /* Only count local presets that are NOT already on the server */
    var localOnlyCount = local.filter(function (c) { return !serverNames.includes(c.name); }).length;
    var total = localOnlyCount + serverPresets.length;
    var badge = document.getElementById('wizard-configs-count');
    if (!badge) return;
    if (total > 0) {
        badge.textContent = total;
        badge.style.display = '';
    } else {
        badge.style.display = 'none';
    }
}

/* ─── Render Preset Cards ─────────────────────────── */
async function renderWizardPresets() {
    /* Refresh server list each time the tab is shown */
    await fetchServerPresets();

    var query = (document.getElementById('wizard-config-search').value || '').toLowerCase();
    var local = getWizardPresets();
    var grid = document.getElementById('wizard-presets-grid');
    var detail = document.getElementById('wizard-preset-detail');

    grid.style.display = '';
    detail.style.display = 'none';
    activePresetName = null;

    updateWizardPresetsBadge();

    /* Build combined list: server presets first, then local-only ones */
    var serverNames = serverPresets.map(function (p) { return p.name; });
    var localOnly = local.filter(function (c) { return !serverNames.includes(c.name); });

    /* Filter by search */
    var filteredServer = serverPresets.filter(function (p) {
        return p.name.toLowerCase().includes(query);
    });
    var filteredLocal = localOnly.filter(function (c) {
        return c.name.toLowerCase().includes(query);
    });

    if (filteredServer.length === 0 && filteredLocal.length === 0) {
        grid.innerHTML = '<div class="cfg-empty-state">' +
            '<svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1"><circle cx="12" cy="12" r="10"/><line x1="8" y1="12" x2="16" y2="12"/></svg>' +
            '<p>' + (query ? 'No presets match your search.' : 'No saved wizard presets yet.<br>Check "Save this configuration for later" when adding an agent.') + '</p>' +
            '</div>';
        return;
    }

    /* Server preset cards */
    var serverHtml = filteredServer.map(function (p) {
        var date = new Date(p.saved_at || p.updated_at).toLocaleDateString();
        var dataObj = {};
        try { dataObj = JSON.parse(p.data || '{}'); } catch (e) { }
        return '<div class="preset-card preset-card--server" data-source="server" data-id="' + p.id + '" data-name="' + escapeHtml(p.name) + '">' +
            '<div class="preset-card-toprow">' +
            '<div class="preset-card-name">' + escapeHtml(p.name) + '</div>' +
            '<span class="preset-badge-server">Server</span>' +
            '</div>' +
            '<div class="preset-card-meta"><span class="preset-card-endpoint">' + escapeHtml(dataObj.endpoint || '—') + '</span></div>' +
            '<div class="preset-card-footer">' +
            '<span class="preset-card-date">Saved ' + date + '</span>' +
            '<span class="preset-card-hint">Click to view →</span>' +
            '</div>' +
            '</div>';
    }).join('');

    /* Local-only preset cards */
    var localHtml = filteredLocal.map(function (c) {
        var date = new Date(c.savedAt).toLocaleDateString();
        var v = c.data || {};
        return '<div class="preset-card" data-source="local" data-name="' + escapeHtml(c.name) + '">' +
            '<div class="preset-card-toprow">' +
            '<div class="preset-card-name">' + escapeHtml(c.name) + '</div>' +
            '<span class="preset-badge-local">Local</span>' +
            '</div>' +
            '<div class="preset-card-meta"><span class="preset-card-endpoint">' + escapeHtml(v.endpoint || '—') + '</span></div>' +
            '<div class="preset-card-footer">' +
            '<span class="preset-card-date">Saved ' + date + '</span>' +
            '<span class="preset-card-hint">Click to view →</span>' +
            '</div>' +
            '</div>';
    }).join('');

    grid.innerHTML = serverHtml + localHtml;

    grid.querySelectorAll('.preset-card').forEach(function (card) {
        card.addEventListener('click', function () {
            var source = this.dataset.source;
            if (source === 'server') {
                openServerPresetDetail(+this.dataset.id, this.dataset.name);
            } else {
                openLocalPresetDetail(this.dataset.name);
            }
        });
    });
}

/* ─── Shared Detail Helpers ─────────────────────────── */
function buildPresetRows(v) {
    return [
        { label: 'OpAMP Endpoint', value: v.endpoint },
        { label: 'OTel Collector Ver.', value: v.otelVersion },
        { label: 'Supervisor Version', value: v.supervisorVersion },
        { label: 'Agent Label', value: v.label },
        { label: 'Executable', value: v.executable },
        { label: 'Run As', value: v.runAs },
        { label: 'OpAMP Port', value: v.opampPort },
        { label: 'Orphan Interval', value: v.orphanInterval },
        { label: 'Bootstrap Timeout', value: v.bootstrapTimeout },
        { label: 'Storage Dir', value: v.storageDir },
        { label: 'Log Level', value: v.logLevel },
        { label: 'Metrics Verbosity', value: v.metricsLevel },
        { label: 'Extra Args', value: v.args, multi: true },
        { label: 'Env Variables', value: v.env, multi: true },
        { label: 'Read Allow', value: v.readAllow },
        { label: 'Read Deny', value: v.readDeny },
        { label: 'Write Allow', value: v.writeAllow },
        { label: 'Identifying Attrs', value: v.idAttrs, multi: true },
        { label: 'Non-ID Attrs', value: v.nonIdAttrs, multi: true },
    ];
}

function buildCapsHtml(caps) {
    if (!caps) return '';
    var enabled = Object.keys(caps).filter(function (k) { return caps[k]; });
    var disabled = Object.keys(caps).filter(function (k) { return !caps[k]; });
    return '<div class="preset-section-title">Capabilities</div>' +
        '<div class="preset-caps-grid">' +
        enabled.map(function (k) { return '<span class="preset-cap enabled">' + escapeHtml(k) + '</span>'; }).join('') +
        disabled.map(function (k) { return '<span class="preset-cap disabled">' + escapeHtml(k) + '</span>'; }).join('') +
        '</div>';
}

function renderPresetBody(v, savedAt) {
    var rows = buildPresetRows(v);
    return '<div class="preset-detail-meta">Saved on ' + (savedAt ? new Date(savedAt).toLocaleString() : '—') + '</div>' +
        '<div class="preset-info-grid">' +
        rows.filter(function (r) { return r.value; }).map(function (r) {
            var val = r.multi
                ? '<pre class="preset-multiline">' + escapeHtml(r.value) + '</pre>'
                : '<span class="preset-val">' + escapeHtml(r.value) + '</span>';
            return '<div class="preset-info-row"><span class="preset-info-label">' + r.label + '</span>' + val + '</div>';
        }).join('') +
        '</div>' +
        buildCapsHtml(v.caps);
}

function showDetailPane() {
    document.getElementById('wizard-presets-grid').style.display = 'none';
    document.getElementById('wizard-preset-detail').style.display = '';
    var toolbar = document.getElementById('wizard-presets-toolbar');
    if (toolbar) toolbar.style.display = 'none';
}

/* Track which server-side preset is active (by id) */
var activeServerId = null;

/* ─── Local Preset Detail ─────────────────────────── */
function openLocalPresetDetail(name) {
    var presets = getWizardPresets();
    var preset = presets.find(function (c) { return c.name === name; });
    if (!preset) return;

    activePresetName = name;
    activeServerId = null;
    showDetailPane();

    document.getElementById('preset-detail-title').textContent = preset.name;
    /* Show Push to Server button, hide server-only badge */
    document.getElementById('btn-preset-push-server').style.display = '';
    document.getElementById('preset-server-badge').style.display = 'none';

    document.getElementById('preset-detail-body').innerHTML =
        renderPresetBody(preset.data || {}, preset.savedAt);
}

/* ─── Server Preset Detail ─────────────────────────── */
function openServerPresetDetail(id, name) {
    var preset = serverPresets.find(function (p) { return p.id === id; });
    if (!preset) return;

    activeServerId = id;
    activePresetName = name;
    showDetailPane();

    document.getElementById('preset-detail-title').textContent = preset.name;
    /* Hide Push button (already on server), show badge */
    document.getElementById('btn-preset-push-server').style.display = 'none';
    document.getElementById('preset-server-badge').style.display = '';

    var dataObj = {};
    try { dataObj = JSON.parse(preset.data || '{}'); } catch (e) { }
    document.getElementById('preset-detail-body').innerHTML =
        renderPresetBody(dataObj, preset.saved_at);
}

function closePresetDetail() {
    activePresetName = null;
    activeServerId = null;
    var toolbar = document.getElementById('wizard-presets-toolbar');
    if (toolbar) toolbar.style.display = '';
    document.getElementById('wizard-presets-grid').style.display = '';
    document.getElementById('wizard-preset-detail').style.display = 'none';
    renderWizardPresets();
}

/* ─── Push Local Preset to Server ─────────────────────────── */
async function pushPresetToServer() {
    if (!activePresetName) return;
    var presets = getWizardPresets();
    var preset = presets.find(function (c) { return c.name === activePresetName; });
    if (!preset) return;

    var btn = document.getElementById('btn-preset-push-server');
    btn.disabled = true;
    btn.textContent = 'Pushing…';

    try {
        var res = await fetch('/api/wizard-presets/save', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                id: 0,
                name: preset.name,
                data: JSON.stringify(preset.data || {}),
            }),
        });
        if (!res.ok) throw new Error(await res.text());
        var saved = await res.json();

        /* Remove from localStorage now that it lives on the server */
        var remaining = getWizardPresets().filter(function (c) { return c.name !== activePresetName; });
        saveWizardPresets(remaining);
        if (typeof renderSavedConfigsDropdown === 'function') renderSavedConfigsDropdown();

        /* Re-fetch server list and switch to server detail view */
        await fetchServerPresets();
        openServerPresetDetail(saved.id, saved.name);
        showPresetStatus('✓ Preset saved to server', 'ok');
    } catch (e) {
        showPresetStatus('✗ ' + e.message, 'err');
    } finally {
        btn.disabled = false;
        btn.textContent = 'Push to Server';
    }
}

/* ─── Delete Preset ─────────────────────────── */
async function deleteActivePreset() {
    if (!activePresetName) return;
    if (!confirm('Delete preset "' + activePresetName + '"? This cannot be undone.')) return;

    if (activeServerId) {
        /* Delete from server */
        try {
            var res = await fetch('/api/wizard-presets/delete?id=' + activeServerId, { method: 'DELETE' });
            if (!res.ok) throw new Error(await res.text());
        } catch (e) {
            showPresetStatus('✗ Server delete failed: ' + e.message, 'err');
            return;
        }
    }

    /* Always also remove from localStorage if present */
    var updated = getWizardPresets().filter(function (c) { return c.name !== activePresetName; });
    saveWizardPresets(updated);
    if (typeof renderSavedConfigsDropdown === 'function') renderSavedConfigsDropdown();
    closePresetDetail();
}

/* ─── Rename Preset ─────────────────────────── */
async function renameActivePreset() {
    if (!activePresetName) return;
    var newName = prompt('Rename preset:', activePresetName);
    if (!newName || !newName.trim() || newName.trim() === activePresetName) return;
    newName = newName.trim();

    /* Check for name collision */
    var local = getWizardPresets();
    if (local.some(function (c) { return c.name === newName; }) ||
        serverPresets.some(function (p) { return p.name === newName; })) {
        alert('A preset with that name already exists.');
        return;
    }

    if (activeServerId) {
        /* Rename on server */
        try {
            var res = await fetch('/api/wizard-presets/rename', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id: activeServerId, name: newName }),
            });
            if (!res.ok) throw new Error(await res.text());
        } catch (e) {
            showPresetStatus('✗ Server rename failed: ' + e.message, 'err');
            return;
        }
    }

    /* Rename in localStorage too if it exists there */
    local.forEach(function (c) { if (c.name === activePresetName) c.name = newName; });
    saveWizardPresets(local);
    if (typeof renderSavedConfigsDropdown === 'function') renderSavedConfigsDropdown();

    var oldServerId = activeServerId;
    activePresetName = newName;
    document.getElementById('preset-detail-title').textContent = newName;

    await fetchServerPresets();
    if (oldServerId) {
        openServerPresetDetail(oldServerId, newName);
    } else {
        openLocalPresetDetail(newName);
    }
}

/* ─── Clear All Local Presets ─────────────────────────── */
function clearAllWizardPresets() {
    var presets = getWizardPresets();
    if (presets.length === 0) return;
    if (!confirm('Clear all ' + presets.length + ' local saved wizard preset(s)? This cannot be undone.\n(Server-side presets are unaffected.)')) return;
    saveWizardPresets([]);
    if (typeof renderSavedConfigsDropdown === 'function') renderSavedConfigsDropdown();
    renderWizardPresets();
}

/* ─── Edit / Create Preset Action Handlers ─────────────────────────── */

function getActivePresetData() {
    if (!activePresetName) return null;
    if (activeServerId) {
        var p = serverPresets.find(function (x) { return x.id === activeServerId; });
        if (!p) return null;
        try { return JSON.parse(p.data || '{}'); } catch (e) { return {}; }
    } else {
        var presets = getWizardPresets();
        var c = presets.find(function (x) { return x.name === activePresetName; });
        return c ? (c.data || {}) : null;
    }
}

function handleEditPreset() {
    var data = getActivePresetData();
    if (!data) return;
    if (typeof openModal === 'function') {
        openModal('edit_preset', activePresetName, data);
    }
}

async function saveEditedPreset() {
    if (!activePresetName || typeof collectFormValues !== 'function' || typeof closeAddAgentModal !== 'function') return;
    var newData = collectFormValues();
    
    var btn = document.getElementById('modal-save-preset');
    btn.disabled = true; btn.textContent = 'Saving…';
    
    try {
        if (activeServerId) {
            /* Update Server */
            var res = await fetch('/api/wizard-presets/save', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id: activeServerId, name: activePresetName, data: JSON.stringify(newData) })
            });
            if (!res.ok) throw new Error(await res.text());
            var saved = await res.json();
            await fetchServerPresets();
            openServerPresetDetail(saved.id, saved.name);
        } else {
            /* Update Local */
            var local = getWizardPresets();
            local.forEach(function (c) {
                if (c.name === activePresetName) {
                    c.data = newData;
                    c.savedAt = new Date().toISOString();
                }
            });
            saveWizardPresets(local);
            openLocalPresetDetail(activePresetName);
        }
        closeAddAgentModal();
        showPresetStatus('✓ Changes saved successfully', 'ok');
    } catch (e) {
        alert('Failed to save changes: ' + e.message);
    } finally {
        btn.disabled = false; btn.textContent = 'Save';
    }
}

async function saveAsNewPreset() {
    if (typeof collectFormValues !== 'function' || typeof closeAddAgentModal !== 'function') return;
    
    var newName = prompt('Enter a name for the new preset:', activePresetName + ' (copy)');
    if (!newName || !newName.trim()) return;
    newName = newName.trim();
    
    var local = getWizardPresets();
    if (local.some(function(c) { return c.name === newName; }) || serverPresets.some(function(p) { return p.name === newName; })) {
        alert('A preset with that name already exists.');
        return;
    }
    
    var newData = collectFormValues();
    var toServer = confirm('Do you want to save this new preset to the SERVER?\n\n[OK] = Save to Server\n[Cancel] = Save Locally');
    
    if (toServer) {
        try {
            var res = await fetch('/api/wizard-presets/save', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id: 0, name: newName, data: JSON.stringify(newData) })
            });
            if (!res.ok) throw new Error(await res.text());
            var saved = await res.json();
            await fetchServerPresets();
            openServerPresetDetail(saved.id, saved.name);
            closeAddAgentModal();
            showPresetStatus('✓ New preset saved to server', 'ok');
        } catch(e) {
            alert('Failed to save to server: ' + e.message);
        }
    } else {
        local.unshift({ name: newName, data: newData, savedAt: new Date().toISOString() });
        saveWizardPresets(local);
        if (typeof renderSavedConfigsDropdown === 'function') renderSavedConfigsDropdown();
        openLocalPresetDetail(newName);
        closeAddAgentModal();
        showPresetStatus('✓ New preset saved locally', 'ok');
    }
}

function createLocalPreset() {
    if (typeof collectFormValues !== 'function' || typeof closeAddAgentModal !== 'function') return;
    var name = prompt('Enter a name for your new local preset:');
    if (!name || !name.trim()) return;
    name = name.trim();
    
    var local = getWizardPresets();
    if (local.some(function(c) { return c.name === name; }) || serverPresets.some(function(p) { return p.name === name; })) {
        alert('A preset with that name already exists.');
        return;
    }
    
    local.unshift({ name: name, data: collectFormValues(), savedAt: new Date().toISOString() });
    saveWizardPresets(local);
    if (typeof renderSavedConfigsDropdown === 'function') renderSavedConfigsDropdown();
    
    closeAddAgentModal();
    renderWizardPresets();
    openLocalPresetDetail(name);
}

async function createServerPreset() {
    if (typeof collectFormValues !== 'function' || typeof closeAddAgentModal !== 'function') return;
    var name = prompt('Enter a name for your new server preset:');
    if (!name || !name.trim()) return;
    name = name.trim();
    
    var local = getWizardPresets();
    if (local.some(function(c) { return c.name === name; }) || serverPresets.some(function(p) { return p.name === name; })) {
        alert('A preset with that name already exists.');
        return;
    }
    
    var btn = document.getElementById('modal-save-server');
    btn.disabled = true; btn.textContent = 'Saving…';
    
    try {
        var res = await fetch('/api/wizard-presets/save', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: 0, name: name, data: JSON.stringify(collectFormValues()) })
        });
        if (!res.ok) throw new Error(await res.text());
        var saved = await res.json();
        
        await fetchServerPresets();
        closeAddAgentModal();
        openServerPresetDetail(saved.id, saved.name);
    } catch(e) {
        alert('Failed to create server preset: ' + e.message);
    } finally {
        btn.disabled = false; btn.textContent = 'Save to Server';
    }
}

function showPresetStatus(msg, type) {
    var el = document.getElementById('preset-status-msg');
    if (!el) return;
    el.textContent = msg;
    el.className = 'push-status ' + (type || '');
    setTimeout(function () { el.textContent = ''; el.className = 'push-status'; }, 3500);
}
