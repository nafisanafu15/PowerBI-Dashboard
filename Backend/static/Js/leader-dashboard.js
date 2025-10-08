// static/js/leader-dashboard.js
async function fetchJSON(url) {
  const res = await fetch(url, { credentials: "same-origin" });
  if (!res.ok) throw new Error("HTTP " + res.status + " @ " + url);
  return res.json();
}

function pick(o, ...names) {
  for (const n of names) if (o && o[n] != null) return o[n];
  return null;
}

const palette = ["#FF6384", "#36A2EB", "#FFCE56", "#4BC0C0", "#9966FF"];
const STATUS_COLOR_RAMP = [
  "#2563eb",
  "#22c55e",
  "#f97316",
  "#ec4899",
  "#facc15",
  "#0ea5e9",
  "#a855f7",
];
const VISA_COLOR_RAMP = [
  "#0ea5e9",
  "#10b981",
  "#f97316",
  "#6366f1",
  "#facc15",
  "#ef4444",
  "#14b8a6",
];
const STORYBOARD_FALLBACK = "AI insight is not available right now.";
const STORYBOARD_THEMES = ["blue", "orange", "green", "purple", "teal", "slate"];

function toNumber(value) {
  if (value == null || value === "") return 0;
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value === "string") {
    const cleaned = value.replace(/[$,]/g, "");
    const parsed = Number(cleaned);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function parseDateLike(value) {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value === "number" && Number.isFinite(value)) {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const primary = new Date(trimmed);
  if (!Number.isNaN(primary.getTime())) return primary;
  const fallback = new Date(trimmed.replace(/-/g, "/"));
  if (!Number.isNaN(fallback.getTime())) return fallback;
  return null;
}

function startOfMonth(date) {
  const d = new Date(date.getTime());
  d.setDate(1);
  d.setHours(0, 0, 0, 0);
  return d;
}

function buildMonthSeries(count) {
  const base = new Date();
  const first = startOfMonth(base);
  const months = [];
  for (let i = 0; i < count; i += 1) {
    const d = new Date(first.getTime());
    d.setMonth(first.getMonth() + i);
    months.push(d);
  }
  return months;
}

function deriveForecastMonths(rows, count = 12) {
  if (!Array.isArray(rows) || !rows.length) {
    return buildMonthSeries(count);
  }

  const parsedMonths = rows
    .map((row) => {
      const rawMonth =
        pick(row, "forecast_month", "forecastMonth", "Forecast_Month") ||
        pick(row, "start_date", "Start_Date", "StartDate");
      const parsed = parseDateLike(rawMonth);
      return parsed ? startOfMonth(parsed) : null;
    })
    .filter(Boolean)
    .sort((a, b) => a.getTime() - b.getTime());

  if (!parsedMonths.length) {
    return buildMonthSeries(count);
  }

  const earliest = parsedMonths[0];
  const latest = parsedMonths[parsedMonths.length - 1];
  const latestWindowStart = startOfMonth(new Date(latest.getTime()));
  latestWindowStart.setMonth(latestWindowStart.getMonth() - (count - 1));

  const start =
    latestWindowStart.getTime() > earliest.getTime()
      ? latestWindowStart
      : startOfMonth(new Date(earliest.getTime()));

  const months = [];
  for (let i = 0; i < count; i += 1) {
    const d = new Date(start.getTime());
    d.setMonth(start.getMonth() + i);
    months.push(d);
  }
  return months;
}

function monthKey(date) {
  return date.toISOString().slice(0, 10);
}

function monthLabel(date) {
  return date.toLocaleString(undefined, { month: "short", year: "numeric" });
}

function statusRank(status) {
  const order = [
    "Enrolled",
    "Current Student",
    "Offered",
    "New Application Request",
    "Withdrawn",
  ];
  const index = order.findIndex((item) => item.toLowerCase() === String(status || "").toLowerCase());
  return index === -1 ? order.length : index;
}

const storyboardUI = (() => {
  let lastUpdatedText = "";
  let modalElements = null;

  function ensureModal() {
    if (modalElements) return modalElements;
    const modal = document.getElementById("storyboard-modal");
    if (!modal) return null;
    const dialog = modal.querySelector(".storyboard-modal__dialog");
    const titleEl = document.getElementById("storyboard-modal-title");
    const summaryEl = document.getElementById("storyboard-modal-summary");
    const detailsEl = document.getElementById("storyboard-modal-details");
    const timestampEl = document.getElementById("storyboard-modal-timestamp");

    modal.querySelectorAll("[data-modal-dismiss]").forEach((el) => {
      el.addEventListener("click", closeModal);
    });

    modal.addEventListener("click", (event) => {
      if (event.target === modal) closeModal();
    });

    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && modal.classList.contains("is-active")) {
        closeModal();
      }
    });

    modalElements = { modal, dialog, titleEl, summaryEl, detailsEl, timestampEl };
    return modalElements;
  }

  function closeModal() {
    const els = ensureModal();
    if (!els) return;
    els.modal.classList.remove("is-active");
    els.modal.setAttribute("aria-hidden", "true");
  }

  function renderDetails(container, detailsText, summaryText) {
    if (!container) return;
    container.innerHTML = "";
    const lines = String(detailsText || "").split(/\n+/).map((line) => line.trim()).filter(Boolean);
    const filtered = summaryText ? lines.filter((line) => line !== summaryText.trim()) : lines;
    if (!filtered.length) return;
    filtered.forEach((line) => {
      const p = document.createElement("p");
      p.textContent = line;
      container.appendChild(p);
    });
  }

  function openModal({ title, summary, details, timestamp }) {
    const els = ensureModal();
    if (!els) return;
    els.titleEl.textContent = title || "AI Insight";
    els.summaryEl.textContent = summary || STORYBOARD_FALLBACK;
    renderDetails(els.detailsEl, details, summary);
    els.timestampEl.textContent = timestamp || lastUpdatedText || "";
    els.modal.classList.add("is-active");
    els.modal.setAttribute("aria-hidden", "false");
    if (els.dialog) {
      requestAnimationFrame(() => {
        els.dialog.focus({ preventScroll: true });
      });
    }
  }

  function splitStory(rawText) {
    const text = String(rawText || "").trim();
    if (!text) {
      return { summary: STORYBOARD_FALLBACK, details: STORYBOARD_FALLBACK };
    }
    const parts = text.split(/\n+/).map((part) => part.trim()).filter(Boolean);
    const summaryLine = parts.shift() || STORYBOARD_FALLBACK;
    const cleanedSummary = summaryLine.replace(/^Summary:\s*/i, "").trim() || summaryLine;
    const detailLines = parts.map((part) => part.replace(/^\s+/g, "").replace(/\s+/g, " "));
    const detailsText = detailLines.length ? detailLines.join("\n") : cleanedSummary;
    return { summary: cleanedSummary, details: detailsText };
  }

  function bindCard(summaryEl, storyText) {
    if (!summaryEl) return;
    const card =
      summaryEl.closest(".storyboard-card, .kpi-card, [data-story-trigger]");
    const { summary, details } = splitStory(storyText);
    summaryEl.textContent = summary;
    if (!card) return;
    card.dataset.storySummary = summary;
    card.dataset.storyDetails = details;
    card.dataset.storyTimestamp = lastUpdatedText;
    if (!card.dataset.storyTitle) {
      const titleEl = card.querySelector(
        ".storyboard-card__title, h4, [data-story-title-text]"
      );
      const textContent = titleEl ? titleEl.textContent.trim() : "";
      if (textContent) card.dataset.storyTitle = textContent;
    }

    if (!card.hasAttribute("tabindex")) {
      card.tabIndex = 0;
    }
    card.setAttribute("role", card.getAttribute("role") || "button");

    if (card.dataset.modalBound !== "true") {
      const open = () => {
        openModal({
          title: card.dataset.storyTitle,
          summary: card.dataset.storySummary,
          details: card.dataset.storyDetails,
          timestamp: card.dataset.storyTimestamp,
        });
      };

      card.addEventListener("click", open);
      card.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          open();
        }
      });
      card.dataset.modalBound = "true";
    }
  }

  return {
    setLastUpdated(text) {
      lastUpdatedText = text || "";
    },
    applyStory(summaryEl, storyText) {
      bindCard(summaryEl, storyText);
    },
    applyFallback(summaryEl) {
      bindCard(summaryEl, STORYBOARD_FALLBACK);
    },
  };
})();

