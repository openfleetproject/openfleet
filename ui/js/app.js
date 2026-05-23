/**
 * app.js — Core: state, navigation, data, shared utilities
 * Depends on: panel.js, modal.js
 */

/* ─── Shared State (global so panel.js / modal.js can access) ── */
var agents            = [];
var activeAgentId     = null;
var refreshTimer      = null;
var waitTimer         = null;
var waitCountdown     = 0;
var agentsSnapshotIds = new Set();
window.githubVersions = { otel: '0.96.0', sup: '0.151.0' }; // fallbacks

/* ─── Init ─────────────────────────── */
document.addEventListener('DOMContentLoaded', function () {
    initNavigation();
    initDetailPanel();   // panel.js
    initAddAgentModal(); // modal.js
    initConfigsPage();   // configs.js
    initSettingsPage();  // settings.js

    // Apply saved settings on startup
    applySettings(getSettings());

    fetchAgents();
    fetchLatestGithubVersions();
});

/* ─── Dynamic OTEL Versions ────────────────── */
async function fetchLatestGithubVersions() {
    try {
        var response = await fetch('https://api.github.com/repos/open-telemetry/opentelemetry-collector-releases/releases?per_page=30');
        if (!response.ok) return;
        var releases = await response.json();
        
        var otel = releases.filter(function(r) { return /^v\d+\.\d+\.\d+$/.test(r.tag_name); });
        var sup  = releases.filter(function(r) { return /^cmd\/opampsupervisor\/v\d+\.\d+\.\d+$/.test(r.tag_name); });
        
        // Take n-1 if available, else 0
        if (otel.length > 1) window.githubVersions.otel = otel[1].tag_name.substring(1);
        else if (otel.length > 0) window.githubVersions.otel = otel[0].tag_name.substring(1);
        
        if (sup.length > 1) window.githubVersions.sup = sup[1].tag_name.replace('cmd/opampsupervisor/v', '');
        else if (sup.length > 0) window.githubVersions.sup = sup[0].tag_name.replace('cmd/opampsupervisor/v', '');
        
        // Update placeholders if settings inputs exist
        var oInput = document.getElementById('setting-default-otel-ver');
        if (oInput) oInput.placeholder = window.githubVersions.otel;
        var sInput = document.getElementById('setting-default-sup-ver');
        if (sInput) sInput.placeholder = window.githubVersions.sup;
    } catch (err) {
        console.error("Failed to fetch GitHub OTEL versions", err);
    }
}

/* ─── Navigation ─────────────────────────── */
function initNavigation() {
    document.querySelectorAll('.nav-link').forEach(function (link) {
        link.addEventListener('click', function (e) {
            e.preventDefault();
            navigateTo(this.dataset.page);
        });
    });

    // Restore active page from localStorage or default to overview
    var savedPage = localStorage.getItem('openfleet_active_page') || 'overview';
    navigateTo(savedPage);
}

function navigateTo(page) {
    document.querySelectorAll('.nav-link').forEach(function (l) { l.classList.remove('active'); });
    document.querySelectorAll('.page').forEach(function (p) { p.classList.remove('active'); });
    var navEl  = document.getElementById('nav-' + page);
    var pageEl = document.getElementById('page-' + page);
    if (navEl)  navEl.classList.add('active');
    if (pageEl) pageEl.classList.add('active');
    
    // Save to localStorage
    localStorage.setItem('openfleet_active_page', page);

    // Lazy-load page-specific data
    if (page === 'configs')   loadConfigsPage();
    if (page === 'settings')  loadServerInfo();
}

/* ─── Data Fetching ─────────────────────────── */
async function fetchAgents() {
    try {
        var res = await fetch('/api/agents');
        if (!res.ok) throw new Error('Failed to fetch agents');
        agents = await res.json() || [];
        renderDashboard(agents);
        renderAgentCheckboxes(); // update bulk-push checkboxes (configs.js)

        if (activeAgentId) {
            var agent = agents.find(function (a) { return a.id === activeAgentId; });
            if (agent) updatePanelHeader(agent);
        }
        if (waitTimer !== null) checkForNewAgent(agents); // modal.js
    } catch (err) {
        console.error(err);
        var errHtml = '<p style="color:#ef4444;padding:1rem">Error loading agents: ' + err.message + '</p>';
        ['overview-agents-container', 'agents-container'].forEach(function (id) {
            var el = document.getElementById(id);
            if (el) el.innerHTML = errHtml;
        });
    }
}

/* ─── Render Dashboard ─────────────────────────── */
function renderDashboard(agentList) {
    var online  = agentList.filter(function (a) { return a.status === 'online'; }).length;
    var offline = agentList.length - online;

    var statsEl = document.getElementById('top-stats');
    if (statsEl) {
        statsEl.innerHTML =
            statCard('Total Agents', agentList.length, '') +
            statCard('Online', online, 'online') +
            statCard('Offline', offline, 'offline');
    }

    var cardsHtml = agentList.length === 0
        ? '<div class="empty-state">' +
          '<svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/></svg>' +
          '<p>No agents connected yet.</p><span>Click "+ Add Agent" to deploy your first agent</span></div>'
        : agentList.map(buildAgentCard).join('');

    ['overview-agents-container', 'agents-container'].forEach(function (id) {
        var el = document.getElementById(id);
        if (el) el.innerHTML = cardsHtml;
    });
}

function statCard(title, value, cls) {
    return '<div class="stat-card"><div class="stat-title">' + title + '</div>' +
           '<div class="stat-value ' + cls + '">' + value + '</div></div>';
}

function buildAgentCard(agent) {
    var isOnline   = agent.status === 'online';
    var badgeClass = isOnline ? 'badge-online' : 'badge-offline';
    var dateStr    = new Date(agent.last_connected).toLocaleString();
    var displayName = agent.custom_name || agent.hostname || 'Unknown Host';
    return '<div class="agent-card" data-id="' + agent.id + '">' +
        '<div class="agent-header"><span class="agent-badge ' + badgeClass + '">' +
        '<span class="badge-dot"></span>' + agent.status + '</span></div>' +
        '<div class="agent-hostname">' + escapeHtml(displayName) + '</div>' +
        '<div class="agent-id">UID: ' + agent.id + '</div>' +
        '<div class="agent-meta"><span>OS: ' + (agent.os || 'N/A') + '</span><span>v' + (agent.version || '?') + '</span></div>' +
        '<div class="agent-meta"><span>Last Seen</span><span>' + dateStr + '</span></div>' +
        '<div class="card-footer"><span class="card-open-hint">Click to manage</span><span class="card-dot"></span></div>' +
        '</div>';
}

/* ─── Shared Utilities ─────────────────────────── */
function copyText(text, btn) {
    navigator.clipboard.writeText(text).then(function () {
        var orig = btn.innerHTML;
        btn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>';
        btn.classList.add('copied');
        setTimeout(function () { btn.innerHTML = orig; btn.classList.remove('copied'); }, 1800);
    }).catch(function () {
        var ta = document.createElement('textarea');
        ta.value = text;
        ta.style.cssText = 'position:fixed;opacity:0';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
    });
}

function escapeHtml(s) {
    if (!s) return '';
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}
