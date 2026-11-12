const $ = (id) => document.getElementById(id);
const escapeHTML = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        char
      ],
  );
const money = (cents) => `$${(cents / 100).toFixed(2)}`;
const timeText = (mins) =>
  mins >= 60
    ? `${Math.floor(mins / 60)}h ${String(mins % 60).padStart(2, "0")}m`
    : `${mins}m`;
const labels = {
  in_use: "In use",
  ready: "Ready",
  provisioning: "Provisioning",
  failed: "Failed",
  deprovisioned: "Deprovisioned",
};
const state = {
  status: "all",
  search: "",
  risk: false,
  sort: "attention",
  direction: "desc",
  lastData: null,
  drawerId: null,
  lastFocused: null,
  refreshing: false,
  hasLoaded: false,
  pendingRefresh: false,
  lastSuccess: null,
  drawerRequest: 0,
  mutating: new Set(),
};
const paths = {
  activity: '<path d="M3 12h4l3-8 4 16 3-8h4"/>',
  refresh:
    '<path d="M20 11a8 8 0 0 0-14-5L4 8M4 4v4h4M4 13a8 8 0 0 0 14 5l2-2M16 16h4v4"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/>',
  "arrow-right": '<path d="M5 12h14m-6-6 6 6-6 6"/>',
  "chevron-right": '<path d="m9 18 6-6-6-6"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  alert:
    '<path d="M12 9v4m0 4h.01M10.3 3.86 2.82 17a2 2 0 0 0 1.74 3h14.88a2 2 0 0 0 1.74-3L13.7 3.86a2 2 0 0 0-3.4 0Z"/>',
  info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4m0-4h.01"/>',
};
const icon = (name) =>
  `<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round">${paths[name] || paths.info}</svg>`;
for (const el of document.querySelectorAll("[data-icon]"))
  el.innerHTML = icon(el.dataset.icon);

let toastTimer;
let retryBatch = { count: 0, at: 0 };
function showToast(message, variant = "success", labId = null) {
  clearTimeout(toastTimer);
  if (labId) {
    const now = Date.now();
    retryBatch = {
      count: now - retryBatch.at < 4500 ? retryBatch.count + 1 : 1,
      at: now,
    };
    if (retryBatch.count > 1)
      message = `${retryBatch.count} labs queued for reprovisioning · latest ${labId}`;
  }
  const n = document.createElement("div");
  n.className = `toast ${variant === "error" ? "error" : ""}`;
  n.innerHTML = `${icon(variant === "error" ? "alert" : "check")}<span>${escapeHTML(message)}</span>`;
  $("toastRegion").replaceChildren(n);
  toastTimer = setTimeout(() => n.remove(), 4500);
}