document.addEventListener("DOMContentLoaded", () => {
  loadRevenueForecast();
  loadOffersOverview();
  loadAgentPerformance();
  loadStudentClassification();
  loadStoryboards('leader', 'leader-storyboard-card-container', 'storyboards-updated');
});

/* ------------------------------ Revenue Forecast ------------------------------ */
async function loadRevenueForecast() {
  const el = document.getElementById("revenueForecastChart");
  if (!el) return;

  try {
    const rows = await fetchJSON("/api/revenue-forecast");
    const months = deriveForecastMonths(rows, 12);
    const monthMap = new Map(months.map((date, idx) => [monthKey(date), idx]));
    const projectedTotals = months.map(() => 0);
    const paidTotals = months.map(() => 0);

    rows.forEach((row) => {
      const monthString =
        pick(row, "forecast_month", "forecastMonth", "Forecast_Month") ||
        pick(row, "start_date", "Start_Date", "StartDate");
      const parsed = parseDateLike(monthString);
      if (!parsed) return;
      const key = monthKey(startOfMonth(parsed));
      if (!monthMap.has(key)) return;
      const idx = monthMap.get(key);
      const projected = toNumber(
        pick(row, "enrolment_fees", "Enrolment_Fees", "revenue")
      );
      const paid = toNumber(pick(row, "paid_fees", "Paid_Fees", "paidFees"));
      projectedTotals[idx] += projected;
      paidTotals[idx] += paid;
    });

    const labels = months.map(monthLabel);
    const projectedColor = "#2563eb";
    const paidColor = "#16a34a";

    if (el.__chart) el.__chart.destroy();
    el.__chart = new Chart(el, {
      type: "line",
      data: {
        labels,
        datasets: [
          {
            label: "Projected Enrolment Fees",
            data: projectedTotals,
            borderColor: projectedColor,
            backgroundColor: "rgba(37, 99, 235, 0.15)",
            fill: true,
            tension: 0.25,
          },
          {
            label: "Paid Fees",
            data: paidTotals,
            borderColor: paidColor,
            backgroundColor: "rgba(22, 163, 74, 0.15)",
            fill: true,
            tension: 0.25,
          },
        ],
      },
      options: {
        responsive: true,
        plugins: {
          legend: { display: true },
          tooltip: {
            callbacks: {
              label(ctx) {
                const value = ctx.parsed.y || 0;
                return ` ${ctx.dataset.label}: $${value.toLocaleString()}`;
              },
            },
          },
        },
        scales: {
          y: {
            beginAtZero: true,
            ticks: {
              callback(value) {
                return `$${Number(value).toLocaleString()}`;
              },
            },
          },
        },
      },
    });
  } catch (e) {
    console.error("revenue forecast", e);
  }
}

