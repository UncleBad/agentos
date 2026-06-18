/* AgentOS Dashboard — frontend logic
 * Vanilla JS, no build step, no framework.
 * Tabs, polling, and DOM updates only.
 */

(() => {
  "use strict";

  // -------- Tabs --------
  const tabs = document.querySelectorAll(".tab");
  const panels = {
    dashboard: document.getElementById("panel-dashboard"),
    schedule:  document.getElementById("panel-schedule"),
    routing:   document.getElementById("panel-routing"),
  };

  tabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      const name = tab.dataset.tab;
      tabs.forEach((t) => t.setAttribute("aria-selected", t === tab ? "true" : "false"));
      Object.entries(panels).forEach(([k, p]) => p.setAttribute("aria-hidden", k === name ? "false" : "true"));
      if (name === "schedule") loadSchedule();
      if (name === "routing") loadRouting();
    });
  });

  // -------- Formatters --------
  function fmtPercent(n) { return `${n.toFixed(1)}%`; }
  function fmtUptime(seconds) {
    const d = Math.floor(seconds / 86400);
    const h = Math.floor((seconds % 86400) / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    if (d > 0) return `${d}d ${h}h ${m}m`;
    if (h > 0) return `${h}h ${m}m`;
    return `${m}m`;
  }
  function fmtTimestamp(d) {
    return d.toTimeString().slice(0, 8);  // HH:MM:SS
  }
  function thresholdClass(pct) {
    if (pct >= 90) return "bad";
    if (pct >= 70) return "warn";
    return "";
  }

  /** Format a Date as a short weekday + day + month + year, e.g. "Tue 16 Jun 2026". */
  function fmtDate(d) {
    return d.toLocaleDateString("en-GB", {
      weekday: "short", day: "2-digit", month: "short", year: "numeric",
    });
  }

  function fmtLocalTime(d) {
    return d.toLocaleTimeString("en-US", { hour12: false });
  }

  /**
   * Map task phase → Starfleet-style log classification.
   */
  function classifyTask(phase) {
    switch (phase) {
      case "in-progress": return { tag: "PRIORITY",   cls: "log-priority" };
      case "blocked":     return { tag: "STAND-BY",   cls: "log-standby" };
      case "failed":      return { tag: "ALERT",      cls: "log-alert" };
      case "done":        return { tag: "COMPLETED",  cls: "log-completed" };
      default:            return { tag: "ROUTINE",    cls: "log-routine" };
    }
  }

  // -------- Metrics polling --------
  const pulse = document.getElementById("pulse");
  const lastUpdate = document.getElementById("last-update");
  const uptimeEl = document.getElementById("uptime");
  const shipStatus = document.getElementById("ship-status");
  const shipStatusLabel = shipStatus?.querySelector(".ship-status-label");
  const brandMark = document.querySelector(".brand-mark");

  async function pollMetrics() {
    try {
      const res = await fetch("/api/metrics");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const m = await res.json();
      renderMetrics(m);
      pulse.classList.remove("stale");
    } catch (e) {
      console.error("metrics poll failed:", e);
      pulse.classList.add("stale");
    }
  }

  function renderMetrics(m) {
    // Memory
    setMetric("memory", m.memory.percent, fmtPercent(m.memory.percent),
      `${m.memory.used_gb} GB / ${m.memory.total_gb} GB used · ${m.memory.available_gb} GB available`);

    // CPU
    setMetric("cpu", m.cpu.percent, fmtPercent(m.cpu.percent),
      `Load: ${m.cpu.load_pct["1m"]}% / ${m.cpu.load_pct["5m"]}% / ${m.cpu.load_pct["15m"]}% · ${m.cpu.cores} cores`);

    // Storage
    setMetric("storage", m.storage.percent, fmtPercent(m.storage.percent),
      `${m.storage.used_gb} GB / ${m.storage.total_gb} GB used · ${m.storage.free_gb} GB free`);

    // Footer
    uptimeEl.textContent = `uptime ${fmtUptime(m.uptime_seconds)}`;
    lastUpdate.textContent = `Last update: ${fmtTimestamp(new Date())}`;

    // Ship status pill: green/amber/red based on worst metric
    if (shipStatus) {
      const pcts = [m.memory.percent, m.cpu.percent, m.storage.percent];
      const worst = Math.max(...pcts);
      let level, label;
      if (worst >= 90)      { level = "alert";    label = "ALERT"; }
      else if (worst >= 70) { level = "caution";  label = "CAUTION"; }
      else                  { level = "nominal";  label = "NOMINAL"; }
      shipStatus.setAttribute("data-status", level);
      if (shipStatusLabel) shipStatusLabel.textContent = label;
      // Mirror status on the brand-mark so the ship silhouette changes color
      if (brandMark) brandMark.setAttribute("data-status", level);
    }
  }

  function setMetric(name, pct, valueText, detailText) {
    // name is the data-metric value in the HTML: "memory" | "cpu" | "storage"
    const card = document.querySelector(`[data-metric="${name}"]`);
    if (!card) return;
    card.classList.remove("warn", "bad");
    const cls = thresholdClass(pct);
    if (cls) card.classList.add(cls);
    // ID prefix is a short form: "mem" | "cpu" | "stor"
    const idPrefix = { memory: "mem", cpu: "cpu", storage: "stor" }[name];
    document.getElementById(`${idPrefix}-value`).textContent = valueText;
    document.getElementById(`${idPrefix}-bar`).style.width = `${Math.min(pct, 100)}%`;
    document.getElementById(`${idPrefix}-detail`).textContent = detailText;
  }

  // -------- Agents + tasks --------
  async function loadAgents() {
    try {
      const res = await fetch("/api/agents");
      if (!res.ok) return;
      const data = await res.json();

      // Persona excerpts
      data.agents.forEach((a) => {
        const card = document.querySelector(`[data-agent="${a.slug}"]`);
        if (!card) return;
        card.querySelector(".agent-excerpt").textContent = a.persona_excerpt || "(no excerpt)";
      });

      // Task counts per agent
      const counts = { ferret: 0, scribe: 0, dev: 0, captain: 0 };
      data.tasks.forEach((t) => {
        if (counts[t.assigned_to] !== undefined) counts[t.assigned_to]++;
        else counts.captain++;  // unknown assigned_to falls to Captain
      });
      Object.entries(counts).forEach(([slug, n]) => {
        const el = document.querySelector(`[data-task-count="${slug}"]`);
        if (el) el.textContent = `${n} task${n === 1 ? "" : "s"}`;
      });

      // Recent tasks (latest 10)
      const list = document.getElementById("task-list");
      const recent = [...data.tasks]
        .sort((a, b) => (b.created || "").localeCompare(a.created || ""))
        .slice(0, 10);

      if (recent.length === 0) {
        list.innerHTML = `<li class="dim log-empty">No recent activity yet.<br><span class="dim">Tasks are recorded automatically when they begin.</span></li>`;
      } else {
        list.innerHTML = recent.map((t) => {
          const c = classifyTask(t.phase);
          const taskDate = t.created ? fmtDate(new Date(t.created)) : "";
          return `
          <li class="log-entry" data-phase="${t.phase}">
            <div class="log-meta">
              <span class="log-date">${taskDate}</span>
              <span class="log-classification ${c.cls}">${c.tag}</span>
            </div>
            <div class="log-title">${escapeHtml(t.title)}</div>
            <div class="log-byline">${escapeHtml(t.assigned_to)}</div>
          </li>
        `;
        }).join("");
      }
    } catch (e) {
      console.error("agents load failed:", e);
    }
  }

  // -------- Schedule --------
  async function loadSchedule() {
    try {
      const res = await fetch("/api/schedule");
      if (!res.ok) return;
      const data = await res.json();
      renderCronList("system-cron", data.system_cron, renderSystemCronRow);
      renderCronList("hermes-cron", data.hermes_cron, renderHermesCronRow);
    } catch (e) {
      console.error("schedule load failed:", e);
    }
  }

  function renderCronList(targetId, jobs, rowRenderer) {
    const el = document.getElementById(targetId);
    if (!jobs || jobs.length === 0) {
      el.innerHTML = `<p class="cron-empty">No jobs configured.</p>`;
      return;
    }
    el.innerHTML = `
      <table class="cron-table">
        <thead>${getHeaderFor(targetId)}</thead>
        <tbody>${jobs.map(rowRenderer).join("")}</tbody>
      </table>
    `;
  }

  function getHeaderFor(targetId) {
    if (targetId === "system-cron") {
      return `<tr><th>Schedule</th><th>Command</th><th>Source</th></tr>`;
    }
    return `<tr><th>Name</th><th>Schedule</th><th>Next run</th></tr>`;
  }

  function renderSystemCronRow(j) {
    return `<tr>
      <td><code>${escapeHtml(j.schedule)}</code></td>
      <td>${escapeHtml(j.command)}</td>
      <td class="dim">${escapeHtml(j.source)}</td>
    </tr>`;
  }

  function renderHermesCronRow(j) {
    return `<tr>
      <td>${escapeHtml(j.name || j.id)}</td>
      <td><code>${escapeHtml(j.schedule)}</code></td>
      <td class="dim">${escapeHtml(j.next_run || "—")}</td>
    </tr>`;
  }

  // -------- Routing (freellmapi gateway) --------
  async function loadRouting() {
    try {
      const res = await fetch("/api/routing");
      if (!res.ok) return;
      const data = await res.json();
      renderRouting(data);
    } catch (e) {
      console.error("routing load failed:", e);
    }
  }

  function renderRouting(data) {
    // Gateway status
    const dot = document.getElementById("gateway-status-dot");
    const label = document.getElementById("gateway-status-label");
    const total = document.getElementById("gateway-total");
    if (dot) dot.setAttribute("data-status", data.gateway_status);
    if (label) label.textContent = data.gateway_status === "online" ? "Online" : "Offline";
    if (total) total.textContent = `${data.total_requests} requests`;

    // Provider stats
    const psEl = document.getElementById("provider-stats");
    if (psEl) {
      if (!data.provider_stats || data.provider_stats.length === 0) {
        psEl.innerHTML = `<p class="dim">No provider activity yet.</p>`;
      } else {
        const rows = data.provider_stats.map((p) => `
          <tr>
            <td>${escapeHtml(p.platform)}</td>
            <td>${p.count}</td>
            <td>${p.avg_latency ? Math.round(p.avg_latency) + "ms" : "—"}</td>
            <td class="dim">${escapeHtml(p.last_seen || "—")}</td>
          </tr>
        `).join("");
        psEl.innerHTML = `
          <table class="cron-table">
            <thead><tr><th>Provider</th><th>Requests</th><th>Avg Latency</th><th>Last Seen</th></tr></thead>
            <tbody>${rows}</tbody>
          </table>
        `;
      }
    }

    // Recent requests
    const rrEl = document.getElementById("recent-requests");
    if (rrEl) {
      if (!data.recent_requests || data.recent_requests.length === 0) {
        rrEl.innerHTML = `<p class="dim">No requests yet.</p>`;
      } else {
        const rows = data.recent_requests.map((r) => {
          const statusCls = r.status === "success" ? "" : "warn";
          return `
          <tr>
            <td class="dim">${escapeHtml(r.created_at || "—")}</td>
            <td>${escapeHtml(r.platform)}</td>
            <td>${escapeHtml(r.model_id || "—")}</td>
            <td>${r.input_tokens || 0}/${r.output_tokens || 0}</td>
            <td>${r.latency_ms ? r.latency_ms + "ms" : "—"}</td>
            <td class="${statusCls}">${escapeHtml(r.status)}</td>
          </tr>
          `;
        }).join("");
        rrEl.innerHTML = `
          <table class="cron-table">
            <thead><tr><th>Time</th><th>Provider</th><th>Model</th><th>Tokens In/Out</th><th>Latency</th><th>Status</th></tr></thead>
            <tbody>${rows}</tbody>
          </table>
        `;
      }
    }

    // Rate limited
    const rlEl = document.getElementById("rate-limited");
    if (rlEl) {
      if (!data.rate_limited || data.rate_limited.length === 0) {
        rlEl.innerHTML = `<p class="dim">No active rate limits.</p>`;
      } else {
        const rows = data.rate_limited.map((r) => `
          <tr>
            <td>${escapeHtml(r.platform)}</td>
            <td>${escapeHtml(r.model_id || "—")}</td>
            <td class="dim">${escapeHtml(r.created_at || "—")}</td>
          </tr>
        `).join("");
        rlEl.innerHTML = `
          <table class="cron-table">
            <thead><tr><th>Provider</th><th>Model</th><th>Since</th></tr></thead>
            <tbody>${rows}</tbody>
          </table>
        `;
      }
    }
  }

  // -------- Utils --------
  function escapeHtml(s) {
    if (s == null) return "";
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  // -------- Bridge clock (now showing real date + time) --------
  const dateEl = document.getElementById("current-date");
  const timeEl = document.getElementById("current-time");

  function tickClock() {
    const now = new Date();
    if (dateEl) dateEl.textContent = fmtDate(now);
    if (timeEl) timeEl.textContent = fmtLocalTime(now);
  }

  // -------- Bootstrap --------
  tickClock();
  pollMetrics();
  loadAgents();
  loadRouting();
  setInterval(tickClock, 1000);
  setInterval(pollMetrics, 10000);  // ship's overall progress, no need to tick faster than this
  setInterval(loadAgents, 10000);   // agents/tasks — match metrics polling
  setInterval(loadRouting, 10000);  // routing — match metrics polling
})();