async function api(path, options = {}) {
  const resp = await fetch(path, {
    cache: "no-store",
    signal: AbortSignal.timeout(10000),
    ...options,
  });
  let data;
  try {
    data = await resp.json();
  } catch {
    throw new Error(`Invalid server response (${resp.status})`);
  }
  if (!resp.ok)
    throw new Error(data?.error || `Request failed (${resp.status})`);
  return data;
}
function queryUrl() {
  const q = new URLSearchParams({
    state: state.status,
    search: state.search,
    risk: String(state.risk),
    sort: state.sort,
    direction: state.direction,
  });
  return `/api/dashboard?${q}`;
}
async function refresh({ quiet = false } = {}) {
  if (state.refreshing) {
    state.pendingRefresh = true;
    return;
  }
  state.refreshing = true;
  const requested = queryUrl();
  if (!quiet) $("refreshButton").disabled = true;
  $("tableShell").setAttribute("aria-busy", "true");
  try {
    const data = await api(requested);
    if (requested !== queryUrl()) {
      state.pendingRefresh = true;
      return;
    }
    state.lastData = data;
    state.hasLoaded = true;
    state.lastSuccess = Date.now();
    renderDashboard(data);
    $("connectionNotice").hidden = true;
    if (state.drawerId && !state.mutating.has(state.drawerId))
      await openDrawer(state.drawerId, { quiet: true });
  } catch (err) {
    if (requested !== queryUrl()) {
      state.pendingRefresh = true;
      return;
    }
    if (!state.hasLoaded) {
      $("environmentRows").innerHTML =
        `<tr><td colspan="7"><div class="empty-message"><strong>Cannot load the workshop</strong><p>${escapeHTML(err.message)}</p><button type="button" id="retryLoad">Try again</button></div></td></tr>`;
      $("retryLoad").addEventListener("click", () => refresh());
    }
    $("lastSynced").textContent = "Connection lost";
    $("connectionNotice").hidden = false;
    $("connectionNotice").textContent = state.hasLoaded
      ? "Updates paused. Showing data from " +
        new Date(state.lastSuccess).toLocaleTimeString() +
        ". Retrying automatically; you can also use Refresh."
      : "Unable to connect. Check the server and try again.";
    if (!quiet) showToast(`Refresh failed: ${err.message}`, "error");
  } finally {
    state.refreshing = false;
    $("refreshButton").disabled = false;
    $("tableShell").setAttribute("aria-busy", "false");
    if (state.pendingRefresh) {
      state.pendingRefresh = false;
      await refresh({ quiet: true });
    }
  }
}
function renderDashboard(data) {
  const s = data.session;
  $("activeStat").textContent = s.active;
  $("activeDetail").textContent = `${s.in_use} currently in use`;
  $("failedStat").textContent = s.failures;
  $("failedStat").classList.toggle("has-failures", s.failures > 0);
  $("spendStat").textContent = money(s.estimated_spend_cents);
  $("completionStat").textContent = `${s.average_completion_percent}%`;
  $("environmentCount").textContent = `${s.total}`;
  $("sessionSeats").textContent = s.total;
  $("lastSynced").textContent = "Synced just now";
  $("attentionCount").textContent = s.attention_count;
  $("tab-all").textContent = s.total;
  for (const key of Object.keys(s.states))
    $("tab-" + key).textContent = s.states[key];
  for (const t of document.querySelectorAll(".status-tab")) {
    const selected = t.dataset.status === state.status;
    t.classList.toggle("current", selected);
    t.setAttribute("aria-pressed", String(selected));
  }
  renderRows(data.environments, data.total_filtered);
  renderAttention(data.at_risk);
  if (state.overlay === "activity") renderActivity(data.events);
}
function renderRows(envs, total) {
  $("footerCount").textContent =
    `Showing ${envs.length} of ${state.lastData.session.total} environments${total < state.lastData.session.total ? " · filtered" : ""}`;
  if (!envs.length) {
    const hadFocus = $("environmentRows").contains(document.activeElement);
    $("environmentRows").innerHTML =
      `<tr><td colspan="7"><div class="empty-message"><span class="empty-icon">${icon("search")}</span><strong>No environments found</strong><p>Try a different search or clear your filters.</p><button id="clearFilters" type="button">Clear filters</button></div></td></tr>`;
    $("clearFilters").addEventListener("click", clearFilters);
    if (hadFocus) $("clearFilters").focus({ preventScroll: true });
    return;
  }
  const focused = document.activeElement;
  const focusedRow = focused?.closest("tr[data-id]");
  const focusId = focusedRow?.dataset.id;
  const focusKind = focused?.matches("[data-reprovision]")
    ? "[data-reprovision]"
    : focused?.matches("[data-details]")
      ? "[data-details]"
      : null;
  const scrollTop = $("tableShell").scrollTop;
  const html = envs
    .map((e) => {
      const riskClass =
        e.risk_level === "critical"
          ? "critical"
          : e.risk_level === "warning"
            ? "warning"
            : "";
      return `<tr data-id="${escapeHTML(e.id)}" tabindex="0" aria-label="View ${escapeHTML(e.learner_name)} lab details">
      <td><div class="learner-name">${escapeHTML(e.learner_name)}</div><div class="lab-id">${escapeHTML(e.id)} <span class="muted-bullet">·</span> ${escapeHTML(e.region)}</div></td>
      <td><span class="state-chip state-${escapeHTML(e.state)}"><span class="chip-dot"></span>${escapeHTML(labels[e.state])}</span></td>
      <td><div class="progress-cell"><span class="progress-number">${e.progress_percent}%</span><span class="progress-track" role="progressbar" aria-valuenow="${e.progress_percent}" aria-valuemin="0" aria-valuemax="100" aria-label="Lab progress"><span class="progress-fill ${e.state === "deprovisioned" ? "done" : ""}" style="width:${e.progress_percent}%"></span></span></div></td>
      <td title="${escapeHTML(e.step_name)}"><span class="step-text">${escapeHTML(e.step_name)}</span>${e.state === "in_use" ? `<span class="step-number">Step ${e.step_index + 1} of 8${e.needs_attention ? " · Needs attention" : ""}</span>` : ""}</td>
      <td><span class="time-text ${riskClass}">${e.state === "deprovisioned" ? "—" : timeText(e.step_minutes)}${e.needs_attention ? ' <span class="sr-only">Needs attention</span>' : ""}</span></td>
      <td class="spend-text">${money(e.estimated_spend_cents)}</td>
      <td class="action-cell">${e.state === "failed" ? `<button class="row-retry" data-reprovision="${escapeHTML(e.id)}" ${state.mutating.has(e.id) ? "disabled" : ""} aria-label="Reprovision ${escapeHTML(e.id)}" title="Reprovision failed lab ${escapeHTML(e.id)}">${state.mutating.has(e.id) ? "Retrying…" : "Retry"}</button>` : `<button class="row-more" data-details="${escapeHTML(e.id)}" aria-label="View ${escapeHTML(e.id)} details">${icon("chevron-right")}</button>`}</td></tr>`;
    })
    .join("");
  const template = document.createElement("template");
  template.innerHTML = "<table><tbody>" + html + "</tbody></table>";
  const body = $("environmentRows");
  const existing = new Map(
    [...body.querySelectorAll("tr[data-id]")].map((row) => [
      row.dataset.id,
      row,
    ]),
  );
  const wanted = new Set(envs.map((e) => e.id));
  for (const row of [...body.children])
    if (!wanted.has(row.dataset.id)) row.remove();
  let index = 0;
  for (const next of template.content.querySelectorAll("tr")) {
    const row = existing.get(next.dataset.id) || next;
    if (row !== next && row.innerHTML !== next.innerHTML) {
      const was = row.querySelector(".state-chip")?.textContent;
      row.innerHTML = next.innerHTML;
      if (was !== row.querySelector(".state-chip")?.textContent) {
        row.classList.add("row-changed");
        setTimeout(() => row.classList.remove("row-changed"), 1250);
      }
    }
    if (body.children[index] !== row)
      body.insertBefore(row, body.children[index] || null);
    index++;
  }
  if (focusId) {
    const row =
      [...body.children].find((r) => r.dataset.id === focusId) ||
      body.firstElementChild;
    const target = (focusKind && row?.querySelector(focusKind)) || row;
    if (target && document.activeElement !== target)
      target.focus({ preventScroll: true });
  }
  $("tableShell").scrollTop = scrollTop;
}
function renderAttention(items) {
  const focusedId = document.activeElement?.dataset?.riskId;
  $("attentionList").innerHTML = items.length
    ? items
        .map(
          (e) =>
            `<button type="button" class="attention-item" data-risk-id="${escapeHTML(e.id)}"><span class="attention-marker ${e.risk_level === "critical" ? "critical" : ""}"></span><span class="attention-info"><span class="attention-name"><span>${escapeHTML(e.learner_name)}</span><span>${timeText(e.step_minutes)}</span></span><span class="attention-reason">${escapeHTML(e.risk_reasons[0] || "Review required")}</span></span></button>`,
        )
        .join("")
    : '<p class="rail-description">No learners are currently flagged.</p>';
  if (focusedId) {
    const buttons = [...$("attentionList").querySelectorAll("button")];
    (
      buttons.find((b) => b.dataset.riskId === focusedId) ||
      buttons[0] ||
      $("viewAllRisks")
    ).focus({ preventScroll: true });
  }
}
function timeAgo(iso) {
  const m = Math.max(
    0,
    Math.round((Date.now() - new Date(iso).getTime()) / 60000),
  );
  return m < 1
    ? "Just now"
    : m < 60
      ? `${m} min ago`
      : `${Math.floor(m / 60)}h ago`;
}
function renderActivity(events) {
  const list = $("activityList");
  if (!list) return;
  list.innerHTML =
    events
      .map(
        (e) =>
          `<div class="activity-item ${escapeHTML(e.type)}"><strong>${escapeHTML(e.learner_name)} <span class="lab-ref">${escapeHTML(e.environment_id)}</span></strong><p>${escapeHTML(e.message)}</p><time datetime="${escapeHTML(e.created_at)}">${timeAgo(e.created_at)}</time></div>`,
      )
      .join("") || '<p class="rail-description">No events yet.</p>';
}
function clearFilters() {
  state.status = "all";
  state.search = "";
  state.risk = false;
  state.sort = "attention";
  state.direction = "desc";
  $("searchInput").value = "";
  $("riskToggle").checked = false;
  $("sortSelect").value = "attention:desc";
  refresh();
}
let searchTimer;
$("searchInput").addEventListener("input", (e) => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    state.search = e.target.value;
    refresh({ quiet: true });
  }, 200);
});
$("riskToggle").addEventListener("change", (e) => {
  state.risk = e.target.checked;
  refresh({ quiet: true });
});
$("sortSelect").addEventListener("change", (e) => {
  [state.sort, state.direction] = e.target.value.split(":");
  refresh({ quiet: true });
});
for (const t of document.querySelectorAll(".status-tab"))
  t.addEventListener("click", () => {
    state.status = t.dataset.status;
    refresh({ quiet: true });
  });