/* ------------------------------ Offers Overview ------------------------------ */
async function loadOffersOverview() {
  const el = document.getElementById("offersOverviewChart");
  if (!el) return;

  const endpoints = [
    "/api/offers-status",
    "/api/application-status",
  ];

  let rows = [];
  for (const url of endpoints) {
    try {
      rows = normalizeOffers(await fetchJSON(url));
      if (rows.length) break;
    } catch (_) {
      // keep trying other endpoints
    }
  }

  if (!rows.length) return;

  const labels = rows.map(r => r.status);
  const data = rows.map(r => r.student_count);
  const paletteLocal = ["#2563eb", "#f97316", "#10b981", "#ef4444", "#8b5cf6", "#14b8a6", "#f59e0b", "#3b82f6", "#ec4899", "#22d3ee"];

  if (el.__chart) el.__chart.destroy();
  el.__chart = new Chart(el, {
    type: "bar",
    data: {
      labels,
      datasets: [{
        label: "Student Count",
        backgroundColor: labels.map((_, idx) => paletteLocal[idx % paletteLocal.length]),
        data,
      }],
    },
    options: {
      responsive: true,
      plugins: { legend: { display: false } },
      scales: { y: { beginAtZero: true, ticks: { precision: 0 } } },
    },
  });
}

