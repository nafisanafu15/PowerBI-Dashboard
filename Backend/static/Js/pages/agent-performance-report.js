const chartCanvas = document.getElementById("mainChart");
const tableElement = document.getElementById("dataTable");
const tableBody = tableElement?.querySelector("tbody");
const tableWrapper = tableElement?.parentElement;

const agentSelect = document.getElementById("filter-agent");
const statusContainer = document.getElementById("status-filter");
const sortButtons = Array.from(document.querySelectorAll(".sort-buttons [data-sort]"));
const chartButtons = Array.from(document.querySelectorAll(".chart-btn"));

const state = {
  chartType: "stacked",
  sortKey: "total-desc",
  selectedAgent: "",
  selectedStatuses: new Set(),
  dateRange: null,
};

let rawRows = [];
let chartInstance = null;
let statusOrder = [];

init();

async function init() {
  if (!chartCanvas || !tableBody) return;

  try {
    rawRows = await fetchRows();
    statusOrder = getStatusList(rawRows);
    populateAgentOptions();
    populateStatusFilter();
    setupInteractions();
    applyFilters();
  } catch (error) {
    console.error("agent performance report", error);
    showEmptyMessage("Unable to load agent performance data");
  }
}

async function fetchRows() {
  const response = await fetch("/api/agent-performance", { credentials: "same-origin" });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    const message = payload?.error || `Request failed (${response.status})`;
    throw new Error(message);
  }
  const data = await response.json();
  return Array.isArray(data) ? data : [];
}

function setupInteractions() {
  if (agentSelect) {
    agentSelect.addEventListener("change", () => {
      state.selectedAgent = agentSelect.value || "";
      applyFilters();
    });
  }

  sortButtons.forEach((button) => {
    button.addEventListener("click", () => {
      state.sortKey = button.dataset.sort;
      updateSortButtons();
      applyFilters();
    });
  });
  updateSortButtons();

  chartButtons.forEach((button) => {
    button.addEventListener("click", () => {
      const type = button.dataset.type || "stacked";
      if (state.chartType === type) return;
      state.chartType = type;
      updateChartButtons();
      applyFilters();
    });
  });
  updateChartButtons();

  if (typeof window.initTimePeriodFilter === "function") {
    const root = document.querySelector(".time-filter");
    window.initTimePeriodFilter(root, (from, to) => {
      if (from && to) {
        state.dateRange = { from: startOfDay(from), to: endOfDay(to) };
      } else {
        state.dateRange = null;
      }
      applyFilters();
    });
  }
}

function populateAgentOptions() {
  if (!agentSelect) return;
  const agents = new Set();
  rawRows.forEach((row) => {
    const agent = (getValue(row, ["agent", "Agent"]) || "Unassigned").toString().trim();
    agents.add(agent);
  });
  const sorted = Array.from(agents).sort((a, b) => a.localeCompare(b));
  sorted.forEach((agent) => {
    const option = document.createElement("option");
    option.value = agent;
    option.textContent = agent;
    agentSelect.appendChild(option);
  });
}

function populateStatusFilter() {
  if (!statusContainer) return;
  statusContainer.innerHTML = "";
  statusOrder.forEach((status) => {
    const id = `status-${status.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}`;
    const wrapper = document.createElement("div");
    wrapper.className = "form-check";
    const input = document.createElement("input");
    input.type = "checkbox";
    input.className = "form-check-input";
    input.id = id;
    input.value = status;
    input.addEventListener("change", () => {
      if (input.checked) {
        state.selectedStatuses.add(status);
      } else {
        state.selectedStatuses.delete(status);
      }
      applyFilters();
    });
    const label = document.createElement("label");
    label.className = "form-check-label";
    label.setAttribute("for", id);
    label.textContent = status;
    wrapper.append(input, label);
    statusContainer.appendChild(wrapper);
  });
}

function getStatusList(rows) {
  const statuses = new Set();
  rows.forEach((row) => {
    const status = (getValue(row, ["status", "Status"]) || "Unknown").toString().trim();
    statuses.add(status);
  });
  return Array.from(statuses).sort((a, b) => statusRank(a) - statusRank(b) || a.localeCompare(b));
}

function applyFilters() {
  if (!rawRows.length) {
    showEmptyMessage("No agent performance data available");
    return;
  }

  const filtered = rawRows.filter(matchesFilters);
  const aggregated = aggregate(filtered);

  if (!aggregated.length) {
    showEmptyMessage("No results for the selected filters");
    return;
  }

  const sorted = sortAggregated(aggregated);
  render(sorted);
}

function matchesFilters(row) {
  const agent = (getValue(row, ["agent", "Agent"]) || "Unassigned").toString().trim();
  if (state.selectedAgent && agent !== state.selectedAgent) return false;

  const status = (getValue(row, ["status", "Status"]) || "Unknown").toString().trim();
  if (state.selectedStatuses.size && !state.selectedStatuses.has(status)) return false;

  if (!state.dateRange) return true;
  const date = parseDateLike(getValue(row, ["start_date", "Start_Date", "StartDate"]));
  if (!date) return false;
  return date >= state.dateRange.from && date <= state.dateRange.to;
}