$("refreshButton").addEventListener("click", () => refresh());
$("viewAllRisks").addEventListener("click", () => {
  state.risk = true;
  state.status = "all";
  $("riskToggle").checked = true;
  document.querySelector("#environments").scrollIntoView({ behavior: "auto" });
  refresh({ quiet: true });
});
$("triageButton").addEventListener("click", openTriage);
$("guideButton").addEventListener("click", openGuide);
$("activityButton").addEventListener("click", openActivity);
$("environmentRows").addEventListener("click", (e) => {
  const retry = e.target.closest("[data-reprovision]");
  if (retry) {
    e.stopPropagation();
    reprovisionLab(retry.dataset.reprovision, retry);
    return;
  }
  const details = e.target.closest("[data-details]");
  if (details) {
    openDrawer(details.dataset.details);
    return;
  }
  const row = e.target.closest("tr[data-id]");
  if (row) openDrawer(row.dataset.id);
});
$("environmentRows").addEventListener("keydown", (e) => {
  if (
    e.target.matches("tr[data-id]") &&
    ["ArrowUp", "ArrowDown", "Home", "End"].includes(e.key)
  ) {
    e.preventDefault();
    const rows = [...$("environmentRows").querySelectorAll("tr[data-id]")];
    const index = rows.indexOf(e.target);
    const next =
      e.key === "Home"
        ? 0
        : e.key === "End"
          ? rows.length - 1
          : Math.max(
              0,
              Math.min(
                rows.length - 1,
                index + (e.key === "ArrowDown" ? 1 : -1),
              ),
            );
    rows[next]?.focus();
    return;
  }
  if ((e.key === "Enter" || e.key === " ") && e.target.matches("tr[data-id]")) {
    e.preventDefault();
    openDrawer(e.target.dataset.id);
  }
});
$("attentionList").addEventListener("click", (e) => {
  const b = e.target.closest("[data-risk-id]");
  if (b) openDrawer(b.dataset.riskId);
});
async function reprovisionLab(id, btn) {
  if (state.mutating.has(id)) return false;
  state.mutating.add(id);
  const restoreDrawerFocus =
    state.drawerId === id && btn === document.activeElement;
  if (btn) {
    btn.disabled = true;
    btn.textContent = "Retrying…";
  }
  try {
    await api(`/api/environments/${encodeURIComponent(id)}/reprovision`, {
      method: "POST",
    });
    showToast(`${id} queued for reprovisioning.`, "success", id);
    await refresh({ quiet: true });
    return true;
  } catch (err) {
    showToast(err.message, "error");
    if (btn) {
      btn.disabled = false;
      btn.textContent = "Retry";
    }
    return false;
  } finally {
    state.mutating.delete(id);
    if (state.drawerId === id) {
      await openDrawer(id, { quiet: true });
      if (restoreDrawerFocus)
        (
          $("drawerRetry") || $("drawerHost").querySelector("[data-close]")
        )?.focus({ preventScroll: true });
    }
  }
}
function backdrop(hostId, html, kind = "overlay") {
  const active = document.activeElement;
  const replacingDialog = !!active?.closest('[role="dialog"]');
  const opener = replacingDialog ? state.lastFocused : active;
  const rowId = replacingDialog
    ? state.lastFocusId
    : active?.closest("tr[data-id]")?.dataset.id;
  const riskId = replacingDialog ? state.lastRiskId : active?.dataset?.riskId;
  closeOverlay({ restoreFocus: false });
  state.lastFocused = opener;
  state.lastFocusId = rowId;
  state.lastRiskId = riskId;
  const host = $(hostId);
  host.innerHTML = `<div class="${kind}" data-backdrop="true">${html}</div>`;
  const layer = host.firstElementChild;
  layer.addEventListener("click", (e) => {
    if (e.target === layer) closeOverlay();
  });
  layer.querySelector("[data-close]")?.addEventListener("click", closeOverlay);
  document.querySelector(".main-wrap").inert = true;
  layer.querySelector("[data-close]")?.focus();
}
function closeOverlay({ restoreFocus = true } = {}) {
  const hadOverlay = !!document.querySelector('[role="dialog"]');
  const opener = state.lastFocused,
    rowId = state.lastFocusId,
    riskId = state.lastRiskId;
  state.lastFocused = null;
  state.lastFocusId = null;
  state.lastRiskId = null;
  for (const id of ["drawerHost", "triageHost"]) $(id).innerHTML = "";
  state.drawerId = null;
  state.overlay = null;
  state.drawerRequest++;
  document.querySelector(".main-wrap").inert = false;
  if (!restoreFocus || !hadOverlay) return;
  if (opener?.isConnected) opener.focus({ preventScroll: true });
  else {
    const target =
      [...document.querySelectorAll("tr[data-id]")].find(
        (e) => e.dataset.id === rowId,
      ) ||
      [...document.querySelectorAll("[data-risk-id]")].find(
        (e) => e.dataset.riskId === riskId,
      );
    (
      target ||
      $("environmentRows").querySelector("tr[data-id]") ||
      $("clearFilters") ||
      $("searchInput")
    )?.focus({ preventScroll: true });
  }
}
document.addEventListener("keydown", (e) => {
  if (
    e.key === "Escape" &&
    ($("drawerHost").childElementCount || $("triageHost").childElementCount)
  ) {
    e.preventDefault();
    closeOverlay();
  }
  if (e.key !== "Tab") return;
  const overlay = document.querySelector(".overlay,.modal-overlay");
  if (!overlay) return;
  const focusable = [
    ...overlay.querySelectorAll(
      'button:not([disabled]),a[href],input:not([disabled]),select:not([disabled]),[tabindex="0"]',
    ),
  ];
  if (!focusable.length) return;
  const first = focusable[0],
    last = focusable.at(-1);
  if (e.shiftKey && document.activeElement === first) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && document.activeElement === last) {
    e.preventDefault();
    first.focus();
  }
});
async function openDrawer(id, { quiet = false } = {}) {
  const request = ++state.drawerRequest;
  try {
    const e = await api(`/api/environments/${encodeURIComponent(id)}`);
    if (request !== state.drawerRequest || (quiet && state.drawerId !== id))
      return;
    const circles = e.steps
      .map((step, index) => {
        const done = e.state === "deprovisioned" || index < e.step_index;
        const current = e.state !== "deprovisioned" && index === e.step_index;
        return `<div class="step-entry ${done ? "completed" : current ? "current" : ""}"><span class="step-circle">${done ? icon("check") : index + 1}</span>${escapeHTML(step)}</div>`;
      })
      .join("");
    const html = `<section class="drawer" role="dialog" aria-modal="true" aria-labelledby="drawerTitle"><header class="drawer-top"><div><div class="section-kicker">ENVIRONMENT / ${escapeHTML(e.id)}</div><h2 id="drawerTitle">${escapeHTML(e.learner_name)}</h2><p class="drawer-sub">${escapeHTML(e.learner_email)}</p></div><button data-close class="icon-button" aria-label="Close lab details">${icon("x")}</button></header><div class="drawer-body"><div class="drawer-status-row"><span class="state-chip state-${escapeHTML(e.state)}"><span class="chip-dot"></span>${escapeHTML(labels[e.state])}</span><span class="time-text ${e.risk_level === "critical" ? "critical" : ""}">${e.state === "deprovisioned" ? "Completed" : timeText(e.step_minutes) + (e.state === "in_use" ? " on step" : " in state")}</span></div><div class="drawer-section"><h3>ENVIRONMENT DETAILS</h3><dl class="detail-grid"><div><dt>Environment</dt><dd>${escapeHTML(e.id)}</dd></div><div><dt>Azure region</dt><dd>${escapeHTML(e.region)}</dd></div><div><dt>Completed</dt><dd>${e.progress_percent}%</dd></div><div><dt>Est. spend</dt><dd>${money(e.estimated_spend_cents)}</dd></div><div><dt>Runtime</dt><dd>${e.runtime_minutes} min</dd></div><div><dt>Hourly rate</dt><dd>${money(e.hourly_rate_cents)}/hr</dd></div></dl></div>${e.needs_attention ? `<div class="drawer-warning" role="note">${icon("alert")} ${escapeHTML(e.risk_reasons.join(" · "))}</div>` : ""}<div class="drawer-section"><h3>WORKSHOP PROGRESS</h3><div class="step-timeline">${circles}</div></div>${e.state === "failed" ? `<button id="drawerRetry" class="button button-danger drawer-button">${icon("refresh")} Reprovision environment</button>` : ""}<div class="drawer-section"><h3>EVENT HISTORY</h3>${e.events.map((event) => `<div class="history-row"><strong>${escapeHTML(event.message)}</strong><small>${new Date(event.created_at).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}</small></div>`).join("") || '<p class="drawer-sub">No events available.</p>'}</div></div></section>`;
    if (quiet) {
      const host = $("drawerHost");
      const active = document.activeElement;
      const selector = active?.id
        ? "#" + active.id
        : active?.matches("[data-close]")
          ? "[data-close]"
          : null;
      const scroll = host.querySelector(".drawer-body")?.scrollTop || 0;
      const template = document.createElement("template");
      template.innerHTML = html;
      const drawer = host.querySelector(".drawer");
      if (!drawer) return;
      drawer.innerHTML = template.content.firstElementChild.innerHTML;
      drawer
        .querySelector("[data-close]")
        .addEventListener("click", closeOverlay);
      drawer.querySelector(".drawer-body").scrollTop = scroll;
      if (selector)
        (
          drawer.querySelector(selector) || drawer.querySelector("[data-close]")
        )?.focus({ preventScroll: true });
    } else backdrop("drawerHost", html);
    state.drawerId = id;
    $("drawerRetry")?.addEventListener("click", () =>
      reprovisionLab(id, $("drawerRetry")),
    );
  } catch (err) {
    if (!quiet) showToast(`Cannot load lab: ${err.message}`, "error");
  }
}
function openActivity() {
  const html = `<section class="drawer" role="dialog" aria-modal="true" aria-labelledby="activityTitle"><header class="drawer-top"><div><div class="section-kicker">Workshop history</div><h2 id="activityTitle">Recent activity</h2><p class="drawer-sub">Latest environment changes across the session.</p></div><button data-close class="icon-button" aria-label="Close activity">${icon("x")}</button></header><div class="drawer-body" id="activityList"></div></section>`;
  backdrop("drawerHost", html);
  state.overlay = "activity";
  renderActivity(state.lastData?.events || []);
}
async function openTriage() {
  const html = `<section class="modal" role="dialog" aria-modal="true" aria-labelledby="triageTitle"><header class="modal-header"><div><div class="section-kicker">Instructor triage</div><h2 id="triageTitle">At-risk assessment</h2><p>A snapshot of learners who may need help.</p></div><button data-close class="icon-button" aria-label="Close assessment">${icon("x")}</button></header><div class="assessment-meta" id="assessmentMeta" role="status">Checking current signals…</div><div class="modal-content" id="triageContent"></div><footer class="modal-footer"><button id="triageClose" class="button button-muted">Close</button><button id="triageReload" class="button button-dark">Reassess</button></footer></section>`;
  backdrop("triageHost", html, "overlay modal-overlay");
  $("triageClose").addEventListener("click", closeOverlay);
  $("triageReload").addEventListener("click", loadTriage);
  await loadTriage();
}
async function loadTriage() {
  const panel = $("triageContent"),
    meta = $("assessmentMeta");
  if (!panel) return;
  $("triageReload").disabled = true;
  meta.textContent = "Checking current signals…";
  panel.innerHTML =
    '<div class="loading-message"><span class="loading-spinner" aria-hidden="true"></span>Assessing workshop signals…</div>';
  try {
    const result = await api("/api/insights", { method: "POST" });
    if (!panel.isConnected) return;
    meta.innerHTML = `<div class="insight-mode"><strong>${escapeHTML(result.label)}</strong><span>${escapeHTML(result.note)}</span><br/><time datetime="${escapeHTML(result.assessed_at)}">Assessed at ${new Date(result.assessed_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</time> · Reassess for current signals.</div>`;
    panel.innerHTML = `<div class="insight-headline">${escapeHTML(result.headline)}</div><p class="insight-summary">${escapeHTML(result.summary)}</p><div class="insight-label">${result.mode === "model" ? "Suggested focus" : "Recommended priorities"}</div>${result.actions.map((a, i) => `<div class="triage-result"><div><strong>${i + 1}. ${escapeHTML(a.learner)} <span class="lab-ref">${escapeHTML(a.id)}</span></strong><p>${escapeHTML(a.reason)}</p></div><button type="button" data-quick-open="${escapeHTML(a.id)}" aria-label="View ${escapeHTML(a.id)} details">Details</button></div>`).join("") || '<p class="rail-description">No learners need intervention.</p>'}`;
    panel
      .querySelectorAll("[data-quick-open]")
      .forEach((b) =>
        b.addEventListener("click", () => openDrawer(b.dataset.quickOpen)),
      );
  } catch (err) {
    if (!panel.isConnected) return;
    meta.textContent =
      "Assessment unavailable. Manual filters and the attention queue are still available.";
    panel.innerHTML = `<div class="empty-message"><strong>Cannot load assessment</strong><p>${escapeHTML(err.message)}</p></div>`;
  } finally {
    if (panel.isConnected) $("triageReload").disabled = false;
  }
}
function openGuide() {
  const html = `<section class="modal" role="dialog" aria-modal="true" aria-labelledby="guideTitle"><header class="modal-header"><div><div class="section-kicker">Quick reference</div><h2 id="guideTitle">Instructor guide</h2><p>How to read the monitor and help a learner.</p></div><button data-close class="icon-button" aria-label="Close guide">${icon("x")}</button></header><div class="modal-content"><dl class="guide-list"><div><dt>Start with failures and long waits</dt><dd>The default order puts failed labs first. A learner on a step for 20+ minutes is flagged for review; 40+ minutes is critical. Provisioning for 12+ minutes and two or more retries also need attention. These are signals to investigate, not proof a learner is stuck.</dd></div><div><dt>Review, then retry</dt><dd>Open a learner to inspect the failure and history. Retry is available for failed labs and starts provisioning again. Current lab progress resets, while earlier spend is retained. Repeated failures may need instructor investigation.</dd></div><div><dt>Read session-wide totals</dt><dd>Active means ready or in use. Summary numbers always cover the whole workshop, even when the table is filtered. Spend is an estimate of hourly rate × runtime across attempts. Completed, deprovisioned labs stop accruing spend.</dd></div><div><dt>Use the assessment as a shortlist</dt><dd>The at-risk assessment is optional. Its mode and timestamp are shown at the top. When the model is unavailable, explicit rules and manual filters remain available. Reassess to capture fresh signals.</dd></div></dl></div><footer class="modal-footer"><button id="guideClose" class="button button-dark">Got it</button></footer></section>`;
  backdrop("triageHost", html, "overlay modal-overlay");
  $("guideClose").addEventListener("click", closeOverlay);
}
refresh();
setInterval(() => refresh({ quiet: true }), 5000);