function normalizeOffers(rows) {
  if (!Array.isArray(rows) || !rows.length) return [];
  const first = rows[0] ?? {};
  const hasStatus = "status" in first || "Status" in first || "offer_status" in first || "Offer Status" in first;
  const hasCount = "student_count" in first || "Student Count" in first || "total" in first || "Total" in first || "count" in first || "Count" in first;

  const tidy = list => list
    .map(item => ({
      status: String(pick(item, "status", "Status", "offer_status", "Offer Status") || "").trim(),
      student_count: Number(pick(item, "student_count", "Student Count", "total", "Total", "count", "Count") || 0),
    }))
    .filter(row => row.status && !/^unknown$/i.test(row.status))
    .sort((a, b) => b.student_count - a.student_count || a.status.localeCompare(b.status));

  if (hasStatus && hasCount) {
    return tidy(rows);
  }

  if (!hasStatus) return [];

  const counts = new Map();
  for (const row of rows) {
    const status = String(pick(row, "status", "Status", "offer_status", "Offer Status", "Application Status", "application_status") || "").trim();
    if (!status) continue;
    const key = status || "Unknown";
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  return tidy(Array.from(counts, ([status, count]) => ({ status, student_count: count })));
}

/* ------------------------------ Agent Performance ------------------------------ */
async function loadAgentPerformance() {
  const el = document.getElementById("agentPerformanceChart");
  if (!el) return;

  try {
    const rows = await fetchJSON("/api/agent-performance");
    if (!Array.isArray(rows) || !rows.length) return;

    const agentMap = new Map();
    const statusSet = new Set();

    rows.forEach((row, idx) => {
      const agent = (pick(row, "agent", "Agent") || "Unassigned").toString().trim() || "Unassigned";
      const status = (pick(row, "status", "Status") || "Unknown").toString().trim() || "Unknown";
      const offerId =
        pick(row, "offer_id", "Offer_Id", "Offer ID", "OfferId", "offerId") ||
        pick(row, "student_id", "Student_Id", "Student ID") ||
        `offer-${idx}`;

      statusSet.add(status);
      if (!agentMap.has(agent)) agentMap.set(agent, new Map());
      const statusMap = agentMap.get(agent);
      if (!statusMap.has(status)) statusMap.set(status, new Set());
      statusMap.get(status).add(String(offerId));
    });

    if (!agentMap.size) return;

    const statuses = Array.from(statusSet);
    statuses.sort((a, b) => statusRank(a) - statusRank(b) || a.localeCompare(b));

    const agentStats = Array.from(agentMap.entries()).map(([agent, statusMap]) => {
      const counts = {};
      let total = 0;
      statuses.forEach((status) => {
        const set = statusMap.get(status);
        const count = set ? set.size : 0;
        counts[status] = count;
        total += count;
      });
      return { agent, counts, total };
    });

    agentStats.sort((a, b) => b.total - a.total || a.agent.localeCompare(b.agent));

    const labels = agentStats.map((stat) => stat.agent);
    const datasets = statuses.map((status, idx) => ({
      label: status,
      data: agentStats.map((stat) => stat.counts[status] || 0),
      backgroundColor: STATUS_COLOR_RAMP[idx % STATUS_COLOR_RAMP.length],
      stack: "status",
    }));

    if (el.__chart) el.__chart.destroy();
    el.__chart = new Chart(el, {
      type: "bar",
      data: { labels, datasets },
      options: {
        responsive: true,
        plugins: { legend: { position: "bottom" } },
        scales: {
          x: { stacked: true },
          y: { stacked: true, beginAtZero: true, ticks: { precision: 0 } },
        },
      },
    });
  } catch (e) {
    console.error("agent performance", e);
  }
}

/* ------------------------------ Student Classification ------------------------------ */
async function loadStudentClassification() {
  const el = document.getElementById("studentClassificationChart");
  if (!el) return;

  try {
    const rows = await fetchJSON("/api/student-classification");
    if (!Array.isArray(rows) || !rows.length) return;

    const courseMap = new Map();
    const visaSet = new Set();

    rows.forEach((row, idx) => {
      const course = (pick(row, "course_type", "Course_Type", "Course Type", "coursetype") || "Unknown").toString().trim() || "Unknown";
      const visa = (pick(row, "visa_status", "Visa_Status", "Visa Status", "visa_type", "Visa Type") || "Unknown").toString().trim() || "Unknown";
      const studentId = (pick(row, "student_id", "Student_Id", "Student ID") || `student-${idx}`).toString();

      visaSet.add(visa);
      if (!courseMap.has(course)) courseMap.set(course, new Map());
      const visaMap = courseMap.get(course);
      if (!visaMap.has(visa)) visaMap.set(visa, new Set());
      visaMap.get(visa).add(studentId);
    });

    if (!courseMap.size) return;

    const visas = Array.from(visaSet).sort((a, b) => a.localeCompare(b));
    const courses = Array.from(courseMap.keys()).sort((a, b) => a.localeCompare(b));

    const datasets = visas.map((visa, idx) => ({
      label: visa,
      data: courses.map((course) => {
        const set = courseMap.get(course).get(visa);
        return set ? set.size : 0;
      }),
      backgroundColor: VISA_COLOR_RAMP[idx % VISA_COLOR_RAMP.length],
      stack: "visa",
    }));

    if (el.__chart) el.__chart.destroy();
    el.__chart = new Chart(el, {
      type: "bar",
      data: { labels: courses, datasets },
      options: {
        responsive: true,
        plugins: { legend: { position: "bottom" } },
        scales: {
          x: { stacked: true },
          y: { stacked: true, beginAtZero: true, ticks: { precision: 0 } },
        },
      },
    });
  } catch (e) {
    console.error("student classification", e);
  }
}

/* ------------------------------ AI Storyboards ------------------------------ */
function resolveTheme(story, index) {
  const desired = (story && typeof story.theme === "string") ? story.theme.trim() : "";
  if (desired && STORYBOARD_THEMES.includes(desired)) {
    return desired;
  }
  return STORYBOARD_THEMES[index % STORYBOARD_THEMES.length];
}

function renderStoryboardCards(containerId, stories) {
  const container = document.getElementById(containerId);
  if (!container) return;

  container.innerHTML = "";
  const list = Array.isArray(stories) ? stories : [];

  if (!list.length) {
    const card = document.createElement("div");
    card.classList.add("kpi-card", STORYBOARD_THEMES[0]);
    card.setAttribute("data-story-trigger", "");
    const titleEl = document.createElement("h4");
    titleEl.textContent = "AI Insight";
    const summaryEl = document.createElement("p");
    card.append(titleEl, summaryEl);
    container.appendChild(card);
    storyboardUI.applyFallback(summaryEl);
    return;
  }

  list.forEach((story, index) => {
    const card = document.createElement("div");
    card.classList.add("kpi-card", resolveTheme(story, index));
    card.setAttribute("data-story-trigger", "");
    card.dataset.storyKey = story?.key || `story-${index}`;
    const titleText = story?.title || "AI Insight";
    card.dataset.storyTitle = titleText;

    const titleEl = document.createElement("h4");
    titleEl.textContent = titleText;
    const summaryEl = document.createElement("p");
    summaryEl.id = `story-${story?.key || index}`;

    card.append(titleEl, summaryEl);
    container.appendChild(card);

    storyboardUI.applyStory(summaryEl, story?.text || STORYBOARD_FALLBACK);
  });
}

async function loadStoryboards(role, containerId, timestampId) {
  try {
    const response = await fetch(`/api/storyboards/${role}`, { credentials: "same-origin" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const payload = await response.json();
    const stories = Array.isArray(payload.stories) ? payload.stories : [];

    let formattedTimestamp = "";
    if (payload.updated_at) {
      const parsed = new Date(payload.updated_at);
      formattedTimestamp = Number.isNaN(parsed.getTime())
        ? `Updated ${payload.updated_at}`
        : `Updated ${parsed.toLocaleString()}`;
    }

    if (!formattedTimestamp) {
      formattedTimestamp = "Updated just now";
    }

    if (timestampId) {
      const tsEl = document.getElementById(timestampId);
      if (tsEl) {
        tsEl.textContent = formattedTimestamp;
      }
    }

    storyboardUI.setLastUpdated(formattedTimestamp);

    renderStoryboardCards(containerId, stories);
  } catch (error) {
    console.error("storyboards (leader)", error);
    storyboardUI.setLastUpdated("Updated: unavailable");
    renderStoryboardCards(containerId, []);
    if (timestampId) {
      const tsEl = document.getElementById(timestampId);
      if (tsEl) tsEl.textContent = "Updated: unavailable";
    }
  }
}
