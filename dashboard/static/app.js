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
  };

  tabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      const name = tab.dataset.tab;
      tabs.forEach((t) => t.setAttribute("aria-selected", t === tab ? "true" : "false"));
      Object.entries(panels).forEach(([k, p]) => p.setAttribute("aria-hidden", k === name ? "false" : "true"));
      if (name === "schedule") loadSchedule();
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
        list.innerHTML = `<li class="dim">No tasks yet. Create one in the vault's Projects/AgentOS/tasks/ folder.</li>`;
      } else {
        list.innerHTML = recent.map((t) => `
          <li class="task-item" data-phase="${t.phase}">
            <div class="task-title">${escapeHtml(t.title)}</div>
            <div class="task-meta">
              <span>${t.assigned_to}</span>
              <span>·</span>
              <span>${t.phase}</span>
            </div>
          </li>
        `).join("");
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

  // -------- Bootstrap --------
  pollMetrics();
  loadAgents();
  setInterval(pollMetrics, 2000);
  setInterval(loadAgents, 15000);  // agents/tasks change less often
})();