function aggregate(rows) {
  const agentMap = new Map();

  rows.forEach((row, index) => {
    const agent = (getValue(row, ["agent", "Agent"]) || "Unassigned").toString().trim();
    const status = (getValue(row, ["status", "Status"]) || "Unknown").toString().trim();
    const offerId =
      getValue(row, ["offer_id", "Offer_Id", "Offer ID", "OfferId", "offerId"]) ||
      getValue(row, ["student_id", "Student_Id", "Student ID"]) ||
      `row-${index}`;

    if (!agentMap.has(agent)) agentMap.set(agent, new Map());
    const statusMap = agentMap.get(agent);
    if (!statusMap.has(status)) statusMap.set(status, new Set());
    statusMap.get(status).add(String(offerId));
  });

  const stats = [];
  agentMap.forEach((statusMap, agent) => {
    const counts = {};
    let total = 0;
    const rows = [];
    statusOrder.forEach((status) => {
      const set = statusMap.get(status);
      const count = set ? set.size : 0;
      if (count > 0) {
        rows.push({ agent, status, offers: count });
      }
      counts[status] = count;
      total += count;
    });
    stats.push({ agent, counts, total, rows });
  });

  return stats;
}

function sortAggregated(stats) {
  const sorted = stats.slice();
  switch (state.sortKey) {
    case "total-asc":
      sorted.sort((a, b) => a.total - b.total || a.agent.localeCompare(b.agent));
      break;
    case "agent-asc":
      sorted.sort((a, b) => a.agent.localeCompare(b.agent));
      break;
    case "total-desc":
    default:
      sorted.sort((a, b) => b.total - a.total || a.agent.localeCompare(b.agent));
      break;
  }
  return sorted;
}

function render(stats) {
  if (state.chartType === "table") {
    if (chartInstance) {
      chartInstance.destroy();
      chartInstance = null;
    }
    chartCanvas.style.display = "none";
    tableWrapper.style.display = "block";
    renderTable(stats);
    return;
  }

  tableWrapper.style.display = "none";
  chartCanvas.style.display = "block";
  renderChart(stats);
}

function renderTable(stats) {
  tableBody.innerHTML = "";
  stats.forEach((stat) => {
    if (!stat.rows.length) {
      const tr = document.createElement("tr");
      tr.innerHTML = `<td>${stat.agent}</td><td class="text-muted">—</td><td>0</td>`;
      tableBody.appendChild(tr);
      return;
    }
    stat.rows.forEach((row) => {
      const tr = document.createElement("tr");
      tr.innerHTML = `<td>${row.agent}</td><td>${row.status}</td><td>${row.offers}</td>`;
      tableBody.appendChild(tr);
    });
  });
}

function renderChart(stats) {
  const labels = stats.map((stat) => stat.agent);
  const datasets = statusOrder.map((status, index) => ({
    label: status,
    data: stats.map((stat) => stat.counts[status] || 0),
    backgroundColor: STATUS_COLOR_RAMP[index % STATUS_COLOR_RAMP.length],
    stack: "status",
  }));

  const config = {
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
  };

  if (state.chartType === "horizontal") {
    config.options.indexAxis = "y";
  }

  if (chartInstance) chartInstance.destroy();
  chartInstance = new Chart(chartCanvas, config);
}

function showEmptyMessage(message) {
  if (chartInstance) {
    chartInstance.destroy();
    chartInstance = null;
  }
  chartCanvas.style.display = "none";
  tableWrapper.style.display = "block";
  tableBody.innerHTML = `<tr><td colspan="3" class="text-center text-muted">${message}</td></tr>`;
}

function updateSortButtons() {
  sortButtons.forEach((button) => {
    button.classList.toggle("active", button.dataset.sort === state.sortKey);
  });
}

function updateChartButtons() {
  chartButtons.forEach((button) => {
    button.classList.toggle("active", button.dataset.type === state.chartType);
  });
}

function getValue(row, keys) {
  for (const key of keys) {
    if (key in row) return row[key];
    const normalized = key.toLowerCase();
    for (const prop in row) {
      if (!Object.prototype.hasOwnProperty.call(row, prop)) continue;
      if (prop.toLowerCase() === normalized) return row[prop];
      if (prop.replace(/[_\s]+/g, "").toLowerCase() === normalized.replace(/[_\s]+/g, "")) {
        return row[prop];
      }
    }
  }
  return undefined;
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

function startOfDay(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

function endOfDay(date) {
  const d = new Date(date);
  d.setHours(23, 59, 59, 999);
  return d;
}

const STATUS_COLOR_RAMP = [
  "#2563eb",
  "#22c55e",
  "#f97316",
  "#ec4899",
  "#facc15",
  "#0ea5e9",
  "#a855f7",
];

function statusRank(status) {
  const order = ["Enrolled", "Current Student", "Offered", "Withdrawn", "New Application Request"];
  const index = order.findIndex((item) => item.toLowerCase() === status.toLowerCase());
  return index === -1 ? order.length : index;
}
